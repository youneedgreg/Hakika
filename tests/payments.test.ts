// Paying a supplier, on an in-memory Postgres with a fake PayPal sandbox: the amount comes from the
// database, a second click reuses the open order, and nothing pays the same request twice.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { captureOrderForRequest, createOrderForRequest, type PaymentDeps } from "@/server/payments/orders";
import { PayPalApiError, type PayPalClient, type PayPalOrder } from "@/server/payments/paypal";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const MLIMA_EMAIL = "mlima@business.example.com";

// Behaves like the sandbox: an order must be approved before capture, a repeated PayPal-Request-Id
// returns the first capture, and a second capture of the same order is ORDER_ALREADY_CAPTURED.
function fakeSandbox() {
  type Stored = { order: PayPalOrder; approved: boolean; body: Parameters<PayPalClient["createOrder"]>[0]; captureKey?: string };
  const orders = new Map<string, Stored>();
  const counts = { create: 0, capture: 0 };
  let nextCaptureStatus: "COMPLETED" | "PENDING" | "DECLINED" = "COMPLETED";
  let loseNextCaptureAnswer = false;

  const capturedOrder = (stored: Stored, status: string): PayPalOrder => ({
    id: stored.order.id,
    status: status === "COMPLETED" ? "COMPLETED" : stored.order.status,
    purchase_units: [{ payments: { captures: [{
      id: `CAP-${stored.order.id}`, status: status as "COMPLETED", amount: { currency_code: "USD", value: stored.body.usdAmount },
    }] } }],
  });

  const paypal: PayPalClient = {
    async createOrder(body) {
      counts.create += 1;
      const id = `ORDER${counts.create}`;
      orders.set(id, { order: { id, status: "PAYER_ACTION_REQUIRED" }, approved: false, body });
      return { id, status: "PAYER_ACTION_REQUIRED" };
    },
    async getOrder(orderId) {
      return orders.get(orderId)?.order ?? null;
    },
    async captureOrder(orderId, key) {
      const stored = orders.get(orderId)!;
      if (stored.captureKey === key) return stored.order;
      if (stored.captureKey) throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED", "debug");
      if (!stored.approved) throw new PayPalApiError(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED", "debug");
      counts.capture += 1;
      stored.captureKey = key;
      stored.order = capturedOrder(stored, nextCaptureStatus);
      if (loseNextCaptureAnswer) {
        loseNextCaptureAnswer = false;
        throw new Error("socket hang up");
      }
      return stored.order;
    },
  };

  return {
    paypal,
    orders,
    counts,
    approve: (orderId: string) => {
      const stored = orders.get(orderId)!;
      stored.approved = true;
      stored.order = { ...stored.order, status: "APPROVED" };
    },
    expire: (orderId: string) => orders.delete(orderId),
    voidOrder: (orderId: string) => {
      const stored = orders.get(orderId)!;
      stored.order = { ...stored.order, status: "VOIDED" };
    },
    completeLater: (orderId: string) => {
      const stored = orders.get(orderId)!;
      stored.order = capturedOrder(stored, "COMPLETED");
    },
    captureWill: (status: typeof nextCaptureStatus) => { nextCaptureStatus = status; },
    loseNextCaptureAnswer: () => { loseNextCaptureAnswer = true; },
  };
}

let sandbox: ReturnType<typeof fakeSandbox>;
let kesPerUsd: string;
const deps = (): PaymentDeps => ({
  paypal: sandbox.paypal,
  appUrl: "https://tryhakika.vercel.app",
  rate: async () => ({ kesPerUsd }),
  now: () => new Date("2026-11-03T12:00:00Z"),
});

async function addRequest(values: Partial<typeof s.requests.$inferInsert> = {}) {
  const [row] = await db.insert(s.requests).values({
    projectId: DEMO.projectId,
    contactId: DEMO.contactIds.peter,
    status: "awaiting_approval",
    quotedSupplierName: "Baraka Hardware",
    quotedTotalKesCents: 4_750_000,
    recommendedSupplierId: DEMO.supplierIds.mlima,
    recommendedTotalKesCents: 3_950_000,
    ...values,
  }).returning();
  return row;
}

const requestStatus = async (id: string) =>
  (await db.select({ status: s.requests.status }).from(s.requests).where(eq(s.requests.id, id)))[0].status;
const paymentsFor = (requestId: string) =>
  db.select().from(s.payments).where(eq(s.payments.requestId, requestId)).orderBy(asc(s.payments.createdAt));
const actions = async (requestId: string) =>
  (await db.select().from(s.auditEvents).where(eq(s.auditEvents.requestId, requestId)).orderBy(asc(s.auditEvents.at)))
    .map((event) => event.action);

async function createOrder(requestId: string) {
  const outcome = await createOrderForRequest(db, requestId, deps());
  if (!outcome.ok) throw new Error(`create failed: ${outcome.code}`);
  return outcome.value.orderId;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  await db.delete(s.auditEvents);
  await db.delete(s.payments);
  await db.delete(s.findings);
  await db.delete(s.requests);
  await resetDemo(db, { mlima: MLIMA_EMAIL });
  sandbox = fakeSandbox();
  kesPerUsd = "129.980973";
});

