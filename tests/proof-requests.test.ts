// Day 10: issuing proof codes in answer to a PROOF reply, on an in-memory Postgres with a fake
// Twilio sender.

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { hashToken } from "@/server/proofs/codes";
import { findByToken, issueProofRequest, recordProof } from "@/server/proofs/requests";
import { findContactById, processInbound, type IntakeDeps } from "@/server/whatsapp/intake";
import { renderTemplate } from "@/server/whatsapp/templates";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const REAL_PHONE = "+254799999999";
const LINK_BASE = "https://tryhakika.vercel.app";
const ISSUED_AT = new Date("2026-11-07T09:00:00Z");
const minutesLater = (m: number) => () => new Date(ISSUED_AT.getTime() + m * 60_000);

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
