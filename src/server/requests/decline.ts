// The owner declines a request waiting for approval, with a typed reason logged in the money trail.
//
// Declining moves no money. It closes any PayPal order opened for the request and not yet captured,
// so a late approval in PayPal can't be captured afterwards (capture refuses a closed payment). It
// holds the request's row lock, the same one capture takes, so a decline and a capture run one after
// the other. The foreman who sent it then gets a fixed template saying it wasn't approved: no
// reason, amount or supplier in it, since the reason is the owner's own words and the supplier's
// name was read off the quote. No owner sign-in yet (like the payment and override routes): the
// project's owner is recorded as the one who declined.

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { paymentMachine, requestMachine } from "@/server/state/machines";
import { type Notifier, type NotifyOutcome, notifyContact } from "@/server/whatsapp/notify";
import { renderTemplate } from "@/server/whatsapp/templates";
import type { DeclineResult } from "@/shared/api";

export type DeclineDeps = { db: AnyDb; now?: () => Date };

export type DeclineOutcome =
  | { ok: true; value: DeclineResult; newlyDeclined: boolean } // newlyDeclined: false on a repeated click
  | { ok: false; httpStatus: number; code: string; message: string };

const fail = (httpStatus: number, code: string, message: string): DeclineOutcome => ({ ok: false, httpStatus, code, message });

export async function declineRequest(deps: DeclineDeps, requestId: string, reason: string): Promise<DeclineOutcome> {
  const at = (deps.now ?? (() => new Date()))();
  return deps.db.transaction(async (tx) => {
    const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, requestId)).for("update");
    if (!request) return fail(404, "not_found", "Request not found.");
    // A repeated click: the first decline and its reason stand.
    if (request.status === "declined") return { ok: true, value: { requestId, status: "declined" }, newlyDeclined: false };
    if (request.status !== "awaiting_approval") {
      return fail(409, "not_awaiting_approval", `This request is ${request.status.replaceAll("_", " ")}, so it can't be declined now.`);
    }

    const open = await tx.select().from(s.payments).where(and(eq(s.payments.requestId, requestId), eq(s.payments.status, "created")));
    // PayPal already has a capture in progress: let it finish rather than decline a payment mid-way.
    if (open.some((payment) => payment.paypalCaptureId)) {
      return fail(409, "capture_pending", "PayPal is still completing a payment for this request, so it can't be declined now.");
    }

    const [project] = await tx.select({ ownerId: s.projects.ownerId }).from(s.projects).where(eq(s.projects.id, request.projectId));
    const actor = `owner:${project.ownerId}`;

    for (const payment of open) {
      await tx.update(s.payments).set({ status: paymentMachine.transition(payment.status, "failed") }).where(eq(s.payments.id, payment.id));
      await tx.insert(s.auditEvents).values({
        projectId: request.projectId,
        kind: "payment",
        action: "payment.order_closed",
        description: "The owner declined the request, so its unpaid PayPal order was closed. Nothing was paid.",
        actor,
        requestId,
        paymentId: payment.id,
        milestoneId: request.milestoneId,
        paypalOrderId: payment.paypalOrderId,
        at,
      });
    }

    await tx.update(s.requests)
      .set({ status: requestMachine.transition(request.status, "owner_declined"), declineReason: reason })
      .where(eq(s.requests.id, requestId));
    await tx.insert(s.auditEvents).values({
      projectId: request.projectId,
      kind: "request",
      action: "request.declined",
      description: `The owner declined this request. Reason: "${reason}". Nothing was paid.`,
      actor,
      requestId,
      milestoneId: request.milestoneId,
      at,
      data: { reason, closedPayments: open.map((payment) => payment.id) },
    });

    return { ok: true, value: { requestId, status: "declined" }, newlyDeclined: true };
  });
}

// Tells the person who sent a declined request. A request sent from Judge Mode's simulator is
// answered on the simulator (stored, never sent); a WhatsApp one goes through the notifier, so only
// mapped test phones get a real message. Null when there is no one to tell.
export async function notifyDeclined(
  db: AnyDb,
  whatsapp: Omit<Notifier, "channel">,
  requestId: string,
): Promise<NotifyOutcome | null> {
  const [row] = await db.select({ status: s.requests.status, contactId: s.requests.contactId, channel: s.messages.channel })
    .from(s.requests)
    .leftJoin(s.messages, eq(s.messages.id, s.requests.messageId))
    .where(eq(s.requests.id, requestId));
  if (row?.status !== "declined" || !row.contactId) return null;
  const [contact] = await db.select().from(s.siteContacts).where(eq(s.siteContacts.id, row.contactId));
  if (!contact) return null;
  const notifier: Notifier = row.channel === "simulator"
    ? { channel: "simulator", send: () => Promise.reject(new Error("Judge Mode never sends real WhatsApp messages.")), testPhones: new Map() }
    : { channel: "whatsapp", ...whatsapp };
  const outcome = await notifyContact(db, notifier, contact, "request_declined", renderTemplate("request_declined", contact.language));
  const [request] = await db.select({ projectId: s.requests.projectId, milestoneId: s.requests.milestoneId })
    .from(s.requests).where(eq(s.requests.id, requestId));
  await db.insert(s.auditEvents).values({
    projectId: request.projectId,
    kind: "request",
    action: "request.decline_notified",
    description: outcome.sent
      ? `${contact.name} was told on WhatsApp that the request wasn't approved.`
      : `A message telling ${contact.name} the request wasn't approved was stored, not sent (${outcome.reason?.replaceAll("_", " ")}).`,
    actor: "system",
    requestId,
    milestoneId: request.milestoneId,
    data: { contactId: contact.id, sent: outcome.sent, reason: outcome.reason ?? null },
  });
  return outcome;
}
