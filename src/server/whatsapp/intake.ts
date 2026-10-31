// The one pipeline behind both the Twilio webhook and Judge Mode's simulator: store the message,
// copy its media to our own storage, and answer with a fixed template. WhatsApp text is stored as
// data; nothing in it is ever followed as an instruction.

import { eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import { newId } from "@/server/db/ids";
import * as s from "@/server/db/schema";
import type { MediaFile } from "./media";
import { renderTemplate, type TemplateKey } from "./templates";

export type IntakeDeps = {
  db: AnyDb;
  loadMedia: (url: string) => Promise<MediaFile>;
  storeMedia: (path: string, file: MediaFile) => Promise<string>;
  send: (to: string, body: string) => Promise<string>;
};

export type InboundMessage = {
  id?: string;
  kind: "text" | "image" | "voice" | "location";
  text?: string;
  media?: { url: string };
  location?: { lat: number; lng: number };
  unsupported?: boolean;
} & (
  | { channel: "whatsapp"; twilioSid: string; replyTo: string } // answered through Twilio
  | { channel: "simulator" } // Judge Mode: the answer is stored, never sent
);

type Contact = typeof s.siteContacts.$inferSelect;

// Real test phones are mapped onto the seeded contacts through the environment, so no real number
// is ever committed: WHATSAPP_TEST_PHONES="+254700000000=c-peter,+254700000001=c-grace".
export function parseTestPhones(raw = ""): Map<string, string> {
  const pairs = raw.split(",").map((pair) => pair.split("=").map((part) => part.trim()));
  return new Map(pairs.filter((pair) => pair.length === 2 && pair[0] && pair[1]) as [string, string][]);
}

export async function findContactByPhone(db: AnyDb, phone: string, testPhones: Map<string, string>) {
  const mapped = testPhones.get(phone);
  const where = mapped ? eq(s.siteContacts.id, mapped) : eq(s.siteContacts.whatsappNumber, phone);
  const [contact] = await db.select().from(s.siteContacts).where(where).limit(1);
  return contact;
}

export async function findContactById(db: AnyDb, id: string) {
  const [contact] = await db.select().from(s.siteContacts).where(eq(s.siteContacts.id, id)).limit(1);
  return contact;
}

// Returns the stored message's ID, or null if Twilio delivered the same message twice.
export async function processInbound(deps: IntakeDeps, contact: Contact, message: InboundMessage): Promise<string | null> {
  const { db } = deps;
  const [stored] = await db.insert(s.messages).values({
    id: message.id ?? newId("msg"),
    projectId: contact.projectId,
    contactId: contact.id,
    direction: "inbound",
    channel: message.channel,
    kind: message.kind,
    body: message.text ?? null,
    latitude: message.location?.lat ?? null,
    longitude: message.location?.lng ?? null,
    twilioSid: message.channel === "whatsapp" ? message.twilioSid : null,
  }).onConflictDoNothing({ target: s.messages.twilioSid }).returning({ id: s.messages.id });
  if (!stored) return null;

  let template: TemplateKey = message.unsupported ? "needs_info" : "request_received";
  if (message.media) {
    try {
      const file = await deps.loadMedia(message.media.url);
      const mediaPath = await deps.storeMedia(`whatsapp/${stored.id}.${file.extension}`, file);
      await db.update(s.messages)
        .set({ mediaPath, mediaContentType: file.contentType })
        .where(eq(s.messages.id, stored.id));
    } catch (error) {
      console.error("WhatsApp media was not saved:", describeError(error));
      template = "needs_info";
    }
  }

  const body = renderTemplate(template, contact.language);
  const twilioSid = message.channel === "whatsapp" ? await deps.send(message.replyTo, body) : null;
  await db.insert(s.messages).values({
    projectId: contact.projectId,
    contactId: contact.id,
    direction: "outbound",
    channel: message.channel,
    kind: "template",
    body,
    templateKey: template,
    language: contact.language,
    twilioSid,
  });
  return stored.id;
}

// Safe to log: database errors can quote a query's values, which may include a message or a number.
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  return error.message.includes("Failed query") ? "database query failed" : error.message;
}
