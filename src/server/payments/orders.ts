// Paying through PayPal. Two kinds of payment: materials, to the recommended supplier for a request,
// and labour, to the fundi for a verified milestone. The browser names the request or the milestone;
// the amount, the payee and the rate all come from the database. Only the owner's approval in
// PayPal moves money, and capture is the one place it moves, so the checks that stop a double
// payment sit there.
//
// Each step holds a lock on the request's (or milestone's) row while it talks to PayPal, so two
// clicks on the same one run one after the other instead of both paying.

import { and, eq, isNotNull, isNull, ne, type SQL } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import { newId } from "@/server/db/ids";
import * as s from "@/server/db/schema";
import { getDailyRate } from "@/server/pricing/fx";
import { centsToAmount, kesCentsToUsdCents } from "@/server/pricing/money";
import { HELD_MESSAGE, milestoneHold } from "@/server/proofs/holds";
import { milestoneMachine, paymentMachine, requestMachine } from "@/server/state/machines";
import type { CaptureResult, CreateOrderResult, LabourCaptureResult } from "@/shared/api";
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
type Milestone = typeof s.milestones.$inferSelect;
type Payment = typeof s.payments.$inferSelect;

// What a payment pays for.
type Subject =
  | { kind: "materials"; request: Request }
  | { kind: "labour"; milestone: Milestone };

type Paid = CaptureResult | LabourCaptureResult;

const ok = <T>(value: T): PaymentOutcome<T> => ({ ok: true, value });
const fail = (httpStatus: number, code: string, message: string): PaymentOutcome<never> =>
  ({ ok: false, httpStatus, code, message });

// Orders PayPal can still take an approval or a capture for.
const OPEN_ORDER_STATUSES = new Set(["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"]);

const words = (status: string) => status.replaceAll("_", " ");

export async function createOrderForRequest(
  db: AnyDb,
  requestId: string,
  deps: PaymentDeps,
): Promise<PaymentOutcome<CreateOrderResult>> {
  return paymentStep(db, deps, async (tx, paid) => {
    const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, requestId)).for("update");
    if (!request) return fail(404, "not_found", "Request not found.");
    if (request.status !== "awaiting_approval") {
      return fail(409, "not_awaiting_approval", `This request is ${words(request.status)}, so it can't be paid now.`);
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
    return openOrder(tx, deps, paid, { kind: "materials", request }, {
      email: supplier.paypalEmail,
      name: supplier.name,
      columns: { payeeSupplierId: supplier.id },
      amountKesCents: request.recommendedTotalKesCents,
    });
  });
}

// The labour payment a verified milestone unlocks, to the fundi named on it.
export async function createOrderForMilestone(
  db: AnyDb,
  milestoneId: string,
  deps: PaymentDeps,
): Promise<PaymentOutcome<CreateOrderResult>> {
  return paymentStep(db, deps, async (tx, paid) => {
    const [milestone] = await tx.select().from(s.milestones).where(eq(s.milestones.id, milestoneId)).for("update");
    if (!milestone) return fail(404, "not_found", "Milestone not found.");
    if (milestone.status !== "verified") {
      return fail(409, "not_verified", `This milestone is ${words(milestone.status)}, so its labour can't be paid now.`);
    }
    if (await milestoneHold(tx, milestone.id)) return fail(409, "milestone_held", HELD_MESSAGE);
    const pending = await tx.select({ id: s.payments.id }).from(s.payments).where(and(
      eq(s.payments.milestoneId, milestone.id), eq(s.payments.kind, "labour"),
      eq(s.payments.status, "created"), isNotNull(s.payments.paypalCaptureId),
    ));
    if (pending.length > 0) {
      return fail(409, "capture_pending", "PayPal is still completing the last labour payment for this milestone.");
    }
    const [fundi] = milestone.labourContactId
      ? await tx.select().from(s.siteContacts).where(eq(s.siteContacts.id, milestone.labourContactId))
      : [];
    if (!fundi?.paypalEmail || milestone.labourKesCents === null) {
      return fail(409, "no_payee", "There is no fundi with a PayPal account to pay for this milestone.");
    }
    return openOrder(tx, deps, paid, { kind: "labour", milestone }, {
      email: fundi.paypalEmail,
      name: fundi.name,
      columns: { payeeContactId: fundi.id },
      amountKesCents: milestone.labourKesCents,
    });
  });
}

