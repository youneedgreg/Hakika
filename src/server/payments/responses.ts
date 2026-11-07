// Turning payment outcomes and failures into API responses for the two payment routes.

import { apiError } from "@/server/http";
import { FxRateUnavailable } from "@/server/pricing/fx";
import { describeError } from "@/server/whatsapp/intake";
import type { PaymentOutcome } from "./orders";
import { PayPalApiError, PayPalNotConfigured } from "./paypal";

export function paymentOutcomeResponse<T>(outcome: PaymentOutcome<T>, okStatus = 200): Response {
  return outcome.ok
    ? Response.json(outcome.value, { status: okStatus })
    : apiError(outcome.httpStatus, outcome.code, outcome.message);
}

// Nothing was written here when one of these is thrown: the payment step rolls back. PayPal may
// still have acted (a capture whose answer got lost), so the messages don't promise nothing was
// paid; a retry is safe because it reuses the same PayPal-Request-Id.
export function paymentErrorResponse(error: unknown): Response {
  if (error instanceof PayPalNotConfigured) {
    return apiError(503, "paypal_not_configured", "PayPal payments are not set up on this server.");
  }
  if (error instanceof FxRateUnavailable) {
    return apiError(503, "fx_rate_unavailable", "The USD/KES rate is not available right now.");
  }
  if (error instanceof PayPalApiError) {
    console.error("PayPal call failed:", error.message, "debug id:", error.debugId);
    return apiError(502, "paypal_error", "PayPal didn't confirm the request. Try again: a retry can't pay twice.");
  }
  console.error("Payment step failed:", describeError(error));
  return apiError(500, "payment_failed", "The payment step failed. Try again: a retry can't pay twice.");
}
