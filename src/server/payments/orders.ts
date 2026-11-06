// Paying a supplier for a request. The browser names the request; the amount, the payee and the
// rate all come from the database. Only the owner's approval in PayPal moves money, and capture is
// the one place it moves, so the checks that stop a double payment sit there.
//
// Each step holds a lock on the request row while it talks to PayPal, so two clicks on the same
// request run one after the other instead of both paying.

import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import { newId } from "@/server/db/ids";
import * as s from "@/server/db/schema";
import { getDailyRate } from "@/server/pricing/fx";
import { centsToAmount, kesCentsToUsdCents } from "@/server/pricing/money";
import { HELD_MESSAGE, milestoneHold } from "@/server/proofs/holds";
import { paymentMachine, requestMachine } from "@/server/state/machines";
import type { CaptureResult, CreateOrderResult } from "@/shared/api";
import { captureOf, PayPalApiError, type PayPalCapture, type PayPalClient } from "./paypal";

export type PaymentDeps = {
  paypal: PayPalClient;
  appUrl: string; // where PayPal sends the owner back after approving or cancelling
  rate?: () => Promise<{ kesPerUsd: string }>;
  now?: () => Date;
  // Told which payments a step marked paid, once its transaction has committed: for the
  // WhatsApp confirmations. A payment is marked paid once, so each is reported once.
  onPaid?: (paymentIds: string[]) => void | Promise<void>;
};

export type PaymentOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; httpStatus: number; code: string; message: string };

type Request = typeof s.requests.$inferSelect;
type Payment = typeof s.payments.$inferSelect;

const ok = <T>(value: T): PaymentOutcome<T> => ({ ok: true, value });
const fail = (httpStatus: number, code: string, message: string): PaymentOutcome<never> =>
  ({ ok: false, httpStatus, code, message });

// Orders PayPal can still take an approval or a capture for.
const OPEN_ORDER_STATUSES = new Set(["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"]);

export async function createOrderForRequest(
  db: AnyDb,
  requestId: string,
  deps: PaymentDeps,
): Promise<PaymentOutcome<CreateOrderResult>> {
  const rate = deps.rate ?? (() => getDailyRate(db));
  return paymentStep(db, deps, async (tx, paid) => {
    const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, requestId)).for("update");
    if (!request) return fail(404, "not_found", "Request not found.");
    if (request.status !== "awaiting_approval") {
      return fail(409, "not_awaiting_approval", `This request is ${request.status.replaceAll("_", " ")}, so it can't be paid now.`);
    }
    if (request.milestoneId && await milestoneHold(tx, request.milestoneId)) return fail(409, "milestone_held", HELD_MESSAGE);
    const blocking = await tx.select({ id: s.findings.id }).from(s.findings).where(and(
      eq(s.findings.requestId, requestId), eq(s.findings.severity, "block"), isNull(s.findings.acknowledgedAt),
    ));
    if (blocking.length > 0) {
      return fail(409, "findings_unacknowledged", "This quote has a problem the owner must acknowledge before paying.");
    }
    const [supplier] = request.recommendedSupplierId
      ? await tx.select().from(s.suppliers).where(eq(s.suppliers.id, request.recommendedSupplierId))
      : [];
    if (!supplier?.verified || !supplier.paypalEmail || request.recommendedTotalKesCents === null) {
      return fail(409, "no_payee", "There is no verified supplier with a PayPal account to pay for this request.");
    }

    const { kesPerUsd } = await rate();
    const amountKesCents = request.recommendedTotalKesCents;
    const amountUsdCents = kesCentsToUsdCents(amountKesCents, kesPerUsd);
    const ownerActor = await ownerOf(tx, request.projectId);

    // A second click reuses the order PayPal still has open, if it's for the same payee and amount.
    const open = await tx.select().from(s.payments).where(and(
      eq(s.payments.requestId, requestId), eq(s.payments.status, "created"),
      isNotNull(s.payments.paypalOrderId), isNull(s.payments.paypalCaptureId),
    ));
    for (const payment of open) {
      const order = await deps.paypal.getOrder(payment.paypalOrderId!);
      const capture = order && captureOf(order);
      if (capture?.status === "COMPLETED") {
        // PayPal took the money but the capture was never recorded here: record it now.
        await applyCapture(tx, request, payment, capture, ownerActor, deps, paid);
        return fail(409, "already_paid", "This request has already been paid.");
      }
      const unchanged = payment.payeeEmail === supplier.paypalEmail
        && payment.amountKesCents === amountKesCents && payment.amountUsdCents === amountUsdCents;
      if (order && OPEN_ORDER_STATUSES.has(order.status) && unchanged) return ok({ orderId: order.id });
      await tx.update(s.payments).set({ status: paymentMachine.transition(payment.status, "failed") }).where(eq(s.payments.id, payment.id));
      await audit(tx, request, payment, ownerActor, "payment.order_abandoned",
        "An unpaid PayPal order was replaced: it had expired, or the amount or payee had changed.");
    }

    const paymentId = newId("pay");
    const order = await deps.paypal.createOrder({
      requestId,
      paymentId,
      payeeEmail: supplier.paypalEmail,
      usdAmount: centsToAmount(amountUsdCents),
      description: `Hakika (sandbox): building materials from ${supplier.name}`.slice(0, 127),
      returnUrl: `${deps.appUrl}/requests/${encodeURIComponent(requestId)}?paypal=approved`,
      cancelUrl: `${deps.appUrl}/requests/${encodeURIComponent(requestId)}?paypal=cancelled`,
      idempotencyKey: `create-${paymentId}`,
    });
    const [payment] = await tx.insert(s.payments).values({
      id: paymentId,
      projectId: request.projectId,
      kind: "materials",
      requestId,
      payeeSupplierId: supplier.id,
      payeeEmail: supplier.paypalEmail,
      amountKesCents,
      amountUsdCents,
      kesPerUsd,
      paypalRequestId: `capture-${paymentId}`,
      paypalOrderId: order.id,
    }).returning();
    await audit(tx, request, payment, ownerActor, "payment.order_created",
      `A PayPal order for USD ${centsToAmount(amountUsdCents)} to ${supplier.name} is waiting for the owner's approval.`);
    return ok({ orderId: order.id });
  });
}

