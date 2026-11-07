// Messages Hakika starts itself, not replies: payment confirmations and fresh-proof codes.
//
// Real WhatsApp messages go only to test phones mapped in WHATSAPP_TEST_PHONES, never to a seeded
// contact's number: those are made up, and a made-up Kenyan number can belong to a real person.
// A contact without a test phone gets the message stored, unsent. In Judge Mode nothing is sent:
// the message is stored on the simulator channel, where the simulator shows it.

import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { describeError } from "./intake";

type Contact = typeof s.siteContacts.$inferSelect;

export type Notifier = {
  channel: "whatsapp" | "simulator";
  send: (to: string, body: string) => Promise<string>; // returns Twilio's message SID
  testPhones: Map<string, string>; // phone → contact ID, as parseTestPhones reads it
};

export type NotifyOutcome = { contactId: string; sent: boolean; reason?: "no_test_phone" | "send_failed" | "simulator" };

// Sends one fixed template to a contact's test phone, if they have one, and stores it either way.
// `storedBody` is what the database keeps (a proof link's token hidden). A failed send is logged
// and reported, not thrown.
export async function notifyContact(
  db: AnyDb,
  notifier: Notifier,
  contact: Contact,
  templateKey: string,
  body: string,
  storedBody = body,
): Promise<NotifyOutcome> {
  let twilioSid: string | null = null;
  let outcome: NotifyOutcome = { contactId: contact.id, sent: false, reason: "simulator" };
  if (notifier.channel === "whatsapp") {
    const phone = [...notifier.testPhones].find(([, contactId]) => contactId === contact.id)?.[0];
    outcome = { contactId: contact.id, sent: false, reason: "no_test_phone" };
    if (phone) {
      try {
        twilioSid = await notifier.send(phone, body);
        outcome = { contactId: contact.id, sent: true };
      } catch (error) {
        console.error(`A ${templateKey} message was not sent:`, describeError(error));
        outcome = { contactId: contact.id, sent: false, reason: "send_failed" };
      }
    }
  }
  await db.insert(s.messages).values({
    projectId: contact.projectId,
    contactId: contact.id,
    direction: "outbound",
    channel: notifier.channel,
    kind: "template",
    body: storedBody,
    templateKey,
    language: contact.language,
    twilioSid,
  });
  return outcome;
}
