// Day 13: the milestone flow, on an in-memory Postgres with fake storage, a fake vision model, a fake
// Twilio sender and a fake PayPal sandbox. The foreman says DONE, a progress proof verifies the
// milestone, Otieno's labour is paid through PayPal, and the next milestone starts. A photo that
// fails brings a fresh code (at most three on their own); the owner can override with a reason.
// Photos are made with sharp, so dHash runs for real.

import { PGlite } from "@electric-sql/pglite";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProofInspection, ProofReading, ProofVision } from "@/server/ai/proof-vision";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { sendPaymentConfirmations } from "@/server/payments/confirmations";
import { captureOrderForRequest, createOrderForMilestone, createOrderForRequest, type PaymentDeps } from "@/server/payments/orders";
import type { PayPalClient, PayPalOrder } from "@/server/payments/paypal";
import { handlePayPalEvent } from "@/server/payments/webhooks";
import { centsToAmount } from "@/server/pricing/money";
import { submitCaptureProof } from "@/server/proofs/capture";
import { isDoneKeyword } from "@/server/proofs/codes";
import { type FreshProofDeps, MAX_AUTO_FRESH_REQUESTS, requestFreshProof } from "@/server/proofs/fresh";
import { milestoneHold } from "@/server/proofs/holds";
import { overrideVerdict } from "@/server/proofs/override";
import { issueProofRequest } from "@/server/proofs/requests";
import { findContactById, type InboundMessage, processInbound, type IntakeDeps } from "@/server/whatsapp/intake";
import type { Notifier } from "@/server/whatsapp/notify";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const START = new Date("2026-11-08T09:00:00Z");
const at = (minutes: number) => () => new Date(START.getTime() + minutes * 60_000);
// The demo site is at -0.4201, 36.9476 with a 150 m radius.
const ON_SITE = { lat: -0.42016, lng: 36.94771, accuracyM: 12 };
const FAR_AWAY = { lat: -0.0917, lng: 37.0062, accuracyM: 20 };
const LINK_BASE = "https://tryhakika.vercel.app";
const PETER_PHONE = "whatsapp:+15550000001";
const OTIENO_PHONE = "whatsapp:+15550000002";
const OTIENO_EMAIL = "otieno@personal.example.com";
const MLIMA_EMAIL = "mlima@business.example.com";

// A 64×48 test photo: brightness rising away from a point that `seed` moves.
async function photo(seed: number) {
  const raw = Buffer.alloc(64 * 48);
  const cx = 8 + seed * 5;
  const cy = 6 + seed * 3;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) raw[y * 64 + x] = Math.min(255, Math.hypot(x - cx, y - cy) * 5);
  return new Uint8Array(await sharp(raw, { raw: { width: 64, height: 48, channels: 1 } }).jpeg({ quality: 90 }).toBuffer());
}

const sees = (reading: Partial<ProofReading>): ProofInspection => ({
  outcome: "inspected",
  reading: { code: null, medium: "scene", mediumReason: "A finished foundation.", itemsSeen: [], sameSite: "same", sameSiteReason: "Same plot.", ...reading },
  raw: { fake: true },
  usage: { inputTokens: 900, outputTokens: 120 },
});

// Reads the code of the request the photo answered, like a model that can read handwriting.
const readsCode = (reading: Partial<ProofReading> = {}): ProofVision => ({
  modelId: "eu.amazon.nova-2-lite-v1:0",
  inspect: vi.fn<ProofVision["inspect"]>(async () => {
    const [request] = await db.select().from(s.proofRequests).where(eq(s.proofRequests.status, "used"))
      .orderBy(desc(s.proofRequests.usedAt)).limit(1);
    return sees({ code: request.code, ...reading });
  }),
  readPhoto: vi.fn<ProofVision["readPhoto"]>(async (path) => ({ bytes: new TextEncoder().encode(path), contentType: "image/jpeg" })),
});

let sent: { to: string; body: string }[];
function notifier(channel: Notifier["channel"] = "whatsapp", phones: [string, string][] = [[PETER_PHONE, DEMO.contactIds.peter]]): Notifier {
  return {
    channel,
    send: vi.fn(async (to: string, body: string) => {
      sent.push({ to, body });
      return `SM${sent.length}`;
    }),
    testPhones: new Map(phones),
  };
}
const fresh = (n = notifier()): FreshProofDeps => ({ notifier: n, linkBase: LINK_BASE });

