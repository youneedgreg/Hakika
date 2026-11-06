// Day 11: verdicts for stored proofs, on an in-memory Postgres with fake storage and a fake Twilio
// sender. Photos are made with sharp, so dHash runs for real. The code isn't read until Day 12, so
// no proof here can be Verified: the best outcome is "needs fresh proof".

import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProofCheck } from "@/shared/types";
import type { AnyDb } from "@/server/db/client";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { submitCaptureProof, type CaptureDeps } from "@/server/proofs/capture";
import { issueProofRequest } from "@/server/proofs/requests";
import { isWellFormedProofId, loadProofReview, proofImageResponse } from "@/server/proofs/review";
import { verifyProof, verifyStoredProof } from "@/server/proofs/verdicts";
import { findContactById, processInbound, type IntakeDeps } from "@/server/whatsapp/intake";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const START = new Date("2026-11-07T09:00:00Z");
const at = (minutes: number) => () => new Date(START.getTime() + minutes * 60_000);
// The demo site is at -0.4201, 36.9476 with a 150 m radius.
const ON_SITE = { lat: -0.42016, lng: 36.94771, accuracyM: 12 };
const FAR_AWAY = { lat: -0.0917, lng: 37.0062, accuracyM: 20 };

// A 64×48 test photo: brightness rising away from a point that `seed` moves.
async function photo(seed: number) {
  const raw = Buffer.alloc(64 * 48);
  const cx = 16 + seed * 5;
  const cy = 12 + seed * 3;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) raw[y * 64 + x] = Math.min(255, Math.hypot(x - cx, y - cy) * 5);
  return new Uint8Array(await sharp(raw, { raw: { width: 64, height: 48, channels: 1 } }).jpeg({ quality: 90 }).toBuffer());
}

let paid = 0;
// A captured cement payment waiting for proof.
async function paidDelivery(minute: number) {
  const [request] = await db.insert(s.requests).values({
    projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, status: "paid",
    quotedSupplierName: "Baraka Hardware", quotedTotalKesCents: 4_750_000,
    recommendedSupplierId: DEMO.supplierIds.mlima, recommendedTotalKesCents: 3_950_000,
  }).returning();
  const [payment] = await db.insert(s.payments).values({
    projectId: DEMO.projectId, kind: "materials", requestId: request.id, payeeSupplierId: DEMO.supplierIds.mlima,
    payeeEmail: "mlima@example.com", amountKesCents: 3_950_000, amountUsdCents: 30_396, kesPerUsd: "129.95",
    status: "captured", paypalRequestId: `capture-${++paid}`, paypalOrderId: `ORD-${paid}`,
    paypalCaptureId: `CAP-${paid}`, capturedAt: at(minute - 60)(),
  }).returning();
  return { request, payment };
}

// The same, with a code issued for it at `minute`.
async function deliveryWithCode(minute: number) {
  const { request, payment } = await paidDelivery(minute);
  const link = await issueProofRequest({ db, now: at(minute) }, {
    projectId: DEMO.projectId, milestoneId: "m2", paymentId: payment.id, contactId: DEMO.contactIds.peter, purpose: "delivery",
  });
  return { request, payment, link };
}

function captureDeps(minute: number) {
  return {
    db,
    now: at(minute),
    storeFile: vi.fn(async (path: string) => path),
    deleteFile: vi.fn(async () => undefined),
  } satisfies CaptureDeps;
}

async function upload(minute: number, token: string, bytes: Uint8Array, place = ON_SITE) {
  const result = await submitCaptureProof(captureDeps(minute), token, {
    image: { bytes, contentType: "image/jpeg" }, ...place, clientTime: at(minute)(),
  });
  if (!("proofId" in result)) throw new Error(`upload refused: ${result.problem}`);
  return result.proofId;
}

