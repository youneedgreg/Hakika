// Proof over WhatsApp: the PROOF reply that issues a code.

import * as s from "@/server/db/schema";
import type { InboundMessage, IntakeDeps } from "@/server/whatsapp/intake";
import { renderTemplate } from "@/server/whatsapp/templates";
import { findDeliveryDue, issueProofRequest, type ProofDeps } from "./requests";

type Contact = typeof s.siteContacts.$inferSelect;

// Where proof links point: PROOF_LINK_BASE_URL, else the production domain. Undefined locally
// unless set, so a dev server never sends a link to a phone that can't open it.
export function proofLinkBase(): string | undefined {
  if (process.env.PROOF_LINK_BASE_URL) return process.env.PROOF_LINK_BASE_URL.replace(/\/+$/, "");
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : undefined;
}

export type KeywordDeps = Pick<IntakeDeps, "db" | "send"> & ProofDeps & { linkBase?: string };

// Answers a foreman's PROOF reply: a new code and link for the delivery that's due, or
// no_proof_due. Only foremen get codes; anyone else gets no_proof_due.
export async function answerProofKeyword(deps: KeywordDeps, contact: Contact, message: InboundMessage): Promise<void> {
  const due = contact.role === "foreman" ? await findDeliveryDue(deps.db, contact) : null;
  const linkBase = deps.linkBase ?? proofLinkBase();
  if (!due || !linkBase) {
    if (due && !linkBase) console.error("No proof link base URL: set PROOF_LINK_BASE_URL.");
    await reply(deps, contact, message, "no_proof_due", renderTemplate("no_proof_due", contact.language));
    return;
  }

  const issued = await issueProofRequest(deps, {
    projectId: contact.projectId,
    milestoneId: due.milestoneId,
    paymentId: due.paymentId,
    contactId: contact.id,
    purpose: "delivery",
  });
  const link = `${linkBase}/proof/${issued.token}`;
  const params = { milestone: issued.milestoneName, code: issued.code };
  const body = renderTemplate("proof_request", contact.language, { ...params, link });
  // The stored copy hides the token: only its hash may live in the database.
  const stored = renderTemplate("proof_request", contact.language, { ...params, link: `${linkBase}/proof/[link hidden]` });
  await reply(deps, contact, message, "proof_request", body, stored);
}

async function reply(
  deps: Pick<IntakeDeps, "db" | "send">,
  contact: Contact,
  message: InboundMessage,
  templateKey: string,
  body: string,
  storedBody = body,
) {
  const twilioSid = message.channel === "whatsapp" ? await deps.send(message.replyTo, body) : null;
  await deps.db.insert(s.messages).values({
    projectId: contact.projectId,
    contactId: contact.id,
    direction: "outbound",
    channel: message.channel,
    kind: "template",
    body: storedBody,
    templateKey,
    language: contact.language,
    twilioSid,
  });
}