describe("creating the PayPal order", () => {
  it("pays the recommended supplier the server's amount, in USD at the day's rate", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);

    const sent = sandbox.orders.get(orderId)!.body;
    expect(sent).toMatchObject({
      requestId: request.id,
      payeeEmail: MLIMA_EMAIL,
      usdAmount: "303.89",
      returnUrl: `https://tryhakika.vercel.app/requests/${request.id}?paypal=approved`,
    });
    const [payment] = await paymentsFor(request.id);
    expect(payment).toMatchObject({
      id: sent.paymentId,
      kind: "materials",
      status: "created",
      payeeSupplierId: DEMO.supplierIds.mlima,
      payeeEmail: MLIMA_EMAIL,
      amountKesCents: 3_950_000,
      amountUsdCents: 30_389,
      kesPerUsd: "129.980973",
      paypalOrderId: orderId,
      paypalRequestId: `capture-${sent.paymentId}`,
    });
    expect(sent.idempotencyKey).toBe(`create-${sent.paymentId}`);
    expect(await requestStatus(request.id)).toBe("awaiting_approval");
    expect(await actions(request.id)).toEqual(["payment.order_created"]);
  });

  it("reuses the open order when the owner clicks again", async () => {
    const request = await addRequest();
    const first = await createOrder(request.id);
    const second = await createOrder(request.id);

    expect(second).toBe(first);
    expect(sandbox.counts.create).toBe(1);
    expect(await paymentsFor(request.id)).toHaveLength(1);
  });

  it("replaces an order PayPal no longer has, has voided, or whose amount has changed", async () => {
    const request = await addRequest();
    const first = await createOrder(request.id);
    sandbox.expire(first);
    const second = await createOrder(request.id);
    sandbox.voidOrder(second);
    const third = await createOrder(request.id);
    kesPerUsd = "130.000000";
    const fourth = await createOrder(request.id);

    expect(new Set([first, second, third, fourth]).size).toBe(4);
    expect((await paymentsFor(request.id)).map((payment) => payment.status)).toEqual(["failed", "failed", "failed", "created"]);
    expect((await paymentsFor(request.id))[3].amountUsdCents).toBe(30_385);
  });

  it("refuses a request that isn't waiting for the owner", async () => {
    for (const status of ["checked", "paid", "declined"] as const) {
      const request = await addRequest({ status });
      const outcome = await createOrderForRequest(db, request.id, deps());
      expect(outcome).toMatchObject({ ok: false, httpStatus: 409, code: "not_awaiting_approval" });
    }
    expect(await createOrderForRequest(db, "req_nope", deps())).toMatchObject({ ok: false, httpStatus: 404 });
    expect(sandbox.counts.create).toBe(0);
  });

  it("refuses while a blocking finding hasn't been acknowledged", async () => {
    const request = await addRequest();
    await db.insert(s.findings).values({
      requestId: request.id, position: 0, type: "price_above_market", severity: "block", message: "Cement is 40% above.", data: {},
    });
    expect(await createOrderForRequest(db, request.id, deps())).toMatchObject({ ok: false, code: "findings_unacknowledged" });

    await db.update(s.findings).set({ acknowledgedAt: new Date() }).where(eq(s.findings.requestId, request.id));
    expect(await createOrderForRequest(db, request.id, deps())).toMatchObject({ ok: true });
  });

  it("refuses when the supplier has no PayPal account or isn't verified", async () => {
    const noEmail = await addRequest({ recommendedSupplierId: DEMO.supplierIds.kiawara }); // seeded without an email here
    expect(await createOrderForRequest(db, noEmail.id, deps())).toMatchObject({ ok: false, code: "no_payee" });

    await db.update(s.suppliers).set({ verified: false }).where(eq(s.suppliers.id, DEMO.supplierIds.mlima));
    const unverified = await addRequest();
    expect(await createOrderForRequest(db, unverified.id, deps())).toMatchObject({ ok: false, code: "no_payee" });
    expect(sandbox.counts.create).toBe(0);
  });
});

