// POST /api/webhooks/paypal — PayPal's capture and refund events. Each delivery is checked with
// PayPal's verify-webhook-signature API before anything is read from it, and repeats are ignored.
// A non-2xx answer makes PayPal retry (up to 25 times over 3 days), so only failures worth
// retrying get one.

import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { apiError } from "@/server/http";
import { PayPalApiError, PayPalNotConfigured, payPalFromEnv, type PayPalClient } from "@/server/payments/paypal";
import { handlePayPalEvent, payPalEventSchema } from "@/server/payments/webhooks";
import { describeError } from "@/server/whatsapp/intake";

const MAX_BODY_BYTES = 64 * 1024; // PayPal's capture events are a few KB

export async function POST(request: NextRequest) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  let paypal: PayPalClient;
  try {
    paypal = payPalFromEnv();
  } catch (error) {
    if (error instanceof PayPalNotConfigured) return notConfigured();
    throw error;
  }
  if (!webhookId) return notConfigured();

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return apiError(413, "too_large", "The webhook body is too large.");

  let verified: boolean;
  try {
    verified = await paypal.verifyWebhookSignature({ headers: request.headers, rawBody, webhookId });
  } catch (error) {
    console.error("PayPal webhook verification failed:", error instanceof PayPalApiError ? `${error.message} debug id: ${error.debugId}` : describeError(error));
    return apiError(502, "paypal_error", "PayPal didn't answer the signature check.");
  }
  if (!verified) return apiError(401, "invalid_signature", "The PayPal signature is not valid.");

  // Signed by PayPal but not an event shape we read: accept it, so PayPal stops retrying.
  const event = payPalEventSchema.safeParse(JSON.parse(rawBody));
  if (!event.success) {
    console.warn("Ignored a signed PayPal webhook with an unexpected shape.");
    return Response.json({ result: "ignored" });
  }

  try {
    const result = await handlePayPalEvent(getDb(), event.data, { paypal, appUrl: new URL(request.url).origin });
    return Response.json({ result });
  } catch (error) {
    console.error("PayPal webhook processing failed:", describeError(error));
    return apiError(500, "webhook_failed", "The event could not be processed; PayPal will retry it.");
  }
}

function notConfigured() {
  return apiError(503, "paypal_webhook_not_configured", "The PayPal webhook is not set up on this server.");
}