async function upload(minute: number, token: string, bytes: Uint8Array, place = ON_SITE, vision: ProofVision = readsCode(), freshDeps: FreshProofDeps | undefined = fresh()) {
  const result = await submitCaptureProof({
    db, now: at(minute), vision, fresh: freshDeps,
    storeFile: vi.fn(async (path: string) => path),
    deleteFile: vi.fn(async () => undefined),
  }, token, { image: { bytes, contentType: "image/jpeg" }, ...place, clientTime: at(minute)() });
  if (!("proofId" in result)) throw new Error(`upload refused: ${result.problem}`);
  return result.proofId;
}

// A progress code for the foundation (m2), as DONE issues it.
const progressCode = (minute: number) => issueProofRequest({ db, now: at(minute) }, {
  projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, purpose: "progress",
});

const milestone = async (id = "m2") => (await db.select().from(s.milestones).where(eq(s.milestones.id, id)))[0];
const progressRequests = () => db.select().from(s.proofRequests)
  .where(and(eq(s.proofRequests.milestoneId, "m2"), eq(s.proofRequests.purpose, "progress"))).orderBy(asc(s.proofRequests.issuedAt));
const actions = async (action: string) => db.select().from(s.auditEvents).where(eq(s.auditEvents.action, action)).orderBy(asc(s.auditEvents.at));
const outbound = (templateKey: string) => db.select().from(s.messages)
  .where(and(eq(s.messages.direction, "outbound"), eq(s.messages.templateKey, templateKey))).orderBy(asc(s.messages.createdAt));
const verdictOf = async (proofId: string) => (await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, proofId)))[0];
const codeIn = (body: string) => body.match(/new code is ([A-Z0-9]{4})/)?.[1];
const tokenIn = (body: string) => body.match(/\/proof\/([A-Za-z0-9_-]{43})/)?.[1];

// A fake PayPal sandbox: orders must be approved before capture; captures answer COMPLETED unless told otherwise.
function fakeSandbox() {
  const orders = new Map<string, { order: PayPalOrder; approved: boolean; body: Parameters<PayPalClient["createOrder"]>[0] }>();
  let next: "COMPLETED" | "PENDING" | "DECLINED" = "COMPLETED";
  const captured = (id: string, status: string, value: string): PayPalOrder => ({
    id, status: status === "COMPLETED" ? "COMPLETED" : "APPROVED",
    purchase_units: [{ payments: { captures: [{ id: `CAP-${id}`, status: status as "COMPLETED", amount: { currency_code: "USD", value } }] } }],
  });
  const paypal: PayPalClient = {
    async createOrder(body) {
      const id = `ORDER${orders.size + 1}`;
      orders.set(id, { order: { id, status: "PAYER_ACTION_REQUIRED" }, approved: false, body });
      return { id, status: "PAYER_ACTION_REQUIRED" };
    },
    async getOrder(orderId) {
      return orders.get(orderId)?.order ?? null;
    },
    async captureOrder(orderId) {
      const stored = orders.get(orderId)!;
      stored.order = captured(orderId, next, stored.body.usdAmount);
      return stored.order;
    },
    async verifyWebhookSignature() {
      return true;
    },
  };
  return {
    paypal,
    orders,
    approve: (orderId: string) => { orders.get(orderId)!.approved = true; },
    captureWill: (status: typeof next) => { next = status; },
    completeLater: (orderId: string) => {
      const stored = orders.get(orderId)!;
      stored.order = captured(orderId, "COMPLETED", stored.body.usdAmount);
    },
  };
}

let sandbox: ReturnType<typeof fakeSandbox>;
let paidIds: string[];
const payDeps = (): PaymentDeps => ({
  paypal: sandbox.paypal,
  appUrl: LINK_BASE,
  rate: async () => ({ kesPerUsd: "129.980973" }),
  now: at(120),
  onPaid: (ids) => { paidIds.push(...ids); },
});

