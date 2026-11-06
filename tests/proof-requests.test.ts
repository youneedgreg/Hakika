// Day 10: issuing proof codes and the capture upload, on an in-memory Postgres with fake storage
// and a fake Twilio sender. Photos are made with sharp, so dHash runs for real.

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { submitCaptureProof, type CaptureDeps } from "@/server/proofs/capture";
import { generateToken, hashToken } from "@/server/proofs/codes";
import { dHash } from "@/server/proofs/dhash";
import { captureView, findByToken, issueProofRequest, recordProof } from "@/server/proofs/requests";
import { findContactById, processInbound, type IntakeDeps } from "@/server/whatsapp/intake";
import { renderTemplate } from "@/server/whatsapp/templates";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const REAL_PHONE = "+254799999999";
const LINK_BASE = "https://tryhakika.vercel.app";
const ISSUED_AT = new Date("2026-11-07T09:00:00Z");
const minutesLater = (m: number) => () => new Date(ISSUED_AT.getTime() + m * 60_000);

// A 64×48 test photo: a left-to-right gradient, or its mirror image.
async function photo(mirrored = false) {
  const raw = Buffer.alloc(64 * 48);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) raw[y * 64 + x] = (mirrored ? 63 - x : x) * 4 + (y % 7);
  return new Uint8Array(await sharp(raw, { raw: { width: 64, height: 48, channels: 1 } }).jpeg({ quality: 90 }).toBuffer());
}

async function addPaidDelivery() {
  const [request] = await db.insert(s.requests).values({
    projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, status: "paid",
    quotedSupplierName: "Baraka Hardware", quotedTotalKesCents: 4_750_000,
    recommendedSupplierId: DEMO.supplierIds.mlima, recommendedTotalKesCents: 3_950_000,
  }).returning();
  const [payment] = await db.insert(s.payments).values({
    projectId: DEMO.projectId, kind: "materials", requestId: request.id, payeeSupplierId: DEMO.supplierIds.mlima,
    payeeEmail: "mlima@example.com", amountKesCents: 3_950_000, amountUsdCents: 30_396, kesPerUsd: "129.95",
    status: "captured", paypalRequestId: `capture-${request.id}`, paypalOrderId: `ORD-${request.id}`,
    paypalCaptureId: `CAP-${request.id}`, capturedAt: new Date("2026-11-07T08:00:00Z"),
  }).returning();
  return { request, payment };
}

const requestStatus = async (id: string) =>
  (await db.select({ status: s.requests.status }).from(s.requests).where(eq(s.requests.id, id)))[0].status;
const proofRequestRows = () => db.select().from(s.proofRequests);
const auditActions = async () => (await db.select({ action: s.auditEvents.action }).from(s.auditEvents)
  .where(eq(s.auditEvents.kind, "proof"))).map((row) => row.action);

function intakeFakes() {
  return {
    db,
    loadMedia: vi.fn(async () => ({ bytes: new Uint8Array(), contentType: "image/jpeg", extension: "jpg" })),
    storeMedia: vi.fn(async (path: string) => path),
    send: vi.fn<(to: string, body: string) => Promise<string>>(async () => `SMreply${++sid}`),
    afterReply: vi.fn(async () => undefined),
  } satisfies IntakeDeps;
}

