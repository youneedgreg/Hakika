// POST /api/webhooks/twilio — inbound WhatsApp. Stub until the WhatsApp pipeline is built:
// it will validate X-Twilio-Signature, reply at once, and process the message after replying.

import { notImplemented } from "@/server/http";

export async function POST() {
  return notImplemented("The Twilio webhook");
}