describe("capturing after the owner approves", () => {
  it("marks the request paid and stores the capture", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);

    const outcome = await captureOrderForRequest(db, orderId, deps());
    expect(outcome).toEqual({ ok: true, value: { requestId: request.id, status: "paid", captureId: `CAP-${orderId}` } });
    const [payment] = await paymentsFor(request.id);
    expect(payment).toMatchObject({ status: "captured", paypalCaptureId: `CAP-${orderId}`, capturedAt: new Date("2026-11-03T12:00:00Z") });
    expect(await actions(request.id)).toEqual(["payment.order_created", "payment.captured"]);
  });

  it("names the supplier in the money trail, not its PayPal email", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    await captureOrderForRequest(db, orderId, deps());

    const [captured] = await db.select().from(s.auditEvents)
      .where(and(eq(s.auditEvents.requestId, request.id), eq(s.auditEvents.action, "payment.captured")));
    expect(captured.description).toMatch(/^USD \d+\.\d{2} was paid through PayPal to Mlima Hardware\.$/);
    expect(captured.description).not.toContain(MLIMA_EMAIL);
  });

  it("answers a repeated capture from the database without paying again", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    const first = await captureOrderForRequest(db, orderId, deps());
    const second = await captureOrderForRequest(db, orderId, deps());

    expect(second).toEqual(first);
    expect(sandbox.counts.capture).toBe(1);
  });

  it("changes nothing before the owner approves", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);

    expect(await captureOrderForRequest(db, orderId, deps())).toMatchObject({ ok: false, httpStatus: 409, code: "order_not_approved" });
    expect(await requestStatus(request.id)).toBe("awaiting_approval");
    expect((await paymentsFor(request.id))[0].status).toBe("created");
  });

  it("recovers a capture whose answer was lost, without charging twice", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    sandbox.loseNextCaptureAnswer();

    await expect(captureOrderForRequest(db, orderId, deps())).rejects.toThrow("socket hang up");
    expect(await requestStatus(request.id)).toBe("awaiting_approval");

    expect(await captureOrderForRequest(db, orderId, deps())).toMatchObject({ ok: true, value: { status: "paid" } });
    expect(sandbox.counts.capture).toBe(1);
  });

  it("puts a declined capture back for approval, and a new order can follow", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    sandbox.captureWill("DECLINED");

    expect(await captureOrderForRequest(db, orderId, deps())).toMatchObject({ ok: false, httpStatus: 402, code: "capture_declined" });
    expect(await requestStatus(request.id)).toBe("awaiting_approval");
    expect((await paymentsFor(request.id))[0].status).toBe("denied");

    sandbox.captureWill("COMPLETED");
    const retry = await createOrder(request.id);
    expect(retry).not.toBe(orderId);
  });

  it("holds a pending capture as approved, so it can't be paid again, until PayPal completes it", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    sandbox.captureWill("PENDING");

    expect(await captureOrderForRequest(db, orderId, deps())).toMatchObject({ ok: true, value: { status: "approved" } });
    expect(await createOrderForRequest(db, request.id, deps())).toMatchObject({ ok: false, code: "not_awaiting_approval" });

    sandbox.completeLater(orderId);
    expect(await captureOrderForRequest(db, orderId, deps())).toMatchObject({ ok: true, value: { status: "paid" } });
    expect((await paymentsFor(request.id))[0].status).toBe("captured");
  });

  it("won't capture a second order once another order for the request was paid at PayPal", async () => {
    const request = await addRequest();
    const first = await createOrder(request.id);
    sandbox.approve(first);
    // PayPal captured the first order, but its answer never reached the database.
    await sandbox.paypal.captureOrder(first, "capture-elsewhere");
    // A second open order for the same request, approved too.
    const [firstPayment] = await paymentsFor(request.id);
    const second = "ORDER-B";
    sandbox.orders.set(second, {
      order: { id: second, status: "APPROVED" }, approved: true,
      body: { ...sandbox.orders.get(first)!.body, paymentId: "pay_b" },
    });
    await db.insert(s.payments).values({
      ...firstPayment, id: "pay_b", paypalOrderId: second, paypalRequestId: "capture-pay_b", createdAt: undefined,
    });

    const outcome = await captureOrderForRequest(db, second, deps());
    expect(outcome).toMatchObject({ ok: false, code: "already_paid" });
    expect(sandbox.counts.capture).toBe(1);
    expect(await requestStatus(request.id)).toBe("paid");
    const statuses = Object.fromEntries((await paymentsFor(request.id)).map((payment) => [payment.paypalOrderId, payment.status]));
    expect(statuses).toEqual({ [first]: "captured", [second]: "created" });
  });

  it("404s an order Hakika didn't create", async () => {
    expect(await captureOrderForRequest(db, "SOMEONE-ELSES", deps())).toMatchObject({ ok: false, httpStatus: 404 });
  });
});
