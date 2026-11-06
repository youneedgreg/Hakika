// Runs the verification engine on a stored proof and records its verdict, with a money-trail row.
//
// The photo is inspected by the vision model once, before the proof's row is locked (a model call
// takes seconds), and the answer is stored with the verdict. A recheck (a WhatsApp location pin
// arriving after the photo) reuses it. An overridden verdict is final. Nothing here moves a
// request, milestone or payment yet; holds and fresh-proof requests act on the outcome.

import { and, desc, eq, isNull, lt, lte, ne, or } from "drizzle-orm";
import { type ExpectedItem, MAX_EARLIER_PHOTOS, type ProofInspection, type ProofPhoto } from "@/server/ai/proof-vision";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { ProofCheck } from "@/shared/types";
import type { ProofDeps } from "./requests";
import {
  decideOutcome, duplicateCheck, explainOutcome, freshnessCheck, inspectedCodeCheck, locationCheck, type Outcome,
  visionChecks,
} from "./verify";

// Where the owner's browser fetches a proof photo (they're stored privately).
export function proofImageUrl(proofId: string): string {
  return `/api/proofs/${proofId}/image`;
}

export type VerdictResult = {
  outcome: Outcome;
  checks: ProofCheck[];
  explanation: string;
  status: "recorded" | "rechecked" | "overridden";
};

const OUTCOME_WORDS: Record<Outcome, string> = {
  verified: "verified",
  needs_fresh_proof: "needs fresh proof",
  suspicious: "suspicious",
};

type Verdict = typeof s.verdicts.$inferSelect;
type ProofRequest = typeof s.proofRequests.$inferSelect;
type Reader = Pick<AnyDb, "select">;

// What's kept in verdicts.raw_model_output.
type StoredOutput = { inspection: ProofInspection };

// An inspection worth keeping: the model answered. A failed one is tried again next time.
function storedInspection(verdict: Verdict | undefined): ProofInspection | null {
  const inspection = (verdict?.rawModelOutput as StoredOutput | null | undefined)?.inspection;
  return inspection?.outcome === "inspected" || inspection?.outcome === "distrusted" ? inspection : null;
}

export async function verifyProof(deps: ProofDeps, proofId: string): Promise<VerdictResult | null> {
  const fresh = await inspect(deps, proofId);

  return deps.db.transaction(async (tx) => {
    // Holding the proof's row keeps two checks of the same proof (photo, then pin) in order.
    const [proof] = await tx.select().from(s.proofs).where(eq(s.proofs.id, proofId)).for("update");
    if (!proof?.proofRequestId) return null;
    const [request] = await tx.select().from(s.proofRequests).where(eq(s.proofRequests.id, proof.proofRequestId));
    const [project] = await tx.select({ lat: s.projects.siteLat, lng: s.projects.siteLng, radiusM: s.projects.siteRadiusM })
      .from(s.projects).where(eq(s.projects.id, proof.projectId));

    const [existing] = await tx.select().from(s.verdicts).where(eq(s.verdicts.proofId, proof.id));
    if (existing?.overriddenAt) {
      return { outcome: existing.outcome, checks: existing.checks, explanation: existing.explanation, status: "overridden" as const };
    }

    // A photo is inspected once: if a check that ran alongside this one already stored an
    // answer, that answer stands.
    const kept = storedInspection(existing);
    const inspection = kept ?? fresh?.inspection ?? null;
    const modelId = kept ? existing!.modelId : fresh?.modelId ?? null;
    const expected = await expectedItems(tx, request);

    const earlier = await tx.select({ proofId: s.proofs.id, dhash: s.proofs.dhash, receivedAt: s.proofs.receivedAt })
      .from(s.proofs)
      .where(and(eq(s.proofs.projectId, proof.projectId), ne(s.proofs.id, proof.id), lte(s.proofs.receivedAt, proof.receivedAt)));

    const capture = proof.captureLat != null && proof.captureLng != null
      ? { lat: proof.captureLat, lng: proof.captureLng, accuracyM: proof.accuracyM }
      : null;
    const checks: ProofCheck[] = [
      inspectedCodeCheck(request.code, inspection),
      freshnessCheck(request.issuedAt, proof.receivedAt),
      duplicateCheck(proof.dhash, earlier.map((e) => ({ ...e, imageUrl: proofImageUrl(e.proofId) }))),
      locationCheck(project, capture),
      ...visionChecks(inspection, { purpose: request.purpose, expected }),
    ];
    const outcome = decideOutcome(checks);
    const explanation = explainOutcome(outcome, checks);
    const model = inspection ? { modelId, rawModelOutput: { inspection } satisfies StoredOutput } : { modelId: null, rawModelOutput: null };

    if (existing) {
      await tx.update(s.verdicts).set({ outcome, checks, explanation, ...model }).where(eq(s.verdicts.id, existing.id));
    } else {
      await tx.insert(s.verdicts).values({ proofId: proof.id, outcome, checks, explanation, ...model });
    }

    const [payment] = request.paymentId
      ? await tx.select({ requestId: s.payments.requestId }).from(s.payments).where(eq(s.payments.id, request.paymentId))
      : [];
    const again = existing ? " again after its location arrived" : "";
    await tx.insert(s.auditEvents).values({
      projectId: proof.projectId,
      kind: "verdict",
      action: existing ? "verdict.rechecked" : "verdict.recorded",
      description: `Proof photo for code ${request.code} checked${again}: ${OUTCOME_WORDS[outcome]}. ${explanation}`,
      actor: "system",
      requestId: payment?.requestId ?? null,
      paymentId: request.paymentId,
      proofId: proof.id,
      milestoneId: request.milestoneId,
      data: {
        outcome,
        previousOutcome: existing?.outcome ?? null,
        inspection: inspection?.outcome ?? fresh?.failure ?? "not_inspected",
        modelId,
        checks: Object.fromEntries(checks.map((c) => [c.name, c.result])),
      },
    });

    return { outcome, checks, explanation, status: existing ? "rechecked" as const : "recorded" as const };
  });
}