const verdictOf = async (proofId: string) => (await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, proofId)))[0];
const check = (checks: ProofCheck[], name: ProofCheck["name"]) => checks.find((c) => c.name === name);
const verdictAudits = () => db.select().from(s.auditEvents).where(eq(s.auditEvents.kind, "verdict")).orderBy(asc(s.auditEvents.at), asc(s.auditEvents.id));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  vi.stubEnv("PROOF_LINK_BASE_URL", "https://tryhakika.vercel.app");
  await db.delete(s.messages);
  await resetDemo(db);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("verdicts for capture-page proofs", () => {
  it("records a verdict for a fresh, new photo taken on site, with a money-trail row", async () => {
    const { request, payment, link } = await deliveryWithCode(0);
    const proofId = await upload(6, link.token, await photo(1));

    const verdict = await verdictOf(proofId);
    expect(verdict.outcome).toBe("needs_fresh_proof"); // the code isn't read until Day 12
    expect(verdict.checks.map((c) => [c.name, c.result])).toEqual([
      ["code", "unknown"], ["freshness", "pass"], ["duplicate", "pass"], ["location", "pass"],
      ["screen_or_print", "unknown"], ["expected_items", "unknown"], ["consistency", "unknown"],
    ]);
    expect(check(verdict.checks, "freshness")?.detail).toBe("Uploaded 6 minutes after the code was issued.");
    expect(check(verdict.checks, "location")?.evidence?.distanceM).toBeLessThan(20);
    expect(verdict.explanation).toMatch(/^Fresh proof needed\. Not yet confirmed: the code, /);

    const [audit] = await verdictAudits();
    expect(audit).toMatchObject({
      action: "verdict.recorded", actor: "system", proofId, requestId: request.id, paymentId: payment.id, milestoneId: "m2",
      description: expect.stringContaining(`Proof photo for code ${link.code} checked: needs fresh proof.`),
      data: expect.objectContaining({ outcome: "needs_fresh_proof", previousOutcome: null }),
    });
  });

  it("marks a reused photo Suspicious and points at the earlier proof", async () => {
    const first = await deliveryWithCode(0);
    const firstProof = await upload(5, first.link.token, await photo(1));

    const second = await deliveryWithCode(60);
    const resaved = new Uint8Array(await sharp(await photo(1)).resize(48).jpeg({ quality: 55 }).toBuffer());
    const reused = await upload(64, second.link.token, resaved);

    const verdict = await verdictOf(reused);
    expect(verdict.outcome).toBe("suspicious");
    expect(check(verdict.checks, "duplicate")).toMatchObject({
      result: "fail", hard: true, evidence: { matchImageUrl: `/api/proofs/${firstProof}/image`, hamming: expect.any(Number) },
    });
    expect(verdict.explanation).toMatch(/^Suspicious\. Matches a proof sent on 7 November/);
    // The earlier proof's verdict is untouched.
    expect((await verdictOf(firstProof)).outcome).toBe("needs_fresh_proof");
  });

  it("passes a different photo of the next delivery", async () => {
    const first = await deliveryWithCode(0);
    await upload(5, first.link.token, await photo(1));
    const second = await deliveryWithCode(60);
    const next = await upload(64, second.link.token, await photo(5));
    expect(check((await verdictOf(next)).checks, "duplicate")?.result).toBe("pass");
  });

  it("marks a photo taken far from the site Suspicious", async () => {
    const { link } = await deliveryWithCode(0);
    const proofId = await upload(8, link.token, await photo(1), FAR_AWAY);
    const verdict = await verdictOf(proofId);
    expect(verdict.outcome).toBe("suspicious");
    expect(check(verdict.checks, "location")).toMatchObject({ result: "fail", detail: expect.stringMatching(/^Taken 37\.1 km from the site pin/) });
  });

  it("keeps an owner's override when the proof is checked again", async () => {
    const { link } = await deliveryWithCode(0);
    const proofId = await upload(8, link.token, await photo(1), FAR_AWAY);
    await db.update(s.verdicts).set({ overriddenAt: at(20)(), overrideReason: "I was on site myself.", overriddenBy: DEMO.ownerId })
      .where(eq(s.verdicts.proofId, proofId));

    const again = await verifyProof({ db }, proofId);
    expect(again).toMatchObject({ status: "overridden", outcome: "suspicious" });
    expect(await verdictAudits()).toHaveLength(1);
    expect((await verdictOf(proofId)).overrideReason).toBe("I was on site myself.");
  });

  it("logs a failed check instead of failing the upload", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { transaction: async () => { throw new Error("database down"); } } as unknown as AnyDb;
    expect(await verifyStoredProof({ db: broken }, "prf_x")).toBeNull();
    expect(error).toHaveBeenCalledWith("Verifying proof prf_x failed:", expect.any(Error));
    expect(await verifyProof({ db }, "prf_missing")).toBeNull();
  });
});

