// What a verdict changes, and the holds that stop money moving.
//
// A delivery proof moves the request it proves; a progress proof moves its milestone. Each moves
// only through its state machine: a verdict an earlier state doesn't accept changes nothing.
//
// A milestone is held while its own status is "held" or any request on it is "held". A materials
// delivery happens while its milestone is still in progress, so a suspicious delivery holds its
// request, and that blocks every new payment on the milestone until fresh proof passes or the
// owner overrides (Day 13). Payments read the hold in code; no model output reaches this file.

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { type MilestoneEvent, milestoneMachine, type RequestEvent, requestMachine } from "@/server/state/machines";
import type { Outcome } from "./verify";

type Tx = Parameters<Parameters<AnyDb["transaction"]>[0]>[0];
type Reader = Pick<AnyDb, "select">;
type ProofRequest = typeof s.proofRequests.$inferSelect;

const EVENTS: Record<Outcome, RequestEvent & MilestoneEvent> = {
  verified: "proof_verified",
  needs_fresh_proof: "proof_needs_fresh",
  suspicious: "proof_suspicious",
};

export type StatusChange = { id: string; from: string; to: string };
export type VerdictEffects = { request: StatusChange | null; milestone: StatusChange | null };

// Moves the proven request (delivery) or milestone (progress) to match the verdict, inside the
// verdict's transaction. Returns what changed, for the money trail.
export async function applyVerdict(tx: Tx, proofRequest: ProofRequest, requestId: string | null, outcome: Outcome): Promise<VerdictEffects> {
  const event = EVENTS[outcome];
  const effects: VerdictEffects = { request: null, milestone: null };

  if (proofRequest.purpose === "delivery" && requestId) {
    const [request] = await tx.select({ id: s.requests.id, status: s.requests.status }).from(s.requests)
      .where(eq(s.requests.id, requestId)).for("update");
    if (request && requestMachine.can(request.status, event)) {
      const to = requestMachine.transition(request.status, event);
      if (to !== request.status) {
        await tx.update(s.requests).set({ status: to }).where(eq(s.requests.id, request.id));
        effects.request = { id: request.id, from: request.status, to };
      }
    }
  }

  if (proofRequest.purpose === "progress") {
    const [milestone] = await tx.select({ id: s.milestones.id, status: s.milestones.status }).from(s.milestones)
      .where(eq(s.milestones.id, proofRequest.milestoneId)).for("update");
    if (milestone && milestoneMachine.can(milestone.status, event)) {
      const to = milestoneMachine.transition(milestone.status, event);
      if (to !== milestone.status) {
        await tx.update(s.milestones).set({ status: to }).where(eq(s.milestones.id, milestone.id));
        effects.milestone = { id: milestone.id, from: milestone.status, to };
      }
    }
  }
  return effects;
}

export type MilestoneHold = { milestoneHeld: boolean; heldRequestIds: string[] };

// Null when nothing holds the milestone's payments.
export async function milestoneHold(db: Reader, milestoneId: string): Promise<MilestoneHold | null> {
  const [milestone] = await db.select({ status: s.milestones.status }).from(s.milestones).where(eq(s.milestones.id, milestoneId));
  const held = await db.select({ id: s.requests.id }).from(s.requests)
    .where(and(eq(s.requests.milestoneId, milestoneId), eq(s.requests.status, "held")));
  const milestoneHeld = milestone?.status === "held";
  if (!milestoneHeld && held.length === 0) return null;
  return { milestoneHeld, heldRequestIds: held.map((r) => r.id) };
}

export const HELD_MESSAGE = "Payments for this milestone are held: a proof photo failed its checks. They resume when fresh proof passes or the owner overrides with a reason.";
