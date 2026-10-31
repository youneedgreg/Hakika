// Everything that talks to Twilio: checking who sent a webhook, reading its form fields,
// sending a WhatsApp message and downloading media. Error messages here never include a phone number.

import { createHmac, timingSafeEqual } from "node:crypto";
import { readMediaResponse, type MediaFile } from "./media";

export class TwilioError extends Error {}

// https://www.twilio.com/docs/usage/security: the URL, then each POST field's name and value in
// sorted order, signed with HMAC-SHA1 using the Auth Token.
export function isValidTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const signed = Object.keys(params).sort().reduce((text, name) => text + name + params[name], url);
  const expected = createHmac("sha1", authToken).update(signed, "utf8").digest();
  const received = Buffer.from(signature, "base64");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// The exact URL set in the Twilio console. Behind Vercel, the request's own URL can't be relied on.
export function twilioWebhookUrl(): string | undefined {
  if (process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/api/webhooks/twilio` : undefined;
}

export type ParsedTwilioMessage = {
  twilioSid: string;
  from: string; // E.164, without the whatsapp: prefix
  kind: "text" | "image" | "voice" | "location";
  text?: string;
  media?: { url: string };
  location?: { lat: number; lng: number };
  unsupported: boolean; // a file or message type Hakika can't read, such as a video or a contact card
};

// Null when the fields are not an inbound WhatsApp message at all.
export function parseTwilioMessage(params: Record<string, string>): ParsedTwilioMessage | null {
  const { MessageSid: twilioSid, From: rawFrom, Body: body } = params;
  if (!twilioSid || !rawFrom?.startsWith("whatsapp:")) return null;
  const base = { twilioSid, from: rawFrom.slice("whatsapp:".length), text: body || undefined };

  if (Number(params.NumMedia) > 0 && params.MediaUrl0) {
    const type = params.MediaContentType0 ?? "";
    const kind = type.startsWith("image/") ? "image" : type.startsWith("audio/") ? "voice" : null;
    if (!kind) return { ...base, kind: "text", unsupported: true };
    return { ...base, kind, media: { url: params.MediaUrl0 }, unsupported: false };
  }

  const lat = Number(params.Latitude);
  const lng = Number(params.Longitude);
  if (params.Latitude && params.Longitude && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { ...base, kind: "location", location: { lat, lng }, unsupported: false };
  }

  return { ...base, kind: "text", unsupported: !body };
}

function credentials() {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token } = process.env;
  if (!sid || !token) throw new TwilioError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set.");
  return { sid, authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
}

export async function sendWhatsApp(to: string, body: string): Promise<string> {
  const { sid, authorization } = credentials();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new TwilioError("TWILIO_WHATSAPP_FROM must be set.");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: `whatsapp:${to}`, Body: body }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = (await response.json().catch(() => ({}))) as { sid?: string; code?: number };
  if (!response.ok || !result.sid) {
    throw new TwilioError(`Twilio refused the message: HTTP ${response.status}, code ${result.code ?? "none"}.`);
  }
  return result.sid;
}

// Twilio media URLs need our credentials, so they are only ever sent to Twilio's own API host.
export async function fetchTwilioMedia(url: string): Promise<MediaFile> {
  const { authorization } = credentials();
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.twilio.com") {
    throw new TwilioError("The media URL is not on api.twilio.com.");
  }
  const response = await fetch(parsed, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new TwilioError(`Twilio media download failed: HTTP ${response.status}.`);
  return readMediaResponse(response);
}