let sid = 0;
const whatsapp = () => ({ channel: "whatsapp" as const, twilioSid: `SM${++sid}`, replyTo: REAL_PHONE });
const peter = () => findContactById(db, DEMO.contactIds.peter);
const grace = () => findContactById(db, DEMO.contactIds.grace);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  vi.stubEnv("PROOF_LINK_BASE_URL", LINK_BASE);
  await db.delete(s.messages);
  await resetDemo(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("issuing a proof request", () => {
  it("answers a foreman's PROOF with a code and link, and moves the paid request to awaiting proof", async () => {
    const { request, payment } = await addPaidDelivery();
    const deps = intakeFakes();
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "text", text: "Thibitisha" });

    const [row] = await proofRequestRows();
    expect(row).toMatchObject({
      paymentId: payment.id, milestoneId: "m2", contactId: DEMO.contactIds.peter, purpose: "delivery", status: "issued",
    });
    expect(row.expiresAt.getTime() - row.issuedAt.getTime()).toBe(30 * 60_000);
    expect(await requestStatus(request.id)).toBe("awaiting_proof");

    expect(deps.send).toHaveBeenCalledOnce();
    const sent = deps.send.mock.calls[0][1];
    const token = sent.match(/\/proof\/([A-Za-z0-9_-]{43})/)![1];
    expect(sent).toContain(row.code);
    expect(sent).toContain("Foundation");
    expect(hashToken(token)).toBe(row.tokenHash);
    expect(deps.afterReply).not.toHaveBeenCalled(); // the keyword never reaches the reading models

    const [outbound] = await db.select().from(s.messages).where(eq(s.messages.direction, "outbound"));
    expect(outbound).toMatchObject({ templateKey: "proof_request", language: "sw", twilioSid: expect.stringMatching(/^SMreply/) });
    expect(outbound.body).not.toContain(token);
    expect(outbound.body).toContain("[link hidden]");
    expect(await auditActions()).toEqual(["proof.requested"]);
  });

  it("answers no_proof_due when nothing is waiting for proof, or the sender isn't a foreman", async () => {
    const deps = intakeFakes();
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "text", text: "PROOF" });
    expect(deps.send).toHaveBeenLastCalledWith(REAL_PHONE, renderTemplate("no_proof_due", "sw"));

    await addPaidDelivery();
    await processInbound(deps, await grace(), { ...whatsapp(), kind: "text", text: "PROOF" });
    expect(deps.send).toHaveBeenLastCalledWith(REAL_PHONE, renderTemplate("no_proof_due", "en"));
    expect(await proofRequestRows()).toHaveLength(0);
  });

  it("replaces the open link when the foreman asks again", async () => {
    const { payment } = await addPaidDelivery();
    const first = await issueProofRequest({ db, now: minutesLater(0) }, {
      projectId: DEMO.projectId, milestoneId: "m2", paymentId: payment.id, contactId: DEMO.contactIds.peter, purpose: "delivery",
    });
    const second = await issueProofRequest({ db, now: minutesLater(5) }, {
      projectId: DEMO.projectId, milestoneId: "m2", paymentId: payment.id, contactId: DEMO.contactIds.peter, purpose: "delivery",
    });
    expect(await findByToken({ db, now: minutesLater(6) }, first.token)).toEqual({ problem: "expired" });
    expect(await findByToken({ db, now: minutesLater(6) }, second.token)).toHaveProperty("request.id", second.id);
    const rows = await proofRequestRows();
    expect(rows.find((r) => r.id === first.id)?.status).toBe("superseded");
    expect(rows.find((r) => r.id === second.id)?.replacesId).toBe(first.id);
    expect(await auditActions()).toEqual(["proof.requested", "proof.reissued"]);
  });

  it("issues no new code once a photo is in for that delivery", async () => {
    const { payment } = await addPaidDelivery();
    const issued = await issueProofRequest({ db }, {
      projectId: DEMO.projectId, milestoneId: "m2", paymentId: payment.id, contactId: DEMO.contactIds.peter, purpose: "delivery",
    });
    await recordProof({ db }, issued.id, {
      proofId: "prf_test", source: "capture_page", blobPath: "proofs/prf_test.jpg", contentType: "image/jpeg",
      sizeBytes: 10, dhash: "0123456789abcdef", capture: { lat: -0.42, lng: 36.95, accuracyM: 10 },
    });
    const deps = intakeFakes();
    await processInbound(deps, await peter(), { ...whatsapp(), kind: "text", text: "PROOF" });
    expect(deps.send).toHaveBeenLastCalledWith(REAL_PHONE, renderTemplate("no_proof_due", "sw"));
  });
});