type Payee = {
  email: string;
  name: string;
  columns: { payeeSupplierId: string } | { payeeContactId: string };
  amountKesCents: number;
};

// Reuses the order PayPal still has open for the same payee and amount, or creates one.
async function openOrder(
  tx: AnyDb,
  deps: PaymentDeps,
  paid: string[],
  subject: Subject,
  payee: Payee,
): Promise<PaymentOutcome<CreateOrderResult>> {
  const rate = deps.rate ?? (() => getDailyRate(tx));
  const { kesPerUsd } = await rate();
  const amountKesCents = payee.amountKesCents;
  const amountUsdCents = kesCentsToUsdCents(amountKesCents, kesPerUsd);
  const ownerActor = await ownerOf(tx, projectOf(subject));

  // A second click reuses the order PayPal still has open, if it's for the same payee and amount.
  const open = await tx.select().from(s.payments).where(and(
    paymentsFor(subject), eq(s.payments.status, "created"),
    isNotNull(s.payments.paypalOrderId), isNull(s.payments.paypalCaptureId),
  ));
  for (const payment of open) {
    const order = await deps.paypal.getOrder(payment.paypalOrderId!);
    const capture = order && captureOf(order);
    if (capture?.status === "COMPLETED") {
      // PayPal took the money but the capture was never recorded here: record it now.
      await applyCapture(tx, subject, payment, capture, ownerActor, deps, paid);
      return fail(409, "already_paid", subject.kind === "materials" ? "This request has already been paid." : "This labour has already been paid.");
    }
    const unchanged = payment.payeeEmail === payee.email
      && payment.amountKesCents === amountKesCents && payment.amountUsdCents === amountUsdCents;
    if (order && OPEN_ORDER_STATUSES.has(order.status) && unchanged) return ok({ orderId: order.id });
    await tx.update(s.payments).set({ status: paymentMachine.transition(payment.status, "failed") }).where(eq(s.payments.id, payment.id));
    await audit(tx, subject, payment, ownerActor, "payment.order_abandoned",
      "An unpaid PayPal order was replaced: it had expired, or the amount or payee had changed.");
  }

  const paymentId = newId("pay");
  const back = subject.kind === "materials"
    ? `${deps.appUrl}/requests/${encodeURIComponent(subject.request.id)}?paypal=`
    : `${deps.appUrl}/projects/${encodeURIComponent(subject.milestone.projectId)}/gantt?milestone=${encodeURIComponent(subject.milestone.id)}&paypal=`;
  const order = await deps.paypal.createOrder({
    referenceId: subject.kind === "materials" ? subject.request.id : subject.milestone.id,
    paymentId,
    payeeEmail: payee.email,
    usdAmount: centsToAmount(amountUsdCents),
    description: (subject.kind === "materials"
      ? `Hakika (sandbox): building materials from ${payee.name}`
      : `Hakika (sandbox): labour for ${subject.milestone.name}`).slice(0, 127),
    returnUrl: `${back}approved`,
    cancelUrl: `${back}cancelled`,
    idempotencyKey: `create-${paymentId}`,
  });
  const [payment] = await tx.insert(s.payments).values({
    id: paymentId,
    projectId: projectOf(subject),
    kind: subject.kind,
    ...(subject.kind === "materials" ? { requestId: subject.request.id } : { milestoneId: subject.milestone.id }),
    ...payee.columns,
    payeeEmail: payee.email,
    amountKesCents,
    amountUsdCents,
    kesPerUsd,
    paypalRequestId: `capture-${paymentId}`,
    paypalOrderId: order.id,
  }).returning();
  const what = subject.kind === "materials" ? "" : ` for labour on ${subject.milestone.name}`;
  await audit(tx, subject, payment, ownerActor, "payment.order_created",
    `A PayPal order for USD ${centsToAmount(amountUsdCents)} to ${payee.name}${what} is waiting for the owner's approval.`);
  return ok({ orderId: order.id });
}