export async function captureOrderForRequest(
  db: AnyDb,
  orderId: string,
  deps: PaymentDeps,
): Promise<PaymentOutcome<CaptureResult>> {
  return paymentStep(db, deps, async (tx, paid) => {
    const [found] = await tx.select().from(s.payments).where(eq(s.payments.paypalOrderId, orderId));
    if (!found?.requestId) return fail(404, "not_found", "Order not found.");
    const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, found.requestId)).for("update");
    // Read again under the lock: another capture may have finished while this one waited.
    const [payment] = await tx.select().from(s.payments).where(eq(s.payments.id, found.id));
    const ownerActor = await ownerOf(tx, request.projectId);

    if (payment.status === "captured") {
      return ok({ requestId: request.id, status: request.status, captureId: payment.paypalCaptureId! });
    }
    if (payment.status !== "created") return fail(409, "payment_closed", `This payment is ${payment.status}.`);

    // A pending capture from an earlier call: ask PayPal whether it has completed since.
    if (request.status === "approved" && payment.paypalCaptureId) {
      const order = await deps.paypal.getOrder(orderId);
      const capture = order && captureOf(order);
      return capture
        ? applyCapture(tx, request, payment, capture, ownerActor, deps, paid)
        : ok({ requestId: request.id, status: request.status, captureId: payment.paypalCaptureId });
    }
    if (request.status !== "awaiting_approval") {
      return fail(409, "not_awaiting_approval", `This request is ${request.status.replaceAll("_", " ")}, so it can't be paid now.`);
    }
    // A hold that started after the order was created still stops the capture.
    if (request.milestoneId && await milestoneHold(tx, request.milestoneId)) return fail(409, "milestone_held", HELD_MESSAGE);

    // Another order for this request may have been paid at PayPal without being recorded here
    // (a crash after PayPal answered). Record it and refuse, rather than pay a second time.
    const others = await tx.select().from(s.payments).where(and(
      eq(s.payments.requestId, request.id), eq(s.payments.status, "created"),
      ne(s.payments.id, payment.id), isNotNull(s.payments.paypalOrderId),
    ));
    for (const other of others) {
      const order = await deps.paypal.getOrder(other.paypalOrderId!);
      const capture = order && captureOf(order);
      if (capture?.status === "COMPLETED") {
        await applyCapture(tx, request, other, capture, ownerActor, deps, paid);
        return fail(409, "already_paid", "This request was already paid with another PayPal order.");
      }
    }

    let order;
    try {
      order = await deps.paypal.captureOrder(orderId, payment.paypalRequestId);
    } catch (error) {
      if (!(error instanceof PayPalApiError) || error.httpStatus !== 422) throw error;
      if (error.issue === "ORDER_ALREADY_CAPTURED") {
        order = await deps.paypal.getOrder(orderId);
        if (!order) throw error;
      } else if (error.issue === "ORDER_NOT_APPROVED") {
        return fail(409, "order_not_approved", "The owner hasn't approved this order in PayPal yet.");
      } else if (error.issue === "INSTRUMENT_DECLINED" || error.issue === "PAYER_ACTION_REQUIRED") {
        // PayPal's documented fix: send the owner back to PayPal with the same order.
        return fail(422, "payer_action_required", "PayPal needs the owner to go back to PayPal and choose another way to pay.");
      } else {
        throw error;
      }
    }
    const capture = captureOf(order);
    if (!capture) throw new Error(`PayPal returned order ${orderId} with no capture.`);
    return applyCapture(tx, request, payment, capture, ownerActor, deps, paid);
  });
}