async function payLabour(milestoneId = "m2") {
  const created = await createOrderForMilestone(db, milestoneId, payDeps());
  if (!created.ok) throw new Error(`create failed: ${created.code}`);
  sandbox.approve(created.value.orderId);
  return { orderId: created.value.orderId, captured: await captureOrderForRequest(db, created.value.orderId, payDeps()) };
}

// The foundation with a verified progress proof: what DONE and a good photo lead to.
async function verifiedFoundation() {
  const code = await progressCode(0);
  const proofId = await upload(5, code.token, await photo(1));
  expect((await verdictOf(proofId)).outcome).toBe("verified");
  return proofId;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  vi.stubEnv("PROOF_LINK_BASE_URL", LINK_BASE);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await db.delete(s.messages);
  await db.delete(s.webhookEvents);
  await db.delete(s.auditEvents);
  await db.delete(s.payments);
  await db.delete(s.requests);
  await resetDemo(db, { otieno: OTIENO_EMAIL, mlima: MLIMA_EMAIL });
  sent = [];
  paidIds = [];
  sandbox = fakeSandbox();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the foreman's DONE reply", () => {
  const intakeDeps = (): IntakeDeps => ({
    db,
    loadMedia: vi.fn(),
    storeMedia: vi.fn(),
    send: vi.fn(async (to: string, body: string) => {
      sent.push({ to, body });
      return `SM${sent.length}`;
    }),
  });
  const text = (body: string): InboundMessage => ({
    channel: "whatsapp", kind: "text", text: body, replyTo: PETER_PHONE, twilioSid: `SM-in-${Math.random()}`,
  } as InboundMessage);

  it("matches DONE and IMEKAMILIKA exactly, and nothing longer", () => {
    for (const word of ["DONE", "done.", " Imekamilika! "]) expect(isDoneKeyword(word)).toBe(true);
    for (const word of ["done now", "is it done", "", undefined]) expect(isDoneKeyword(word)).toBe(false);
  });

  it("sends a progress code for the milestone in progress and makes it wait for proof", async () => {
    const peter = (await findContactById(db, DEMO.contactIds.peter))!;
    await processInbound(intakeDeps(), peter, text("done"));

    const [request] = await progressRequests();
    expect(request).toMatchObject({ purpose: "progress", status: "issued", paymentId: null, contactId: DEMO.contactIds.peter });
    expect((await milestone()).status).toBe("awaiting_proof");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain(`kwa Foundation ni ${request.code}`); // Peter's language is Swahili
    const [stored] = await outbound("proof_request");
    expect(stored.body).toContain("/proof/[link hidden]");
    expect(stored.body).not.toContain(tokenIn(sent[0].body)!);
  });

  it("answers no_milestone_due to anyone but a foreman, and when nothing is in progress", async () => {
    const otieno = (await findContactById(db, DEMO.contactIds.otieno))!;
    await processInbound(intakeDeps(), otieno, text("DONE"));
    await db.update(s.milestones).set({ status: "planned" }).where(eq(s.milestones.id, "m2"));
    const peter = (await findContactById(db, DEMO.contactIds.peter))!;
    await processInbound(intakeDeps(), peter, text("DONE"));

    expect(await progressRequests()).toEqual([]);
    expect(await outbound("no_milestone_due")).toHaveLength(2);
  });
});