describe("verdicts for WhatsApp proofs", () => {
  const send = vi.fn<(to: string, body: string) => Promise<string>>(async () => `SMreply${++sid}`);
  let sid = 0;
  function intake(bytes: Uint8Array): IntakeDeps {
    return {
      db,
      loadMedia: vi.fn(async () => ({ bytes, contentType: "image/jpeg", extension: "jpg" })),
      storeMedia: vi.fn(async (path: string) => path),
      send,
      afterReply: vi.fn(async () => undefined),
    };
  }
  const whatsapp = () => ({ channel: "whatsapp" as const, twilioSid: `SMv${++sid}`, replyTo: "+254799999999" });
  const peter = () => findContactById(db, DEMO.contactIds.peter);

  it("checks a photo without a location as unknown, then rechecks when the pin arrives", async () => {
    const deps = intake(await photo(1));
    // Real time here: processInbound uses the clock, so the code is issued now.
    await paidDelivery(0);
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "text", text: "PROOF" });
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "image", media: { url: "https://api.twilio.com/m" } });

    const [proof] = await db.select().from(s.proofs);
    let verdict = await verdictOf(proof.id);
    expect(check(verdict.checks, "location")).toMatchObject({ result: "unknown", detail: "No location was shared with the photo." });
    expect(verdict.outcome).toBe("needs_fresh_proof");

    await processInbound(deps, await peter(), { ...whatsapp(), kind: "location", location: { lat: -0.4202, lng: 36.9477 } });
    verdict = await verdictOf(proof.id);
    expect(check(verdict.checks, "location")).toMatchObject({
      result: "pass", detail: expect.stringMatching(/within the 150 m site radius\.$/), // a pin earns no accuracy allowance
    });
    expect(await db.select().from(s.verdicts)).toHaveLength(1);
    const audits = await verdictAudits();
    expect(audits.map((a) => a.action)).toEqual(["verdict.recorded", "verdict.rechecked"]);
    expect(audits[1].description).toContain("checked again after its location arrived");
  });

  it("fails a pin just outside the radius, with no accuracy allowance", async () => {
    const deps = intake(await photo(1));
    await paidDelivery(0);
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "text", text: "PROOF" });
    // About 170 m north of the site pin: inside 150 m + any GPS allowance, but a pin gets none.
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "location", location: { lat: -0.41857, lng: 36.9476 } });
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "image", media: { url: "https://api.twilio.com/m" } });

    const [proof] = await db.select().from(s.proofs);
    const verdict = await verdictOf(proof.id);
    expect(check(verdict.checks, "location")?.result).toBe("fail");
    expect(verdict.outcome).toBe("suspicious");
  });
});

describe("the proof review and photo", () => {
  it("serves the stored verdict with the site, the capture point and the photo's URL", async () => {
    const { link } = await deliveryWithCode(0);
    const proofId = await upload(6, link.token, await photo(1));
    const review = await loadProofReview({ db }, proofId);
    const verdict = await verdictOf(proofId);
    expect(review).toEqual({
      proofId,
      imageUrl: `/api/proofs/${proofId}/image`,
      receivedAt: at(6)().toISOString(),
      capture: { lat: ON_SITE.lat, lng: ON_SITE.lng, accuracyM: 12 },
      site: { lat: -0.4201, lng: 36.9476, radiusM: 150 },
      checks: verdict.checks,
      outcome: "needs_fresh_proof",
      explanation: verdict.explanation,
    });
    expect(await loadProofReview({ db }, "prf_AAAAAAAAAAAAAAAA")).toBeNull();
  });

  it("checks a proof whose verdict is missing, once, when it's first opened", async () => {
    const { link } = await deliveryWithCode(0);
    const proofId = await upload(6, link.token, await photo(1));
    await db.delete(s.verdicts);
    expect((await loadProofReview({ db }, proofId))?.outcome).toBe("needs_fresh_proof");
    await loadProofReview({ db }, proofId);
    expect(await db.select().from(s.verdicts)).toHaveLength(1);
  });

  it("streams the photo privately, with the stored content type", async () => {
    const { link } = await deliveryWithCode(0);
    const bytes = await photo(1);
    const proofId = await upload(6, link.token, bytes);
    const [proof] = await db.select().from(s.proofs);
    const read = vi.fn(async () => new Blob([Buffer.from(bytes)]).stream());

    const response = await proofImageResponse(db, proofId, read);
    expect(read).toHaveBeenCalledWith(proof.blobPath);
    expect(response?.headers.get("content-type")).toBe("image/jpeg");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(bytes);

    expect(await proofImageResponse(db, proofId, async () => null)).toBeNull(); // gone from storage
    expect(await proofImageResponse(db, "prf_AAAAAAAAAAAAAAAA", read)).toBeNull();
  });

  it("knows a proof ID's shape", () => {
    expect(isWellFormedProofId("prf_AAAAAAAAAAAAAAAA")).toBe(true);
    for (const id of ["prf_short", "prq_AAAAAAAAAAAAAAAA", "prf_AAAAAAAAAAAAAAA/", "proof-cement-delivery"]) {
      expect(isWellFormedProofId(id)).toBe(false);
    }
  });
});
