// POST /api/webhooks/twilio — inbound WhatsApp. Checks X-Twilio-Signature, replies at once with an
// empty answer (Twilio needs a fast reply), and does the slow work after the response has gone.

import { after, type NextRequest } from "next/server";
import { apiError } from "@/server/http";
import { describeError, findContactByPhone, parseTestPhones, processInbound } from "@/server/whatsapp/intake";
import { twilioDeps } from "@/server/whatsapp/live";
import {
  isValidTwilioSignature, parseTwilioMessage, twilioWebhookUrl, type ParsedTwilioMessage,
} from "@/server/whatsapp/twilio";

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const url = twilioWebhookUrl();
  if (!authToken || !url) return apiError(500, "not_configured", "The Twilio webhook is not configured.");

  const params = Object.fromEntries(new URLSearchParams(await request.text()));
  const signature = request.headers.get("x-twilio-signature");
  if (!signature || !isValidTwilioSignature(authToken, signature, url, params)) {
    return apiError(403, "invalid_signature", "The Twilio signature is not valid.");
  }

  const message = parseTwilioMessage(params);
  if (message) after(() => handle(message));
  return new Response("<Response/>", { headers: { "Content-Type": "text/xml" } });
}

async function handle(message: ParsedTwilioMessage) {
  try {
    const deps = twilioDeps();
    const testPhones = parseTestPhones(process.env.WHATSAPP_TEST_PHONES);
    const contact = await findContactByPhone(deps.db, message.from, testPhones);
    if (!contact) {
      console.warn("Ignored a WhatsApp message from a number that is not a site contact.");
      return;
    }
    const { from, ...rest } = message;
    await processInbound(deps, contact, { ...rest, channel: "whatsapp", replyTo: from });
  } catch (error) {
    console.error("WhatsApp intake failed:", describeError(error));
  }
}
