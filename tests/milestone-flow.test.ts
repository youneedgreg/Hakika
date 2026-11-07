// Day 13: the milestone flow, on an in-memory Postgres with fake storage, a fake vision model and a
// fake Twilio sender. The foreman says DONE and a progress proof verifies the milestone. A photo
// that fails brings a fresh code (at most three on their own).
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
import { submitCaptureProof } from "@/server/proofs/capture";
import { isDoneKeyword } from "@/server/proofs/codes";
import { type FreshProofDeps, MAX_AUTO_FRESH_REQUESTS, requestFreshProof } from "@/server/proofs/fresh";
import { milestoneHold } from "@/server/proofs/holds";
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

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  vi.stubEnv("PROOF_LINK_BASE_URL", LINK_BASE);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await db.delete(s.messages);
  await db.delete(s.auditEvents);
  await db.delete(s.payments);
  await db.delete(s.requests);
  await resetDemo(db);
  sent = [];
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
    expect(sent[0].body).toContain(`Nambari yako mpya ni ${renewed.code}`);
    expect(sent[0].body).not.toMatch(/km|location check|suspicious/i); // says what's needed, never why
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
