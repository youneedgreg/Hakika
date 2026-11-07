// The owner overrides a proof's verdict with a typed reason, logged in the money trail.
//
// An override accepts a proof that came back Suspicious or Needs fresh proof: its delivery (or its
// milestone) becomes verified, so the hold on the milestone's payments lifts, and any code still
// open for it stops working. It never moves money by itself: a payment still needs the owner's
// approval in PayPal. No owner sign-in yet (like the payment routes): the project's owner is
// recorded as the one who overrode; the Day 17 security pass adds the session check.

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { milestoneMachine, proofRequestMachine, requestMachine } from "@/server/state/machines";
import type { OverrideResult } from "@/shared/api";
import { sameProofTarget } from "./requests";

export type OverrideDeps = { db: AnyDb; now?: () => Date };

export type OverrideOutcome =
  | { ok: true; value: OverrideResult }
  | { ok: false; httpStatus: number; code: string; message: string };

const fail = (httpStatus: number, code: string, message: string): OverrideOutcome => ({ ok: false, httpStatus, code, message });

const OUTCOME_WORDS = { verified: "verified", needs_fresh_proof: "needs fresh proof", suspicious: "suspicious" } as const;
const WAITING = new Set(["awaiting_proof", "held"]);

export async function overrideVerdict(deps: OverrideDeps, proofId: string, reason: string): Promise<OverrideOutcome> {
  const at = (deps.now ?? (() => new Date()))();
  return deps.db.transaction(async (tx) => {
    const [proof] = await tx.select().from(s.proofs).where(eq(s.proofs.id, proofId)).for("update");
    if (!proof?.proofRequestId) return fail(404, "not_found", "Proof not found.");
    const [verdict] = await tx.select().from(s.verdicts).where(eq(s.verdicts.proofId, proof.id));
    if (!verdict) return fail(409, "not_checked", "This proof hasn't been checked yet.");
    if (verdict.overriddenAt) {
      // A repeated click: the first override stands.
      return { ok: true, value: { proofId, overridden: true, reason: verdict.overrideReason!, at: verdict.overriddenAt.toISOString() } };
    }
    if (verdict.outcome === "verified") return fail(409, "nothing_to_override", "This proof was verified, so there is nothing to override.");

    const [request] = await tx.select().from(s.proofRequests).where(eq(s.proofRequests.id, proof.proofRequestId));
    const [milestone] = await tx.select().from(s.milestones).where(eq(s.milestones.id, request.milestoneId)).for("update");
    const [project] = await tx.select({ ownerId: s.projects.ownerId }).from(s.projects).where(eq(s.projects.id, proof.projectId));

    // What the proof is for: a paid delivery's request, or the milestone's own progress.
    let requestChange: { id: string; from: string; to: string } | null = null;
    let milestoneChange: { id: string; from: string; to: string } | null = null;
    let requestId: string | null = null;
    if (request.purpose === "delivery") {
      const [payment] = request.paymentId
        ? await tx.select({ requestId: s.payments.requestId }).from(s.payments).where(eq(s.payments.id, request.paymentId))
        : [];
      const [proven] = payment?.requestId
        ? await tx.select().from(s.requests).where(eq(s.requests.id, payment.requestId)).for("update")
        : [];
      if (!proven || !WAITING.has(proven.status)) return fail(409, "not_waiting", "Nothing is waiting on this proof any more.");
      const to = requestMachine.transition(proven.status, "owner_overrode");
      await tx.update(s.requests).set({ status: to }).where(eq(s.requests.id, proven.id));
      requestChange = { id: proven.id, from: proven.status, to };
      requestId = proven.id;
    } else {
      if (!WAITING.has(milestone.status)) return fail(409, "not_waiting", "Nothing is waiting on this proof any more.");
      const to = milestoneMachine.transition(milestone.status, "owner_overrode");
      await tx.update(s.milestones).set({ status: to }).where(eq(s.milestones.id, milestone.id));
      milestoneChange = { id: milestone.id, from: milestone.status, to };
    }

    await tx.update(s.verdicts).set({ overriddenAt: at, overrideReason: reason, overriddenBy: project.ownerId })
      .where(eq(s.verdicts.id, verdict.id));

    // A code still open for the same delivery or milestone is no longer needed.
    const open = await tx.select({ id: s.proofRequests.id, status: s.proofRequests.status }).from(s.proofRequests)
      .where(and(sameProofTarget(request), eq(s.proofRequests.purpose, request.purpose), eq(s.proofRequests.status, "issued")))
      .for("update");
    for (const old of open) {
      await tx.update(s.proofRequests).set({ status: proofRequestMachine.transition(old.status, "superseded") })
        .where(eq(s.proofRequests.id, old.id));
    }

    const effect = requestChange
      ? `The delivery is confirmed, so payments on ${milestone.name} can continue.`
      : `${milestone.name} is verified, so its labour can be paid.`;
    await tx.insert(s.auditEvents).values({
      projectId: proof.projectId,
      kind: "override",
      action: "verdict.overridden",
      description: `The owner accepted the proof photo for code ${request.code}, which was ${OUTCOME_WORDS[verdict.outcome]}. Reason: "${reason}". ${effect}`,
      actor: `owner:${project.ownerId}`,
      requestId,
      paymentId: request.paymentId,
      proofId: proof.id,
      milestoneId: milestone.id,
      at,
      data: {
        reason,
        previousOutcome: verdict.outcome,
        requestStatus: requestChange,
        milestoneStatus: milestoneChange,
        superseded: open.map((o) => o.id),
      },
    });

    return { ok: true, value: { proofId, overridden: true, reason, at: at.toISOString() } };
  });
}