describe("the capture page", () => {
  async function issued() {
    const { payment } = await addPaidDelivery();
    return issueProofRequest({ db, now: minutesLater(0) }, {
      projectId: DEMO.projectId, milestoneId: "m2", paymentId: payment.id, contactId: DEMO.contactIds.peter, purpose: "delivery",
    });
  }

  function captureDeps(minutes: number) {
    const stored = new Map<string, Uint8Array>();
    const deps = {
      db,
      now: minutesLater(minutes),
      storeFile: vi.fn(async (path: string, file: { bytes: Uint8Array }) => {
        stored.set(path, file.bytes);
        return path;
      }),
      deleteFile: vi.fn(async (path: string) => void stored.delete(path)),
    } satisfies CaptureDeps;
    return { deps, stored };
  }

  const upload = async (mirrored = false) => ({
    image: { bytes: await photo(mirrored), contentType: "image/jpeg" },
    lat: -0.42016, lng: 36.94771, accuracyM: 12, clientTime: minutesLater(6)(),
  });

  it("shows the code, the milestone and instructions in both languages", async () => {
    const link = await issued();
    const view = await captureView({ db, now: minutesLater(1) }, link.token);
    expect(view).toEqual({
      capture: {
        code: link.code, purpose: "delivery", milestoneName: "Foundation",
        instructions: { en: expect.any(String), sw: expect.any(String) },
        expiresAt: minutesLater(30)().toISOString(),
      },
    });
  });

  it("stores the photo with its hash, location and times, and uses up the link", async () => {
    const link = await issued();
    const { deps, stored } = captureDeps(7);
    const result = await submitCaptureProof(deps, link.token, await upload());
    expect(result).toEqual({ proofId: expect.stringMatching(/^prf_/) });
    const proofId = (result as { proofId: string }).proofId;

    const [proof] = await db.select().from(s.proofs).where(eq(s.proofs.id, proofId));
    expect(proof).toMatchObject({
      proofRequestId: link.id, source: "capture_page", blobPath: `proofs/${proofId}.jpg`, contentType: "image/jpeg",
      dhash: await dHash(await photo()), captureLat: -0.42016, captureLng: 36.94771, accuracyM: 12,
      clientTime: minutesLater(6)(), receivedAt: minutesLater(7)(),
    });
    expect(stored.has(proof.blobPath)).toBe(true);
    const [row] = await proofRequestRows();
    expect(row).toMatchObject({ status: "used", usedAt: minutesLater(7)() });
    expect(await auditActions()).toEqual(["proof.requested", "proof.received"]);

    // Single use: the same link refuses a second photo without storing it.
    const again = captureDeps(8);
    expect(await submitCaptureProof(again.deps, link.token, await upload(true))).toEqual({ problem: "used" });
    expect(again.deps.storeFile).not.toHaveBeenCalled();
    expect(await captureView({ db, now: minutesLater(8) }, link.token)).toEqual({ problem: "used" });
  });

  it("refuses an expired link and marks it expired", async () => {
    const link = await issued();
    const { deps } = captureDeps(30);
    expect(await submitCaptureProof(deps, link.token, await upload())).toEqual({ problem: "expired" });
    expect(deps.storeFile).not.toHaveBeenCalled();
    expect((await proofRequestRows())[0].status).toBe("expired");
  });

  it("deletes the stored photo when the link was used during the upload", async () => {
    const link = await issued();
    const { deps, stored } = captureDeps(7);
    deps.storeFile.mockImplementationOnce(async (path, file) => {
      // Another upload wins while this one is being stored.
      await recordProof({ db, now: minutesLater(7) }, link.id, {
        proofId: "prf_other", source: "capture_page", blobPath: "proofs/prf_other.jpg", contentType: "image/jpeg",
        sizeBytes: 10, dhash: "0123456789abcdef", capture: { lat: 0, lng: 0, accuracyM: 5 },
      });
      stored.set(path, file.bytes);
      return path;
    });
    expect(await submitCaptureProof(deps, link.token, await upload())).toEqual({ problem: "used" });
    expect(deps.deleteFile).toHaveBeenCalledOnce();
    expect(stored.size).toBe(0);
    expect(await db.select().from(s.proofs)).toHaveLength(1);
  });

  it("refuses a file that isn't a readable image, and unknown or malformed tokens", async () => {
    const link = await issued();
    const { deps } = captureDeps(5);
    const bad = { ...(await upload()), image: { bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" } };
    expect(await submitCaptureProof(deps, link.token, bad)).toEqual({ problem: "unreadable_image" });
    expect(deps.storeFile).not.toHaveBeenCalled();
    expect(await captureView({ db }, generateToken())).toEqual({ problem: "not_found" });
    expect(await captureView({ db }, "guess")).toEqual({ problem: "not_found" });
  });
});