type Inspected = { inspection: ProofInspection | null; modelId: string; failure?: "photo_missing" | "model_error" };

// The vision model's look at the photo, outside any transaction. Null when there's no model, the
// verdict is final, or an answer is already stored.
async function inspect(deps: ProofDeps, proofId: string): Promise<Inspected | null> {
  const { vision, db } = deps;
  if (!vision) return null;
  const [proof] = await db.select().from(s.proofs).where(eq(s.proofs.id, proofId));
  if (!proof?.proofRequestId) return null;
  const [existing] = await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, proofId));
  if (existing?.overriddenAt || storedInspection(existing)) return null;
  const [request] = await db.select().from(s.proofRequests).where(eq(s.proofRequests.id, proof.proofRequestId));

  const missing = { inspection: null, modelId: vision.modelId, failure: "photo_missing" } as const;
  try {
    const photo = await vision.readPhoto(proof.blobPath);
    if (!photo) return missing;
    const earlier: ProofPhoto[] = [];
    if (request.purpose === "progress") {
      for (const path of await earlierSitePhotos(db, proof)) {
        const p = await vision.readPhoto(path);
        // Comparing with fewer photos than exist could pass a "first photo" that isn't.
        if (!p) return missing;
        earlier.push(p);
      }
    }
    return { inspection: await vision.inspect(photo, { expected: await expectedItems(db, request), earlier }), modelId: vision.modelId };
  } catch (error) {
    // Bedrock or storage down: the proof is still checked, with the vision checks unknown.
    console.error(`Inspecting proof ${proofId} failed:`, error instanceof Error ? error.message : "unknown error");
    return { inspection: null, modelId: vision.modelId, failure: "model_error" };
  }
}

// The latest earlier proofs from the project that weren't judged suspicious: a recycled or
// off-site photo is no reference for what the site looks like.
async function earlierSitePhotos(db: Reader, proof: typeof s.proofs.$inferSelect): Promise<string[]> {
  const rows = await db.select({ blobPath: s.proofs.blobPath }).from(s.proofs)
    .leftJoin(s.verdicts, eq(s.verdicts.proofId, s.proofs.id))
    .where(and(
      eq(s.proofs.projectId, proof.projectId), ne(s.proofs.id, proof.id), lt(s.proofs.receivedAt, proof.receivedAt),
      or(isNull(s.verdicts.outcome), ne(s.verdicts.outcome, "suspicious")),
    ))
    .orderBy(desc(s.proofs.receivedAt)).limit(MAX_EARLIER_PHOTOS);
  return rows.map((r) => r.blobPath);
}

// A delivery proof should show what was paid for: the paid request's lines.
async function expectedItems(db: Reader, request: ProofRequest): Promise<ExpectedItem[]> {
  if (request.purpose !== "delivery" || !request.paymentId) return [];
  const [payment] = await db.select({ requestId: s.payments.requestId }).from(s.payments).where(eq(s.payments.id, request.paymentId));
  if (!payment?.requestId) return [];
  const lines = await db.select().from(s.requestLines).where(eq(s.requestLines.requestId, payment.requestId)).orderBy(s.requestLines.position);
  return lines.map((l) => ({ itemKey: l.itemKey, description: l.description, qty: l.qty, unit: l.unit }));
}

// For callers that have already stored the photo: a failed check is logged, not thrown, so the
// person on site still gets their "photo received" answer. The verdict can be recomputed later.
export async function verifyStoredProof(deps: ProofDeps, proofId: string): Promise<VerdictResult | null> {
  try {
    return await verifyProof(deps, proofId);
  } catch (error) {
    console.error(`Verifying proof ${proofId} failed:`, error);
    return null;
  }
}