describe("fresh proof after a photo fails", () => {
  it("holds the milestone on a Suspicious progress proof and sends Peter a new code, once", async () => {
    const code = await progressCode(0);
    const proofId = await upload(5, code.token, await photo(1), FAR_AWAY);

    expect((await verdictOf(proofId)).outcome).toBe("suspicious");
    expect((await milestone()).status).toBe("held");
    const [old, renewed] = await progressRequests();
    expect(old).toMatchObject({ id: code.id, status: "used" });
    expect(renewed).toMatchObject({ status: "issued", replacesId: code.id, contactId: DEMO.contactIds.peter });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PETER_PHONE);
    expect(codeIn(sent[0].body)).toBeUndefined(); // Swahili copy
    expect(sent[0].body).toContain(`Nambari mpya ya uthibitisho ni ${renewed.code}`);
    // Says what's needed, never why. The link is left out: its random token can contain "km".
    expect(sent[0].body.replace(/https?:\/\/\S+/g, "")).not.toMatch(/km|location check|suspicious/i);
    const [message] = await outbound("fresh_proof_request");
    expect(message.body).toContain("/proof/[link hidden]");
    const [audit] = await actions("proof.fresh_requested");
    expect(audit).toMatchObject({ milestoneId: "m2", paymentId: null, actor: "system" });

    // Checking the same proof again (a recheck) doesn't send another code.
    expect(await requestFreshProof({ db, fresh: fresh() }, proofId)).toBe("already_asked");
    expect(await progressRequests()).toHaveLength(2);
  });

  it("releases the milestone when the fresh proof passes", async () => {
    await upload(5, (await progressCode(0)).token, await photo(1), FAR_AWAY);
    const token = tokenIn(sent[0].body)!;
    const proofId = await upload(15, token, await photo(4));

    expect((await verdictOf(proofId)).outcome).toBe("verified");
    expect((await milestone()).status).toBe("verified");
    expect(await milestoneHold(db, "m2")).toBeNull();
    expect(sent).toHaveLength(1); // no new code for a photo that passed
  });

  it("also sends a new code when a proof only needs a fresh photo, and the milestone keeps waiting", async () => {
    const code = await progressCode(0);
    const proofId = await upload(5, code.token, await photo(1), ON_SITE, readsCode({ medium: "screen" }));
    expect((await verdictOf(proofId)).outcome).toBe("needs_fresh_proof");
    expect((await milestone()).status).toBe("awaiting_proof");
    expect(await outbound("fresh_proof_request")).toHaveLength(1);
  });

  it("stops after three automatic codes for the same milestone, and notes it once", async () => {
    let token = (await progressCode(0)).token;
    for (let i = 0; i < MAX_AUTO_FRESH_REQUESTS; i++) {
      await upload(5 + i * 10, token, await photo(i + 1), FAR_AWAY);
      token = tokenIn(sent.at(-1)!.body)!;
    }
    expect(sent).toHaveLength(MAX_AUTO_FRESH_REQUESTS);
    const last = await upload(40, token, await photo(5), FAR_AWAY);

    expect(sent).toHaveLength(MAX_AUTO_FRESH_REQUESTS);
    expect(await requestFreshProof({ db, fresh: fresh() }, last)).toBe("limit_reached");
    const noted = await actions("proof.fresh_limit_reached");
    expect(noted).toHaveLength(1);
    expect(noted[0].description).toContain("The owner can override with a reason");
    expect((await milestone()).status).toBe("held");
  });

  it("stores the code unsent for a contact with no test phone, and in Judge Mode", async () => {
    await upload(5, (await progressCode(0)).token, await photo(1), FAR_AWAY, readsCode(), fresh(notifier("whatsapp", [])));
    await upload(15, (await progressCode(10)).token, await photo(2), FAR_AWAY, readsCode(), fresh(notifier("simulator")));

    expect(sent).toEqual([]);
    const stored = await outbound("fresh_proof_request");
    expect(stored.map((m) => [m.channel, m.twilioSid])).toEqual([["whatsapp", null], ["simulator", null]]);
  });

  it("waits for the location pin of a WhatsApp photo instead of sending a new code", async () => {
    const code = await progressCode(0);
    const [request] = await progressRequests();
    await db.insert(s.proofs).values({
      id: "prf_whatsappnopin0001", projectId: DEMO.projectId, proofRequestId: request.id, source: "whatsapp",
      blobPath: "whatsapp/msg.jpg", contentType: "image/jpeg", sizeBytes: 10, dhash: "0".repeat(16), receivedAt: at(5)(),
    });
    await db.update(s.proofRequests).set({ status: "used", usedAt: at(5)() }).where(eq(s.proofRequests.id, code.id));
    await db.insert(s.verdicts).values({ proofId: "prf_whatsappnopin0001", outcome: "needs_fresh_proof", checks: [], explanation: "Fresh proof needed." });

    expect(await requestFreshProof({ db, fresh: fresh() }, "prf_whatsappnopin0001")).toBe("waiting_for_location");
    expect(sent).toEqual([]);
  });

  it("sends a new code for a failed delivery proof too, and none once the delivery has moved on", async () => {
    const [request] = await db.insert(s.requests).values({
      projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, status: "paid",
      quotedSupplierName: "Baraka Hardware", quotedTotalKesCents: 4_750_000,
    }).returning();
    const [payment] = await db.insert(s.payments).values({
      projectId: DEMO.projectId, kind: "materials", requestId: request.id, payeeSupplierId: DEMO.supplierIds.mlima,
      payeeEmail: MLIMA_EMAIL, amountKesCents: 3_950_000, amountUsdCents: 30_389, kesPerUsd: "129.98",
      status: "captured", paypalRequestId: "capture-d1", paypalOrderId: "ORD-d1", paypalCaptureId: "CAP-d1", capturedAt: at(-60)(),
    }).returning();
    const code = await issueProofRequest({ db, now: at(0) }, {
      projectId: DEMO.projectId, milestoneId: "m2", paymentId: payment.id, contactId: DEMO.contactIds.peter, purpose: "delivery",
    });
    const proofId = await upload(5, code.token, await photo(1), FAR_AWAY);

    expect((await db.select().from(s.requests).where(eq(s.requests.id, request.id)))[0].status).toBe("held");
    const [audit] = await actions("proof.fresh_requested");
    expect(audit).toMatchObject({ paymentId: payment.id, milestoneId: "m2" });

    await db.update(s.requests).set({ status: "verified" }).where(eq(s.requests.id, request.id));
    await db.delete(s.proofRequests).where(eq(s.proofRequests.replacesId, code.id));
    expect(await requestFreshProof({ db, fresh: fresh() }, proofId)).toBe("not_needed");
  });
});