// Captures either kind of payment: the order names it.
export async function captureOrderForRequest(
  db: AnyDb,
  orderId: string,
  deps: PaymentDeps,
): Promise<PaymentOutcome<Paid>> {
  return paymentStep(db, deps, async (tx, paid) => {
    const [found] = await tx.select().from(s.payments).where(eq(s.payments.paypalOrderId, orderId));
    const subject = found && await lockSubject(tx, found);
    if (!found || !subject) return fail(404, "not_found", "Order not found.");
    // Read again under the lock: another capture may have finished while this one waited.
    const [payment] = await tx.select().from(s.payments).where(eq(s.payments.id, found.id));
    const ownerActor = await ownerOf(tx, projectOf(subject));

    if (payment.status === "captured") return ok(resultOf(subject, payment.paypalCaptureId!));
    if (payment.status !== "created") return fail(409, "payment_closed", `This payment is ${payment.status}.`);

    // A pending capture from an earlier call: ask PayPal whether it has completed since.
    if (payment.paypalCaptureId && (subject.kind === "labour" || subject.request.status === "approved")) {
      const order = await deps.paypal.getOrder(orderId);
      const capture = order && captureOf(order);
      return capture
        ? applyCapture(tx, subject, payment, capture, ownerActor, deps, paid)
        : ok(resultOf(subject, payment.paypalCaptureId));
    }
    if (subject.kind === "materials" && subject.request.status !== "awaiting_approval") {
      return fail(409, "not_awaiting_approval", `This request is ${words(subject.request.status)}, so it can't be paid now.`);
    }
    if (subject.kind === "labour" && subject.milestone.status !== "verified") {
      return fail(409, "not_verified", `This milestone is ${words(subject.milestone.status)}, so its labour can't be paid now.`);
    }
    // A hold that started after the order was created still stops the capture.
    const heldMilestone = subject.kind === "materials" ? subject.request.milestoneId : subject.milestone.id;
    if (heldMilestone && await milestoneHold(tx, heldMilestone)) return fail(409, "milestone_held", HELD_MESSAGE);

    // Another order for the same thing may have been paid at PayPal without being recorded here
    // (a crash after PayPal answered). Record it and refuse, rather than pay a second time.
    const others = await tx.select().from(s.payments).where(and(
      paymentsFor(subject), eq(s.payments.status, "created"),
      ne(s.payments.id, payment.id), isNotNull(s.payments.paypalOrderId),
    ));
    for (const other of others) {
      const order = await deps.paypal.getOrder(other.paypalOrderId!);
      const capture = order && captureOf(order);
      if (capture?.status === "COMPLETED") {
        await applyCapture(tx, subject, other, capture, ownerActor, deps, paid);
        return fail(409, "already_paid", subject.kind === "materials"
          ? "This request was already paid with another PayPal order."
          : "This labour was already paid with another PayPal order.");
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
    return applyCapture(tx, subject, payment, capture, ownerActor, deps, paid);
  });
}

export type WebhookSource = { eventId: string; eventType: string };

export type SyncResult =
  | "recorded" // a capture outcome this server hadn't recorded yet
  | "confirmed" // the webhook agrees with a capture already recorded
  | "refunded"
  | "partially_refunded"
  | "unexpected" // PayPal reports a capture for something that wasn't waiting to be paid
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
    const subject = found && await lockSubject(tx, found);
    if (!found || !subject) return "unknown_order";
    const [payment] = await tx.select().from(s.payments).where(eq(s.payments.id, found.id));
    const order = await deps.paypal.getOrder(orderId);
    const capture = order && captureOf(order);
    if (!capture) return "no_change";
    const data = { via: "paypal_webhook", eventId: source.eventId, eventType: source.eventType };

    if (payment.status === "created") {
      if (capture.status === "PENDING" && payment.paypalCaptureId === capture.id) return "no_change";
      if (!["COMPLETED", "PENDING", "DECLINED", "FAILED"].includes(capture.status)) return "no_change";
      const waiting = subject.kind === "materials"
        ? subject.request.status === "awaiting_approval" || subject.request.status === "approved"
        : subject.milestone.status === "verified";
      if (!waiting) {
        const what = subject.kind === "materials"
          ? `a request that is ${words(subject.request.status)}`
          : `labour on a milestone that is ${words(subject.milestone.status)}`;
        await audit(tx, subject, payment, "system", "payment.capture_unexpected",
          `PayPal reports a ${capture.status.toLowerCase()} payment for ${what}. Check it in PayPal.`, capture.id, data);
        return "unexpected";
      }
      await applyCapture(tx, subject, payment, capture, await ownerOf(tx, projectOf(subject)), deps, paid, data);
      return "recorded";
    }

    if (payment.status !== "captured") return "no_change";
    const amountPaid = `USD ${centsToAmount(payment.amountUsdCents)} paid to ${await payeeName(tx, payment)}`;
    if (capture.status === "REFUNDED") {
      await tx.update(s.payments).set({ status: paymentMachine.transition(payment.status, "refunded") }).where(eq(s.payments.id, payment.id));
      await audit(tx, subject, payment, "system", "payment.refunded", `The ${amountPaid} was refunded through PayPal.`, capture.id, data);
      return "refunded";
    }
    if (capture.status === "PARTIALLY_REFUNDED") {
      await audit(tx, subject, payment, "system", "payment.partially_refunded",
        `Part of the ${amountPaid} was refunded through PayPal.`, capture.id, data);
      return "partially_refunded";
    }
    if (capture.status === "COMPLETED" && source.eventType === "PAYMENT.CAPTURE.COMPLETED") {
      const [already] = await tx.select({ id: s.auditEvents.id }).from(s.auditEvents).where(and(
        eq(s.auditEvents.paymentId, payment.id), eq(s.auditEvents.action, "payment.webhook_confirmed"),
      ));
      if (already) return "no_change";
      await audit(tx, subject, payment, "system", "payment.webhook_confirmed",
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

// The request or milestone a payment is for, its row locked.
async function lockSubject(tx: AnyDb, payment: Payment): Promise<Subject | null> {
  if (payment.kind === "materials" && payment.requestId) {
    const [request] = await tx.select().from(s.requests).where(eq(s.requests.id, payment.requestId)).for("update");
    return request ? { kind: "materials", request } : null;
  }
  if (payment.kind === "labour" && payment.milestoneId) {
    const [milestone] = await tx.select().from(s.milestones).where(eq(s.milestones.id, payment.milestoneId)).for("update");
    return milestone ? { kind: "labour", milestone } : null;
  }
  return null;
}

function projectOf(subject: Subject): string {
  return subject.kind === "materials" ? subject.request.projectId : subject.milestone.projectId;
}

function paymentsFor(subject: Subject): SQL {
  return subject.kind === "materials"
    ? eq(s.payments.requestId, subject.request.id)
    : and(eq(s.payments.milestoneId, subject.milestone.id), eq(s.payments.kind, "labour"))!;
}

function resultOf(subject: Subject, captureId: string, status?: string): Paid {
  return subject.kind === "materials"
    ? { requestId: subject.request.id, status: (status ?? subject.request.status) as Request["status"], captureId }
    : { milestoneId: subject.milestone.id, status: (status ?? subject.milestone.status) as Milestone["status"], captureId };
}

// Records what PayPal says happened to a capture. Only COMPLETED marks the request (or the
// milestone's labour) paid.
async function applyCapture(
  tx: AnyDb,
  subject: Subject,
  payment: Payment,
  capture: PayPalCapture,
  ownerActor: string,
  deps: PaymentDeps,
  paid: string[],
  extra?: object,
): Promise<PaymentOutcome<Paid>> {
  const ids = { paypalCaptureId: capture.id };
  const request = subject.kind === "materials" ? subject.request : null;
  const approved = request
    ? (request.status === "approved" ? request.status : requestMachine.transition(request.status, "owner_approved"))
    : null;

  if (capture.status === "COMPLETED") {
    await tx.update(s.payments).set({
      ...ids, status: paymentMachine.transition(payment.status, "captured"), capturedAt: (deps.now ?? (() => new Date()))(),
    }).where(eq(s.payments.id, payment.id));
    let status: string;
    if (request) {
      status = requestMachine.transition(approved!, "captured");
      await tx.update(s.requests).set({ status: status as Request["status"] }).where(eq(s.requests.id, request.id));
    } else {
      const milestone = (subject as Extract<Subject, { kind: "labour" }>).milestone;
      status = milestoneMachine.transition(milestone.status, "labour_paid");
      await tx.update(s.milestones).set({ status: status as Milestone["status"] }).where(eq(s.milestones.id, milestone.id));
    }
    paid.push(payment.id);
    const data = capture.amount || extra ? { ...(capture.amount && { captured: capture.amount }), ...extra } : undefined;
    await audit(tx, subject, payment, ownerActor, "payment.captured",
      `USD ${centsToAmount(payment.amountUsdCents)} was paid through PayPal to ${await payeeName(tx, payment)}.`,
      capture.id, data);
    if (subject.kind === "labour") await startNextMilestone(tx, subject.milestone);
    return ok(resultOf(subject, capture.id, status));
  }

  if (capture.status === "PENDING") {
    // PayPal hasn't credited the payee yet. A request stays approved and a milestone keeps a
    // pending capture on its payment, so neither can be paid again; the capture webhook finishes it.
    await tx.update(s.payments).set(ids).where(eq(s.payments.id, payment.id));
    if (request) await tx.update(s.requests).set({ status: approved! }).where(eq(s.requests.id, request.id));
    await audit(tx, subject, payment, ownerActor, "payment.capture_pending",
      `PayPal accepted the payment but hasn't credited ${await payeeName(tx, payment)} yet.`, capture.id, extra);
    return ok(resultOf(subject, capture.id, approved ?? undefined));
  }

  if (capture.status === "DECLINED" || capture.status === "FAILED") {
    const event = capture.status === "DECLINED" ? "denied" : "failed";
    await tx.update(s.payments).set({ ...ids, status: paymentMachine.transition(payment.status, event) }).where(eq(s.payments.id, payment.id));
    if (request) {
      await tx.update(s.requests).set({ status: requestMachine.transition(approved!, "capture_failed") }).where(eq(s.requests.id, request.id));
    }
    const after = request ? "the request is waiting for approval again" : "the labour can be paid again";
    await audit(tx, subject, payment, ownerActor, "payment.capture_declined",
      `PayPal declined the payment. Nothing was paid, and ${after}.`, capture.id, extra);
    return fail(402, "capture_declined", "PayPal declined the payment. Nothing was paid; the owner can try again.");
  }

  throw new Error(`A new capture can't be ${capture.status}.`);
}

// Once a milestone's labour is paid, the milestones waiting on it can start.
async function startNextMilestone(tx: AnyDb, milestone: Milestone) {
  const next = await tx.select().from(s.milestones)
    .where(and(eq(s.milestones.dependsOnId, milestone.id), eq(s.milestones.status, "planned"))).for("update");
  for (const m of next) {
    await tx.update(s.milestones).set({ status: milestoneMachine.transition(m.status, "started") }).where(eq(s.milestones.id, m.id));
    await tx.insert(s.auditEvents).values({
      projectId: m.projectId,
      kind: "milestone",
      action: "milestone.started",
      description: `${m.name} started: the labour for ${milestone.name} is paid.`,
      actor: "system",
      milestoneId: m.id,
      data: { after: milestone.id },
    });
  }
}

// The money trail names the supplier or the fundi, never their PayPal email.
async function payeeName(tx: AnyDb, payment: Payment): Promise<string> {
  if (payment.payeeContactId) {
    const [contact] = await tx.select({ name: s.siteContacts.name }).from(s.siteContacts).where(eq(s.siteContacts.id, payment.payeeContactId));
    return contact?.name ?? "the fundi";
  }
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
  subject: Subject,
  payment: Payment,
  actor: string,
  action: string,
  description: string,
  paypalCaptureId?: string,
  data?: object,
) {
  return tx.insert(s.auditEvents).values({
    projectId: projectOf(subject),
    kind: "payment",
    action,
    description,
    actor,
    requestId: subject.kind === "materials" ? subject.request.id : null,
    milestoneId: subject.kind === "labour" ? subject.milestone.id : null,
    paymentId: payment.id,
    amountKesCents: payment.amountKesCents,
    amountUsdCents: payment.amountUsdCents,
    paypalOrderId: payment.paypalOrderId,
    paypalCaptureId: paypalCaptureId ?? null,
    data,
  });
}
