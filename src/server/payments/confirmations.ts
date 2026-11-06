// WhatsApp confirmations once a supplier has been paid: one to the foreman who asked for the
// materials, one to each of the supplier's own contacts on the project. Fixed templates only, filled
// with the amount and the supplier's name from the database.
//
// Real WhatsApp messages go only to test phones mapped in WHATSAPP_TEST_PHONES, never to a seeded
// contact's number: those are made up, and a made-up Kenyan number can belong to a real person.
// A contact without a test phone gets the message stored, unsent. Each step is written to the
// money trail.

import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { formatKes } from "@/server/pricing/money";
import { describeError } from "@/server/whatsapp/intake";
import { renderTemplate } from "@/server/whatsapp/templates";

export type ConfirmationDeps = {
  db: AnyDb;
  send: (to: string, body: string) => Promise<string>; // returns Twilio's message SID
  testPhones: Map<string, string>; // phone → contact ID, as parseTestPhones reads it
};

type Contact = typeof s.siteContacts.$inferSelect;
type Outcome = { contactId: string; sent: boolean; reason?: "no_test_phone" | "send_failed" };

export async function sendPaymentConfirmations(deps: ConfirmationDeps, paymentId: string): Promise<Outcome[]> {
  const { db } = deps;
  const [payment] = await db.select().from(s.payments).where(eq(s.payments.id, paymentId));
  // Labour payments get their own message with the milestone flow (Day 13).
  if (payment?.status !== "captured" || payment.kind !== "materials" || !payment.requestId || !payment.payeeSupplierId) return [];
  const [request] = await db.select().from(s.requests).where(eq(s.requests.id, payment.requestId));
  const [supplier] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, payment.payeeSupplierId));
  const params = { supplier: supplier.name, amount: formatKes(payment.amountKesCents) };

  const supplierContacts = await db.select().from(s.siteContacts).where(and(
    eq(s.siteContacts.projectId, payment.projectId), eq(s.siteContacts.supplierId, supplier.id),
  ));
  const [foreman] = request.contactId
    ? await db.select().from(s.siteContacts).where(eq(s.siteContacts.id, request.contactId))
    : [];

  const phones = new Map([...deps.testPhones].map(([phone, contactId]) => [contactId, phone]));
  const outcomes: Outcome[] = [];
  const deliver = async (contact: Contact, body: string, templateKey: string) => {
    const phone = phones.get(contact.id);
    let twilioSid: string | null = null;
    let outcome: Outcome = { contactId: contact.id, sent: false, reason: "no_test_phone" };
    if (phone) {
      try {
        twilioSid = await deps.send(phone, body);
        outcome = { contactId: contact.id, sent: true };
      } catch (error) {
        console.error("A payment confirmation was not sent:", describeError(error));
        outcome = { contactId: contact.id, sent: false, reason: "send_failed" };
      }
    }
    await db.insert(s.messages).values({
      projectId: payment.projectId,
      contactId: contact.id,
      direction: "outbound",
      channel: "whatsapp",
      kind: "template",
      body,
      templateKey,
      language: contact.language,
      twilioSid,
    });
    outcomes.push(outcome);
  };

  if (foreman && foreman.supplierId !== supplier.id) {
    await deliver(foreman, renderTemplate("materials_paid_foreman", foreman.language, params), "materials_paid_foreman");
  }
  for (const contact of supplierContacts) {
    await deliver(contact, renderTemplate("materials_paid_supplier", contact.language, params), "materials_paid_supplier");
  }

  const sent = outcomes.filter((outcome) => outcome.sent).length;
  await db.insert(s.auditEvents).values({
    projectId: payment.projectId,
    kind: "payment",
    action: "payment.confirmations",
    description: outcomes.length === 0
      ? "No one on site was set up to receive a WhatsApp confirmation of this payment."
      : `WhatsApp confirmations of this payment: ${sent} of ${outcomes.length} sent.`,
    actor: "system",
    requestId: request.id,
    paymentId: payment.id,
    paypalOrderId: payment.paypalOrderId,
    paypalCaptureId: payment.paypalCaptureId,
    data: { outcomes },
  });
  return outcomes;
}