describe("the owner's override", () => {
  it("verifies a held milestone with a logged reason and closes the open fresh code", async () => {
    const proofId = await upload(5, (await progressCode(0)).token, await photo(1), FAR_AWAY);
    const result = await overrideVerdict({ db, now: at(30) }, proofId, "I visited the site on Saturday and saw the foundation.");

    expect(result).toEqual({
      ok: true,
      value: { proofId, overridden: true, reason: "I visited the site on Saturday and saw the foundation.", at: at(30)().toISOString() },
    });
    expect((await milestone()).status).toBe("verified");
    expect(await verdictOf(proofId)).toMatchObject({ overriddenBy: DEMO.ownerId, overrideReason: "I visited the site on Saturday and saw the foundation." });
    expect((await progressRequests()).map((r) => r.status)).toEqual(["used", "superseded"]);
    const [audit] = await db.select().from(s.auditEvents).where(eq(s.auditEvents.kind, "override"));
    expect(audit).toMatchObject({
      action: "verdict.overridden", actor: `owner:${DEMO.ownerId}`, proofId, milestoneId: "m2",
      description: expect.stringContaining('which was suspicious. Reason: "I visited the site on Saturday and saw the foundation."'),
    });
  });

  it("answers a repeated override with the first one, and refuses a verified proof", async () => {
    const held = await upload(5, (await progressCode(0)).token, await photo(1), FAR_AWAY);
    await overrideVerdict({ db, now: at(30) }, held, "Seen in person.");
    expect(await overrideVerdict({ db, now: at(31) }, held, "Clicked twice.")).toMatchObject({
      ok: true, value: { reason: "Seen in person.", at: at(30)().toISOString() },
    });
    expect(await db.select().from(s.auditEvents).where(eq(s.auditEvents.kind, "override"))).toHaveLength(1);

    await resetDemo(db, { otieno: OTIENO_EMAIL });
    const good = await verifiedFoundation();
    expect(await overrideVerdict({ db }, good, "No reason.")).toMatchObject({ ok: false, httpStatus: 409, code: "nothing_to_override" });
  });

  it("releases a held delivery, so payments on its milestone can go ahead", async () => {
    const [request] = await db.insert(s.requests).values({
      projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, status: "paid", quotedSupplierName: "Baraka Hardware",
    }).returning();
    const [payment] = await db.insert(s.payments).values({
      projectId: DEMO.projectId, kind: "materials", requestId: request.id, payeeSupplierId: DEMO.supplierIds.mlima,
      payeeEmail: MLIMA_EMAIL, amountKesCents: 3_950_000, amountUsdCents: 30_389, kesPerUsd: "129.98",
      status: "captured", paypalRequestId: "capture-d2", paypalOrderId: "ORD-d2", paypalCaptureId: "CAP-d2", capturedAt: at(-60)(),
    }).returning();
    const code = await issueProofRequest({ db, now: at(0) }, {
      projectId: DEMO.projectId, milestoneId: "m2", paymentId: payment.id, contactId: DEMO.contactIds.peter, purpose: "delivery",
    });
    const proofId = await upload(5, code.token, await photo(1), FAR_AWAY);
    expect(await milestoneHold(db, "m2")).not.toBeNull();

    expect((await overrideVerdict({ db }, proofId, "The supplier confirmed delivery by phone.")).ok).toBe(true);
    expect((await db.select().from(s.requests).where(eq(s.requests.id, request.id)))[0].status).toBe("verified");
    expect(await milestoneHold(db, "m2")).toBeNull();
  });

  it("404s an unknown proof and refuses one whose milestone has moved on", async () => {
    expect(await overrideVerdict({ db }, "prf_doesnotexist00001", "Reason here.")).toMatchObject({ ok: false, httpStatus: 404 });
    const proofId = await upload(5, (await progressCode(0)).token, await photo(1), FAR_AWAY);
    await db.update(s.milestones).set({ status: "verified" }).where(eq(s.milestones.id, "m2"));
    expect(await overrideVerdict({ db }, proofId, "Reason here.")).toMatchObject({ ok: false, httpStatus: 409, code: "not_waiting" });
  });
});