export type WebhookSource = { eventId: string; eventType: string };

export type SyncResult =
  | "recorded" // a capture outcome this server hadn't recorded yet
  | "confirmed" // the webhook agrees with a capture already recorded
  | "refunded"
  | "partially_refunded"
  | "unexpected" // PayPal reports a capture for a request that wasn't waiting for one
  | "no_change"
  | "unknown_order"; // not an order Hakika made

// What a verified PayPal webhook does: read the order back from PayPal and record what changed.
// It never captures. Money moves only when the owner approves and the capture route runs; the
// webhook is the second check the roadmap asks for, and it finishes captures that were PENDING.
export async function syncPaymentFromPayPal(
  db: AnyDb,
  orderId: string,
  deps: PaymentDeps,
  source: WebhookSource,
): Promise<SyncResult> {
  return paymentStep(db, deps, async (tx, paid) => {
    const [found] = await tx.select().from(s.payments).where(eq(s.payments.paypalOrderId, orderId));
    if (!found?.requestId) return "unknown_order";
    const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, found.requestId)).for("update");
    const [payment] = await tx.select().from(s.payments).where(eq(s.payments.id, found.id));
    const order = await deps.paypal.getOrder(orderId);
    const capture = order && captureOf(order);
    if (!capture) return "no_change";
    const data = { via: "paypal_webhook", eventId: source.eventId, eventType: source.eventType };

    if (payment.status === "created") {
      if (capture.status === "PENDING" && payment.paypalCaptureId === capture.id) return "no_change";
      if (!["COMPLETED", "PENDING", "DECLINED", "FAILED"].includes(capture.status)) return "no_change";
      if (request.status !== "awaiting_approval" && request.status !== "approved") {
        await audit(tx, request, payment, "system", "payment.capture_unexpected",
          `PayPal reports a ${capture.status.toLowerCase()} payment for a request that is ${request.status.replaceAll("_", " ")}. Check it in PayPal.`,
          capture.id, data);
        return "unexpected";
      }
      await applyCapture(tx, request, payment, capture, await ownerOf(tx, request.projectId), deps, paid, data);
      return "recorded";
    }

    if (payment.status !== "captured") return "no_change";
    const amountPaid = `USD ${centsToAmount(payment.amountUsdCents)} paid to ${await payeeName(tx, payment)}`;
    if (capture.status === "REFUNDED") {
      await tx.update(s.payments).set({ status: paymentMachine.transition(payment.status, "refunded") }).where(eq(s.payments.id, payment.id));
      await audit(tx, request, payment, "system", "payment.refunded", `The ${amountPaid} was refunded through PayPal.`, capture.id, data);
      return "refunded";
    }
    if (capture.status === "PARTIALLY_REFUNDED") {
      await audit(tx, request, payment, "system", "payment.partially_refunded",
        `Part of the ${amountPaid} was refunded through PayPal.`, capture.id, data);
      return "partially_refunded";
    }
    if (capture.status === "COMPLETED" && source.eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const [already] = await tx.select({ id: s.auditEvents.id }).from(s.auditEvents).where(and(
        eq(s.auditEvents.paymentId, payment.id), eq(s.auditEvents.action, "payment.webhook_confirmed"),
      ));
      if (already) return "no_change";
      await audit(tx, request, payment, "system", "payment.webhook_confirmed",
        "PayPal's signed webhook confirmed this payment.", capture.id, data);
      return "confirmed";
    }
    return "no_change";
  });
}

