// WhatsApp confirmations once someone has been paid. A supplier's payment: one to the foreman who
// asked for the materials, one to each of the supplier's own contacts on the project. A labour
// payment: one to the fundi who was paid. Fixed templates only, filled with the amount and names
// from the database. They go out through notifyContact, so only mapped test phones get a real
// message. Each step is written to the money trail.

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { formatKes } from "@/server/pricing/money";
import { type NotifyOutcome, notifyContact } from "@/server/whatsapp/notify";
import { renderTemplate } from "@/server/whatsapp/templates";

export type ConfirmationDeps = {
  db: AnyDb;
  send: (to: string, body: string) => Promise<string>; // returns Twilio's message SID
  testPhones: Map<string, string>; // phone → contact ID, as parseTestPhones reads it
};

type Payment = typeof s.payments.$inferSelect;
type Outcome = NotifyOutcome;

export async function sendPaymentConfirmations(deps: ConfirmationDeps, paymentId: string): Promise<Outcome[]> {
  const { db } = deps;
  const [payment] = await db.select().from(s.payments).where(eq(s.payments.id, paymentId));
  if (payment?.status !== "captured") return [];
  const notifier = { channel: "whatsapp" as const, send: deps.send, testPhones: deps.testPhones };
  const outcomes: Outcome[] = [];

  if (payment.kind === "labour") {
    if (!payment.payeeContactId || !payment.milestoneId) return [];
    const [fundi] = await db.select().from(s.siteContacts).where(eq(s.siteContacts.id, payment.payeeContactId));
    const [milestone] = await db.select({ name: s.milestones.name }).from(s.milestones).where(eq(s.milestones.id, payment.milestoneId));
    if (fundi && milestone) {
      const body = renderTemplate("labour_paid", fundi.language, { amount: formatKes(payment.amountKesCents), milestone: milestone.name });
      outcomes.push(await notifyContact(db, notifier, fundi, "labour_paid", body));
    }
    await auditConfirmations(db, payment, outcomes, null);
    return outcomes;
  }

  if (!payment.requestId || !payment.payeeSupplierId) return [];
  const [request] = await db.select().from(s.requests).where(eq(s.requests.id, payment.requestId));
  const [supplier] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, payment.payeeSupplierId));
  const params = { supplier: supplier.name, amount: formatKes(payment.amountKesCents) };

  const supplierContacts = await db.select().from(s.siteContacts).where(and(
    eq(s.siteContacts.projectId, payment.projectId), eq(s.siteContacts.supplierId, supplier.id),
  ));
  const [foreman] = request.contactId
    ? await db.select().from(s.siteContacts).where(eq(s.siteContacts.id, request.contactId))
    : [];

  if (foreman && foreman.supplierId !== supplier.id) {
    const body = renderTemplate("materials_paid_foreman", foreman.language, params);
    outcomes.push(await notifyContact(db, notifier, foreman, "materials_paid_foreman", body));
  }
  for (const contact of supplierContacts) {
    const body = renderTemplate("materials_paid_supplier", contact.language, params);
    outcomes.push(await notifyContact(db, notifier, contact, "materials_paid_supplier", body));
  }
  await auditConfirmations(db, payment, outcomes, request.id);
  return outcomes;
}

async function auditConfirmations(db: AnyDb, payment: Payment, outcomes: Outcome[], requestId: string | null) {
  const sent = outcomes.filter((outcome) => outcome.sent).length;
  await db.insert(s.auditEvents).values({
    projectId: payment.projectId,
    kind: "payment",
    action: "payment.confirmations",
    description: outcomes.length === 0
      ? "No one on site was set up to receive a WhatsApp confirmation of this payment."
      : `WhatsApp confirmations of this payment: ${sent} of ${outcomes.length} sent.`,
    actor: "system",
    requestId,
    paymentId: payment.id,
    milestoneId: payment.milestoneId,
    paypalOrderId: payment.paypalOrderId,
    paypalCaptureId: payment.paypalCaptureId,
    data: { outcomes },
  });
}