describe("paying the fundi's labour", () => {
  it("pays Otieno the milestone's labour from the database, marks it paid and starts the next milestone", async () => {
    await verifiedFoundation();
    const { orderId, captured } = await payLabour();

    const order = sandbox.orders.get(orderId)!.body;
    const [payment] = await db.select().from(s.payments).where(eq(s.payments.kind, "labour"));
    expect(order).toMatchObject({
      referenceId: "m2", payeeEmail: OTIENO_EMAIL, usdAmount: centsToAmount(payment.amountUsdCents),
      description: "Hakika (sandbox): labour for Foundation",
      returnUrl: `${LINK_BASE}/projects/${DEMO.projectId}/gantt?milestone=m2&paypal=approved`,
    });
    expect(payment).toMatchObject({
      kind: "labour", milestoneId: "m2", requestId: null, payeeContactId: DEMO.contactIds.otieno, payeeSupplierId: null,
      amountKesCents: 8_500_000, status: "captured", paypalCaptureId: `CAP-${orderId}`,
    });
    expect(captured).toEqual({ ok: true, value: { milestoneId: "m2", status: "paid", captureId: `CAP-${orderId}` } });
    expect((await milestone()).status).toBe("paid");
    expect((await milestone("m3")).status).toBe("in_progress");
    expect(paidIds).toEqual([payment.id]);
    const [capturedAudit] = await actions("payment.captured");
    expect(capturedAudit).toMatchObject({ milestoneId: "m2", requestId: null, description: expect.stringContaining("paid through PayPal to Otieno.") });
    expect(capturedAudit.description).not.toContain(OTIENO_EMAIL);
    expect((await actions("milestone.started"))[0]).toMatchObject({ milestoneId: "m3" });
  });

  it("refuses while the milestone is held or not yet verified, without calling PayPal", async () => {
    await upload(5, (await progressCode(0)).token, await photo(1), FAR_AWAY);
    expect(await createOrderForMilestone(db, "m2", payDeps())).toMatchObject({ ok: false, httpStatus: 409, code: "not_verified" });
    expect(await createOrderForMilestone(db, "m3", payDeps())).toMatchObject({ ok: false, code: "not_verified" });
    expect(sandbox.orders.size).toBe(0);
  });

  it("refuses while a delivery on the verified milestone is held", async () => {
    await verifiedFoundation();
    await db.insert(s.requests).values({ projectId: DEMO.projectId, milestoneId: "m2", status: "held", quotedSupplierName: "Baraka Hardware" });
    expect(await createOrderForMilestone(db, "m2", payDeps())).toMatchObject({ ok: false, code: "milestone_held" });
  });

  it("refuses when the fundi has no PayPal account", async () => {
    await resetDemo(db);
    await verifiedFoundation();
    expect(await createOrderForMilestone(db, "m2", payDeps())).toMatchObject({ ok: false, code: "no_payee" });
  });

  it("reuses the open order on a second click and answers a repeated capture without paying again", async () => {
    await verifiedFoundation();
    const first = await createOrderForMilestone(db, "m2", payDeps());
    const again = await createOrderForMilestone(db, "m2", payDeps());
    expect(again).toEqual(first);
    const orderId = (first as { value: { orderId: string } }).value.orderId;
    sandbox.approve(orderId);
    await captureOrderForRequest(db, orderId, payDeps());
    expect(await captureOrderForRequest(db, orderId, payDeps())).toMatchObject({ ok: true, value: { status: "paid" } });
    expect(paidIds).toHaveLength(1);
    expect(await createOrderForMilestone(db, "m2", payDeps())).toMatchObject({ ok: false, code: "not_verified" });
  });

  it("blocks a second order while a capture is pending, and the webhook finishes it", async () => {
    await verifiedFoundation();
    sandbox.captureWill("PENDING");
    const { orderId, captured } = await payLabour();
    expect(captured).toMatchObject({ ok: true, value: { milestoneId: "m2", status: "verified" } });
    expect(await createOrderForMilestone(db, "m2", payDeps())).toMatchObject({ ok: false, code: "capture_pending" });

    sandbox.completeLater(orderId);
    const result = await handlePayPalEvent(db, {
      id: "WH-labour-1", event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: { id: `CAP-${orderId}`, supplementary_data: { related_ids: { order_id: orderId } } },
    }, payDeps());
    expect(result).toBe("recorded");
    expect((await milestone()).status).toBe("paid");
  });

  it("leaves the labour payable again after a declined capture", async () => {
    await verifiedFoundation();
    sandbox.captureWill("DECLINED");
    const { captured } = await payLabour();
    expect(captured).toMatchObject({ ok: false, httpStatus: 402, code: "capture_declined" });
    expect((await milestone()).status).toBe("verified");
    sandbox.captureWill("COMPLETED");
    expect((await payLabour()).captured).toMatchObject({ ok: true, value: { status: "paid" } });
  });

  it("can pay labour after the owner overrides a held milestone", async () => {
    const proofId = await upload(5, (await progressCode(0)).token, await photo(1), FAR_AWAY);
    await overrideVerdict({ db }, proofId, "I saw it myself.");
    expect((await payLabour()).captured).toMatchObject({ ok: true, value: { status: "paid" } });
  });

  it("tells Otieno on WhatsApp, in Swahili, with the amount from the database", async () => {
    await verifiedFoundation();
    await payLabour();
    const [payment] = await db.select().from(s.payments).where(eq(s.payments.kind, "labour"));
    const outcomes = await sendPaymentConfirmations({
      db, send: notifier().send, testPhones: new Map([[OTIENO_PHONE, DEMO.contactIds.otieno]]),
    }, payment.id);

    expect(outcomes).toEqual([{ contactId: DEMO.contactIds.otieno, sent: true }]);
    expect(sent.at(-1)).toEqual({ to: OTIENO_PHONE, body: "Hakika: mmiliki wa mradi amekulipa KES 85,000 kupitia PayPal kwa kazi ya Foundation. Asante." });
    expect((await actions("payment.confirmations"))[0]).toMatchObject({ milestoneId: "m2", requestId: null });
  });

  it("still pays a supplier for a request through the same routes", async () => {
    const [request] = await db.insert(s.requests).values({
      projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, status: "awaiting_approval",
      quotedSupplierName: "Baraka Hardware", quotedTotalKesCents: 4_750_000,
      recommendedSupplierId: DEMO.supplierIds.mlima, recommendedTotalKesCents: 3_950_000,
    }).returning();
    const created = await createOrderForRequest(db, request.id, payDeps());
    expect(created.ok).toBe(true);
    const orderId = (created as { value: { orderId: string } }).value.orderId;
    sandbox.approve(orderId);
    expect(await captureOrderForRequest(db, orderId, payDeps())).toEqual({
      ok: true, value: { requestId: request.id, status: "paid", captureId: `CAP-${orderId}` },
    });
  });
});