// Runs one payment step in a transaction. Payments it marks paid are reported only after the
// commit, so nothing is announced for a step that rolled back.
async function paymentStep<T>(
  db: AnyDb,
  deps: PaymentDeps,
  step: (tx: AnyDb, paid: string[]) => Promise<T>,
): Promise<T> {
  const paid: string[] = [];
  const result = await db.transaction((tx) => step(tx, paid));
  if (paid.length > 0 && deps.onPaid) {
    try {
      await deps.onPaid(paid);
    } catch (error) {
      // The money has moved and is recorded; a failed announcement mustn't make it look otherwise.
      console.error("Payment confirmations failed:", error instanceof Error ? error.message : "unknown error");
    }
  }
  return result;
}

// Records what PayPal says happened to a capture. Only COMPLETED marks the request paid.
async function applyCapture(
  tx: AnyDb,
  request: Request,
  payment: Payment,
  capture: PayPalCapture,
  ownerActor: string,
  deps: PaymentDeps,
  paid: string[],
  extra?: object,
): Promise<PaymentOutcome<CaptureResult>> {
  const approved = request.status === "approved" ? request.status : requestMachine.transition(request.status, "owner_approved");
  const ids = { paypalCaptureId: capture.id };

  if (capture.status === "COMPLETED") {
    const status = requestMachine.transition(approved, "captured");
    await tx.update(s.payments).set({
      ...ids, status: paymentMachine.transition(payment.status, "captured"), capturedAt: (deps.now ?? (() => new Date()))(),
    }).where(eq(s.payments.id, payment.id));
    await tx.update(s.requests).set({ status }).where(eq(s.requests.id, request.id));
    paid.push(payment.id);
    const data = capture.amount || extra ? { ...(capture.amount && { captured: capture.amount }), ...extra } : undefined;
    await audit(tx, request, payment, ownerActor, "payment.captured",
      `USD ${centsToAmount(payment.amountUsdCents)} was paid through PayPal to ${await payeeName(tx, payment)}.`,
      capture.id, data);
    return ok({ requestId: request.id, status, captureId: capture.id });
  }

  if (capture.status === "PENDING") {
    // PayPal hasn't credited the supplier yet. The request stays approved, so it can't be paid
    // again; the capture webhook finishes it.
    await tx.update(s.payments).set(ids).where(eq(s.payments.id, payment.id));
    await tx.update(s.requests).set({ status: approved }).where(eq(s.requests.id, request.id));
    await audit(tx, request, payment, ownerActor, "payment.capture_pending",
      "PayPal accepted the payment but hasn't credited the supplier yet.", capture.id, extra);
    return ok({ requestId: request.id, status: approved, captureId: capture.id });
  }

  if (capture.status === "DECLINED" || capture.status === "FAILED") {
    const event = capture.status === "DECLINED" ? "denied" : "failed";
    const status = requestMachine.transition(approved, "capture_failed");
    await tx.update(s.payments).set({ ...ids, status: paymentMachine.transition(payment.status, event) }).where(eq(s.payments.id, payment.id));
    await tx.update(s.requests).set({ status }).where(eq(s.requests.id, request.id));
    await audit(tx, request, payment, ownerActor, "payment.capture_declined",
      "PayPal declined the payment. Nothing was paid, and the request is waiting for approval again.", capture.id, extra);
    return fail(402, "capture_declined", "PayPal declined the payment. Nothing was paid; the owner can try again.");
  }

  throw new Error(`A new capture can't be ${capture.status}.`);
}

// The money trail names the supplier, never its PayPal email.
async function payeeName(tx: AnyDb, payment: Payment): Promise<string> {
  if (!payment.payeeSupplierId) return "the supplier";
  const [supplier] = await tx.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, payment.payeeSupplierId));
  return supplier?.name ?? "the supplier";
}

async function ownerOf(tx: AnyDb, projectId: string): Promise<string> {
  const [project] = await tx.select({ ownerId: s.projects.ownerId }).from(s.projects).where(eq(s.projects.id, projectId));
  return `owner:${project.ownerId}`;
}

function audit(
  tx: AnyDb,
  request: Request,
  payment: Payment,
  actor: string,
  action: string,
  description: string,
  paypalCaptureId?: string,
  data?: object,
) {
  return tx.insert(s.auditEvents).values({
    projectId: request.projectId,
    kind: "payment",
    action,
    description,
    actor,
    requestId: request.id,
    paymentId: payment.id,
    amountKesCents: payment.amountKesCents,
    amountUsdCents: payment.amountUsdCents,
    paypalOrderId: payment.paypalOrderId,
    paypalCaptureId: paypalCaptureId ?? null,
    data,
  });
}
