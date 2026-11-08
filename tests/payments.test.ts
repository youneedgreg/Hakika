// Paying a supplier, on an in-memory Postgres with a fake PayPal sandbox: the amount comes from the
// database, a second click reuses the open order, and nothing pays the same request twice.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { captureOrderForRequest, createOrderForRequest, type PaymentDeps } from "@/server/payments/orders";
import { PayPalApiError, type PayPalClient, type PayPalOrder } from "@/server/payments/paypal";
import { handlePayPalEvent, type PayPalEvent } from "@/server/payments/webhooks";
import { sendPaymentConfirmations } from "@/server/payments/confirmations";
import { loadLedger } from "@/server/projects/ledger";
import { ledgerToCsv } from "@/server/csv";

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
    async verifyWebhookSignature() {
      return true; // the route checks signatures; these tests call the handler after that
    },
  };

  const setCaptureStatus = (orderId: string, status: string) => {
    const stored = orders.get(orderId)!;
    const [unit] = stored.order.purchase_units!;
    unit.payments!.captures![0] = { ...unit.payments!.captures![0], status: status as "REFUNDED" };
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
    refund: (orderId: string, part: "full" | "partial" = "full") =>
      setCaptureStatus(orderId, part === "full" ? "REFUNDED" : "PARTIALLY_REFUNDED"),
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
  await db.delete(s.webhookEvents);
  await db.delete(s.messages);
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
      referenceId: request.id,
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

describe("PayPal webhook events (after the signature check)", () => {
  let eventCount = 0;
  const captureEvent = (type: string, orderId: string, captureId = `CAP-${orderId}`): PayPalEvent => ({
    id: `WH-${++eventCount}`,
    event_type: type,
    resource: { id: captureId, supplementary_data: { related_ids: { order_id: orderId } } },
  });
  const refundEvent = (captureId: string, type = "PAYMENT.CAPTURE.REFUNDED"): PayPalEvent => ({
    id: `WH-${++eventCount}`,
    event_type: type,
    resource: {
      id: "REFUND-1",
      links: [
        { rel: "self", href: "https://api.sandbox.paypal.com/v2/payments/refunds/REFUND-1" },
        { rel: "up", href: `https://api.sandbox.paypal.com/v2/payments/captures/${captureId}` },
      ],
    },
  });
  const handle = (event: PayPalEvent) => handlePayPalEvent(db, event, deps());

  async function paidRequest() {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    await captureOrderForRequest(db, orderId, deps());
    return { request, orderId };
  }

  it("confirms a capture the server already recorded, once, and ignores a repeated delivery", async () => {
    const { request, orderId } = await paidRequest();
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED", orderId);

    expect(await handle(event)).toBe("confirmed");
    expect(await handle(event)).toBe("duplicate");
    expect(await handle(captureEvent("PAYMENT.CAPTURE.COMPLETED", orderId))).toBe("no_change");
    expect(await actions(request.id)).toEqual(["payment.order_created", "payment.captured", "payment.webhook_confirmed"]);
    expect(sandbox.counts.capture).toBe(1);
    const [stored] = await db.select().from(s.webhookEvents).where(eq(s.webhookEvents.eventId, event.id));
    expect(stored).toMatchObject({ provider: "paypal", type: "PAYMENT.CAPTURE.COMPLETED" });
    expect(stored.processedAt).not.toBeNull();
  });

  it("finishes a pending capture when PayPal completes it, without capturing again", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    sandbox.captureWill("PENDING");
    await captureOrderForRequest(db, orderId, deps());
    expect(await handle(captureEvent("PAYMENT.CAPTURE.PENDING", orderId))).toBe("no_change");

    sandbox.completeLater(orderId);
    expect(await handle(captureEvent("PAYMENT.CAPTURE.COMPLETED", orderId))).toBe("recorded");
    expect(await requestStatus(request.id)).toBe("paid");
    expect(sandbox.counts.capture).toBe(1);
    const [captured] = await db.select().from(s.auditEvents).where(and(
      eq(s.auditEvents.requestId, request.id), eq(s.auditEvents.action, "payment.captured"),
    ));
    expect(captured.data).toMatchObject({ via: "paypal_webhook", eventType: "PAYMENT.CAPTURE.COMPLETED" });
  });

  it("never captures: an approved order PayPal hasn't captured stays unpaid", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);

    expect(await handle(captureEvent("PAYMENT.CAPTURE.COMPLETED", orderId))).toBe("no_change");
    expect(sandbox.counts.capture).toBe(0);
    expect(await requestStatus(request.id)).toBe("awaiting_approval");
  });

  it("records a full refund on the payment and leaves the request's status alone", async () => {
    const { request, orderId } = await paidRequest();
    sandbox.refund(orderId);

    expect(await handle(refundEvent(`CAP-${orderId}`))).toBe("refunded");
    expect((await paymentsFor(request.id))[0].status).toBe("refunded");
    expect(await requestStatus(request.id)).toBe("paid");
    expect(await actions(request.id)).toContain("payment.refunded");
    expect(await handle(refundEvent(`CAP-${orderId}`))).toBe("no_change");
  });

  it("notes a partial refund in the money trail but keeps the payment captured", async () => {
    const { request, orderId } = await paidRequest();
    sandbox.refund(orderId, "partial");

    expect(await handle(refundEvent(`CAP-${orderId}`))).toBe("partially_refunded");
    expect((await paymentsFor(request.id))[0].status).toBe("captured");
    expect(await actions(request.id)).toContain("payment.partially_refunded");
  });

  it("flags a capture PayPal reports for a request that wasn't waiting to be paid", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    sandbox.completeLater(orderId);
    await db.update(s.requests).set({ status: "declined" }).where(eq(s.requests.id, request.id));

    expect(await handle(captureEvent("PAYMENT.CAPTURE.COMPLETED", orderId))).toBe("unexpected");
    expect(await requestStatus(request.id)).toBe("declined");
    expect(await actions(request.id)).toContain("payment.capture_unexpected");
  });

  it("ignores orders Hakika didn't make and event types it doesn't read, and stores both", async () => {
    expect(await handle(captureEvent("PAYMENT.CAPTURE.COMPLETED", "SOMEONE-ELSES"))).toBe("unknown_order");
    expect(await handle({ id: "WH-other", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "X" } })).toBe("ignored");
    expect(await handle(refundEvent("NOT-OUR-CAPTURE"))).toBe("ignored");
    expect(await db.select().from(s.webhookEvents)).toHaveLength(3);
  });

  it("runs an event again when PayPal retries one that failed half-way", async () => {
    const { orderId } = await paidRequest();
    const event = captureEvent("PAYMENT.CAPTURE.COMPLETED", orderId);
    const getOrder = sandbox.paypal.getOrder;
    sandbox.paypal.getOrder = async () => { throw new Error("socket hang up"); };

    await expect(handle(event)).rejects.toThrow("socket hang up");
    sandbox.paypal.getOrder = getOrder;
    expect(await handle(event)).toBe("confirmed");
  });
});

