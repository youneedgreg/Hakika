// POST /api/webhooks/paypal — verified PayPal events. Stub until payments are built:
// it will verify each event's signature with PayPal and ignore repeated event IDs.

import { notImplemented } from "@/server/http";

export async function POST() {
  return notImplemented("The PayPal webhook");
}
