// Fresh proof: when a proof photo comes back Suspicious or Needs fresh proof, a new code and link go
// to the person who was asked, because fresh proof is how a held payment gets released.
//
// At most MAX_AUTO_FRESH_REQUESTS go out on their own for one delivery or one milestone; after that
// only the owner can unblock it (an override) or the foreman can ask again (PROOF or DONE). That
// keeps a failing photo from looping messages, and the Twilio sandbox's daily allowance safe.
// Nothing here is decided by a model: the verdict's outcome comes from the checks, in code.

import { and, count, eq, isNull } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { type Notifier, notifyContact } from "@/server/whatsapp/notify";
import { renderTemplate } from "@/server/whatsapp/templates";
import { issueFreshProofRequest, type ProofDeps } from "./requests";

export const MAX_AUTO_FRESH_REQUESTS = 3;

export type FreshProofDeps = {
  notifier: Notifier;
  linkBase: string | undefined; // where proof links point; without it no code is sent
};

export type FreshProofResult =
  | "sent" // a new code went to a test phone
  | "stored" // a new code was issued and its message stored, unsent (no test phone, or Judge Mode)
  | "not_needed" // verified, overridden, or the delivery or milestone has moved on
  | "waiting_for_location" // a WhatsApp photo whose location pin may still come
  | "already_asked" // a newer code exists for the same delivery or milestone
  | "limit_reached"
  | "no_contact"
  | "no_link_base";

const NEEDS_PROOF = new Set(["awaiting_proof", "held"]);

export async function requestFreshProof(deps: ProofDeps & { fresh: FreshProofDeps }, proofId: string): Promise<FreshProofResult> {
  const { db, fresh } = deps;
  const [proof] = await db.select().from(s.proofs).where(eq(s.proofs.id, proofId));
  const [verdict] = await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, proofId));
  if (!proof?.proofRequestId || !verdict || verdict.outcome === "verified" || verdict.overriddenAt) return "not_needed";
  // WhatsApp photos arrive without a location; the person was just asked to share it, and the pin
  // decides. A photo whose only problem is a missing pin shouldn't bring a new code.
  if (proof.source === "whatsapp" && proof.captureLat == null) return "waiting_for_location";

  const [request] = await db.select().from(s.proofRequests).where(eq(s.proofRequests.id, proof.proofRequestId));
  if (!(await stillNeedsProof(deps, request))) return "not_needed";

  const target = request.paymentId
    ? eq(s.auditEvents.paymentId, request.paymentId)
    : and(eq(s.auditEvents.milestoneId, request.milestoneId), isNull(s.auditEvents.paymentId));
  const [{ sent }] = await db.select({ sent: count() }).from(s.auditEvents)
    .where(and(target, eq(s.auditEvents.action, "proof.fresh_requested")));
  if (sent >= MAX_AUTO_FRESH_REQUESTS) {
    const [noted] = await db.select({ id: s.auditEvents.id }).from(s.auditEvents)
      .where(and(eq(s.auditEvents.proofId, proof.id), eq(s.auditEvents.action, "proof.fresh_limit_reached")));
    if (!noted) {
      await db.insert(s.auditEvents).values({
        projectId: proof.projectId,
        kind: "proof",
        action: "proof.fresh_limit_reached",
        description: `No new proof code was sent automatically: ${MAX_AUTO_FRESH_REQUESTS} have been sent already. The owner can override with a reason, or the foreman can ask for a new code.`,
        actor: "system",
        paymentId: request.paymentId,
        proofId: proof.id,
        milestoneId: request.milestoneId,
        data: { proofRequestId: request.id, sent },
      });
    }
    return "limit_reached";
  }

  const [contact] = request.contactId
    ? await db.select().from(s.siteContacts).where(eq(s.siteContacts.id, request.contactId))
    : [];
  if (!contact) return "no_contact";
  if (!fresh.linkBase) {
    console.error("No proof link base URL: set PROOF_LINK_BASE_URL.");
    return "no_link_base";
  }

  const issued = await issueFreshProofRequest(deps, request);
  if (!issued) return "already_asked";
  const params = { milestone: issued.milestoneName, code: issued.code };
  const body = renderTemplate("fresh_proof_request", contact.language, { ...params, link: `${fresh.linkBase}/proof/${issued.token}` });
  // The stored copy hides the token: only its hash may live in the database.
  const stored = renderTemplate("fresh_proof_request", contact.language, { ...params, link: `${fresh.linkBase}/proof/[link hidden]` });
  const outcome = await notifyContact(db, fresh.notifier, contact, "fresh_proof_request", body, stored);
  return outcome.sent ? "sent" : "stored";
}

// The delivery's request, or the milestone, is still waiting on an accepted proof.
async function stillNeedsProof(deps: ProofDeps, request: typeof s.proofRequests.$inferSelect): Promise<boolean> {
  if (request.purpose === "progress") {
    const [milestone] = await deps.db.select({ status: s.milestones.status }).from(s.milestones).where(eq(s.milestones.id, request.milestoneId));
    return NEEDS_PROOF.has(milestone?.status ?? "");
  }
  if (!request.paymentId) return false;
  const [row] = await deps.db.select({ status: s.requests.status }).from(s.payments)
    .innerJoin(s.requests, eq(s.requests.id, s.payments.requestId))
    .where(eq(s.payments.id, request.paymentId));
  return NEEDS_PROOF.has(row?.status ?? "");
}