describe("telling the payment steps' caller what was paid", () => {
  it("reports a payment once, after it is recorded, and not for a pending capture", async () => {
    const reported: string[][] = [];
    const withReport = (): PaymentDeps => ({ ...deps(), onPaid: (ids) => { reported.push(ids); } });
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    sandbox.captureWill("PENDING");

    await captureOrderForRequest(db, orderId, withReport());
    expect(reported).toEqual([]);
    sandbox.completeLater(orderId);
    await handlePayPalEvent(db, { id: "WH-paid", event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: `CAP-${orderId}`, supplementary_data: { related_ids: { order_id: orderId } } } }, withReport());
    await captureOrderForRequest(db, orderId, withReport());

    const [payment] = await paymentsFor(request.id);
    expect(reported).toEqual([[payment.id]]);
  });

  it("returns the payment result even when reporting fails", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    const outcome = await captureOrderForRequest(db, orderId, { ...deps(), onPaid: () => { throw new Error("Twilio down"); } });
    expect(outcome).toMatchObject({ ok: true, value: { status: "paid" } });
  });
});

describe("WhatsApp confirmations after a supplier is paid", () => {
  const GRACE_TEST_PHONE = "+15550000103"; // a test phone mapped onto Grace; never a seeded number
  async function paidPayment() {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    await captureOrderForRequest(db, orderId, deps());
    return (await paymentsFor(request.id))[0];
  }
  const sentMessages = () => db.select().from(s.messages).where(eq(s.messages.direction, "outbound")).orderBy(asc(s.messages.createdAt));

  it("sends fixed templates only to mapped test phones, and stores the rest unsent", async () => {
    const payment = await paidPayment();
    const send = vi.fn(async () => "SM-1");

    const outcomes = await sendPaymentConfirmations(
      { db, send, testPhones: new Map([[GRACE_TEST_PHONE, DEMO.contactIds.grace]]) }, payment.id);

    expect(send).toHaveBeenCalledExactlyOnceWith(GRACE_TEST_PHONE,
      "Hakika: KES 39,500 has been paid to Mlima Hardware through PayPal for a materials order. Please arrange the delivery to the site.");
    expect(outcomes).toEqual([
      { contactId: DEMO.contactIds.peter, sent: false, reason: "no_test_phone" },
      { contactId: DEMO.contactIds.grace, sent: true },
    ]);
    const messages = await sentMessages();
    expect(messages.map((m) => [m.contactId, m.templateKey, m.language, m.twilioSid])).toEqual(expect.arrayContaining([
      [DEMO.contactIds.peter, "materials_paid_foreman", "sw", null],
      [DEMO.contactIds.grace, "materials_paid_supplier", "en", "SM-1"],
    ]));
    expect(messages.find((m) => m.contactId === DEMO.contactIds.peter)?.body).toContain("Mlima Hardware kiasi cha KES 39,500");
    const [row] = await db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "payment.confirmations"));
    expect(row).toMatchObject({ paymentId: payment.id, description: "WhatsApp confirmations of this payment: 1 of 2 sent." });
  });

  it("records a failed send without stopping the others", async () => {
    const payment = await paidPayment();
    const send = vi.fn(async () => { throw new Error("Twilio refused the message"); });
    const outcomes = await sendPaymentConfirmations({ db, send, testPhones: new Map([
      ["+15550000101", DEMO.contactIds.peter], [GRACE_TEST_PHONE, DEMO.contactIds.grace],
    ]) }, payment.id);

    expect(send).toHaveBeenCalledTimes(2);
    expect(outcomes.map((o) => o.reason)).toEqual(["send_failed", "send_failed"]);
    expect((await sentMessages()).every((m) => m.twilioSid === null)).toBe(true);
  });

  it("sends nothing for a payment that isn't captured", async () => {
    const request = await addRequest();
    await createOrder(request.id);
    const [payment] = await paymentsFor(request.id);
    const send = vi.fn(async () => "SM-1");
    expect(await sendPaymentConfirmations({ db, send, testPhones: new Map() }, payment.id)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("the money trail (GET /api/ledger)", () => {
  it("shows a sandbox payment with its amounts, order ID and capture ID, oldest first", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    await captureOrderForRequest(db, orderId, deps());

    const rows = (await loadLedger(db, DEMO.projectId))!;
    const captured = rows.find((row) => row.paypalCaptureId === `CAP-${orderId}`);
    expect(captured).toEqual({
      at: expect.any(String),
      kind: "payment",
      description: "USD 303.89 was paid through PayPal to Mlima Hardware.",
      amount: { amount: "39500.00", currency: "KES" },
      amountUsd: { amount: "303.89", currency: "USD" },
      paypalOrderId: orderId,
      paypalCaptureId: `CAP-${orderId}`,
      link: { requestId: request.id },
    });
    expect(rows.map((row) => row.at)).toEqual([...rows.map((row) => row.at)].sort());
    expect(rows.indexOf(rows.find((row) => row.description.startsWith("A PayPal order"))!))
      .toBeLessThan(rows.indexOf(captured!));
  });

  it("includes milestone events and their timeline link", async () => {
    const rows = (await loadLedger(db, DEMO.projectId))!;
    const seeded = await db.select().from(s.auditEvents).where(eq(s.auditEvents.kind, "milestone"));
    expect(seeded.length).toBeGreaterThan(0);
    expect(rows).toContainEqual(expect.objectContaining({
      kind: "milestone",
      description: seeded[0].description,
      link: { milestoneId: seeded[0].milestoneId },
    }));
  });

  it("exports the same rows as CSV", async () => {
    const request = await addRequest();
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    await captureOrderForRequest(db, orderId, deps());

    const rows = (await loadLedger(db, DEMO.projectId))!;
    const lines = ledgerToCsv(rows).trim().split("\r\n");
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines.find((line) => line.includes(`CAP-${orderId}`)))
      .toContain(`payment,USD 303.89 was paid through PayPal to Mlima Hardware.,39500.00,KES,303.89,${orderId},CAP-${orderId},${request.id},`);
  });

  it("is null for a project that doesn't exist", async () => {
    expect(await loadLedger(db, "nope")).toBeNull();
  });
});

describe("holds from proof verdicts (Day 12)", () => {
  const holdMilestone = () => db.update(s.milestones).set({ status: "held" }).where(eq(s.milestones.id, "m2"));

  it("refuses a new order while another request on the milestone is held, without calling PayPal", async () => {
    await addRequest({ milestoneId: "m2", status: "held" });
    const request = await addRequest({ milestoneId: "m2" });
    const outcome = await createOrderForRequest(db, request.id, deps());
    expect(outcome).toMatchObject({ ok: false, httpStatus: 409, code: "milestone_held", message: expect.stringMatching(/^Payments for this milestone are held/) });
    expect(sandbox.counts.create).toBe(0);
    expect(await paymentsFor(request.id)).toHaveLength(0);
  });

  it("refuses a new order while the milestone itself is held", async () => {
    await holdMilestone();
    const request = await addRequest({ milestoneId: "m2" });
    expect(await createOrderForRequest(db, request.id, deps())).toMatchObject({ ok: false, code: "milestone_held" });
  });

  it("refuses the capture when the hold started after the order was created, so nothing is paid", async () => {
    const request = await addRequest({ milestoneId: "m2" });
    const orderId = await createOrder(request.id);
    sandbox.approve(orderId);
    await addRequest({ milestoneId: "m2", status: "held" });

    expect(await captureOrderForRequest(db, orderId, deps())).toMatchObject({ ok: false, code: "milestone_held" });
    expect(sandbox.counts.capture).toBe(0);
    expect(await requestStatus(request.id)).toBe("awaiting_approval");
  });

  it("doesn't hold payments on other milestones", async () => {
    await holdMilestone();
    const request = await addRequest({ milestoneId: "m3" });
    expect((await createOrderForRequest(db, request.id, deps())).ok).toBe(true);
  });
});
