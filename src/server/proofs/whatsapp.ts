// Proof over WhatsApp: the PROOF reply that issues a code, and the fallback for people who can't
// open the link (a photo sent in the chat while their code is open, plus a shared location pin).

import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { newId } from "@/server/db/ids";
import * as s from "@/server/db/schema";
import type { InboundMessage, IntakeDeps } from "@/server/whatsapp/intake";
import type { MediaFile } from "@/server/whatsapp/media";
import { renderTemplate } from "@/server/whatsapp/templates";
import { dHash, UnreadableImage } from "./dhash";
import { findDeliveryDue, issueProofRequest, openProofRequestFor, recordProof, type ProofDeps } from "./requests";
import { verifyStoredProof } from "./verdicts";

type Contact = typeof s.siteContacts.$inferSelect;

// A location pin counts for a WhatsApp proof photo sent up to this long before or after it.
export const PIN_WINDOW_MS = 10 * 60 * 1000;

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

// A photo from a contact with an open code becomes that code's proof. Returns false when there is
// no open code, so the caller reads the photo as a quote instead.
export async function takeWhatsAppProof(
  deps: ProofDeps,
  contact: Contact,
  messageId: string,
  file: MediaFile,
): Promise<"recorded" | "no_open_request" | "unreadable_image" | "too_late"> {
  const open = await openProofRequestFor(deps, contact.id);
  if (!open) return "no_open_request";

  const [message] = await deps.db.select().from(s.messages).where(eq(s.messages.id, messageId));
  if (!message?.mediaPath) return "unreadable_image";
  let hash: string;
  try {
    hash = await dHash(file.bytes);
  } catch (error) {
    if (error instanceof UnreadableImage) return "unreadable_image";
    throw error;
  }

  // A pin shared shortly before the photo; one shared after it is attached by attachLocationPin.
  const [pin] = await deps.db.select().from(s.messages).where(and(
    eq(s.messages.contactId, contact.id),
    eq(s.messages.direction, "inbound"),
    eq(s.messages.kind, "location"),
    gte(s.messages.createdAt, new Date(message.createdAt.getTime() - PIN_WINDOW_MS)),
    lte(s.messages.createdAt, message.createdAt),
  )).orderBy(desc(s.messages.createdAt)).limit(1);

  const result = await recordProof(deps, open.id, {
    proofId: newId("prf"),
    source: "whatsapp",
    blobPath: message.mediaPath,
    contentType: file.contentType,
    sizeBytes: file.bytes.byteLength,
    dhash: hash,
    capture: pin?.latitude != null && pin.longitude != null ? { lat: pin.latitude, lng: pin.longitude, accuracyM: null } : null,
  });
  if ("problem" in result) return "too_late";
  await verifyStoredProof(deps, result.proofId);
  return "recorded";
}

// A location pin from a contact who sent a WhatsApp proof photo without one in the last few
// minutes: the pin becomes that proof's capture point. WhatsApp pins carry no accuracy.
export async function attachLocationPin(deps: ProofDeps, contact: Contact, messageId: string): Promise<boolean> {
  const [pin] = await deps.db.select().from(s.messages).where(eq(s.messages.id, messageId));
  if (pin?.latitude == null || pin.longitude == null) return false;

  const [proof] = await deps.db.select({ id: s.proofs.id, projectId: s.proofs.projectId, proofRequestId: s.proofs.proofRequestId })
    .from(s.proofs)
    .innerJoin(s.proofRequests, eq(s.proofRequests.id, s.proofs.proofRequestId))
    .where(and(
      eq(s.proofRequests.contactId, contact.id),
      eq(s.proofs.source, "whatsapp"),
      isNull(s.proofs.captureLat),
      gte(s.proofs.receivedAt, new Date(pin.createdAt.getTime() - PIN_WINDOW_MS)),
    ))
    .orderBy(desc(s.proofs.receivedAt)).limit(1);
  if (!proof) return false;

  const updated = await deps.db.update(s.proofs).set({ captureLat: pin.latitude, captureLng: pin.longitude })
    .where(and(eq(s.proofs.id, proof.id), isNull(s.proofs.captureLat)))
    .returning({ id: s.proofs.id });
  if (!updated.length) return false; // another pin got there first
  await deps.db.insert(s.auditEvents).values({
    projectId: proof.projectId,
    kind: "proof",
    action: "proof.location_added",
    description: "A WhatsApp location pin was added to the proof photo sent just before it.",
    actor: `contact:${contact.id}`,
    proofId: proof.id,
    data: { proofRequestId: proof.proofRequestId, messageId },
  });
  await verifyStoredProof(deps, proof.id); // the location check can now run
  return true;
}
