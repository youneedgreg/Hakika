// The owner declines a request waiting for approval, with a typed reason logged in the money trail.
//
// Declining moves no money. It closes any PayPal order opened for the request and not yet captured,
// so a late approval in PayPal can't be captured afterwards (capture refuses a closed payment). It
// holds the request's row lock, the same one capture takes, so a decline and a capture run one after
// the other. No WhatsApp message is sent yet. No owner sign-in yet (like the payment and override
// routes): the project's owner is recorded as the one who declined.

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { paymentMachine, requestMachine } from "@/server/state/machines";
import type { DeclineResult } from "@/shared/api";

export type DeclineDeps = { db: AnyDb; now?: () => Date };

export type DeclineOutcome =
  | { ok: true; value: DeclineResult }
  | { ok: false; httpStatus: number; code: string; message: string };

const fail = (httpStatus: number, code: string, message: string): DeclineOutcome => ({ ok: false, httpStatus, code, message });

export async function declineRequest(deps: DeclineDeps, requestId: string, reason: string): Promise<DeclineOutcome> {
  const at = (deps.now ?? (() => new Date()))();
  return deps.db.transaction(async (tx) => {
    const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, requestId)).for("update");
    if (!request) return fail(404, "not_found", "Request not found.");
    // A repeated click: the first decline and its reason stand.
    if (request.status === "declined") return { ok: true, value: { requestId, status: "declined" } };
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

    return { ok: true, value: { requestId, status: "declined" } };
  });
}
