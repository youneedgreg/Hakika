// Runs the verification engine on a stored proof and records its verdict, with a money-trail row.
//
// A verdict is recomputed when the proof changes (a WhatsApp location pin arriving after the
// photo), unless the owner has overridden it: an override is final. Nothing here moves a request,
// milestone or payment yet; holds and fresh-proof requests act on the outcome (Days 12 and 13).

import { and, eq, lte, ne } from "drizzle-orm";
import type { ProofCheck } from "@/shared/types";
import * as s from "@/server/db/schema";
import type { ProofDeps } from "./requests";
import {
  codeCheck, decideOutcome, duplicateCheck, explainOutcome, freshnessCheck, locationCheck, notInspectedChecks,
  type Outcome,
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

export async function verifyProof(deps: ProofDeps, proofId: string): Promise<VerdictResult | null> {
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

    const earlier = await tx.select({ proofId: s.proofs.id, dhash: s.proofs.dhash, receivedAt: s.proofs.receivedAt })
      .from(s.proofs)
      .where(and(eq(s.proofs.projectId, proof.projectId), ne(s.proofs.id, proof.id), lte(s.proofs.receivedAt, proof.receivedAt)));

    const capture = proof.captureLat != null && proof.captureLng != null
      ? { lat: proof.captureLat, lng: proof.captureLng, accuracyM: proof.accuracyM }
      : null;
    const checks: ProofCheck[] = [
      codeCheck(request.code, undefined), // read by the vision model from Day 12
      freshnessCheck(request.issuedAt, proof.receivedAt),
      duplicateCheck(proof.dhash, earlier.map((e) => ({ ...e, imageUrl: proofImageUrl(e.proofId) }))),
      locationCheck(project, capture),
      ...notInspectedChecks(),
    ];
    const outcome = decideOutcome(checks);
    const explanation = explainOutcome(outcome, checks);

    if (existing) {
      await tx.update(s.verdicts).set({ outcome, checks, explanation }).where(eq(s.verdicts.id, existing.id));
    } else {
      await tx.insert(s.verdicts).values({ proofId: proof.id, outcome, checks, explanation });
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
        checks: Object.fromEntries(checks.map((c) => [c.name, c.result])),
      },
    });

    return { outcome, checks, explanation, status: existing ? "rechecked" as const : "recorded" as const };
  });
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
