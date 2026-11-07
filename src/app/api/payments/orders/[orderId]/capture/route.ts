// POST /api/payments/orders/[orderId]/capture — capture after the owner approves in PayPal, for a
// request's order or a milestone's labour order. The capture response is the source of truth; a retry sends the same PayPal-Request-Id, so it can't
// charge twice. The demo's mock order answers as if it was paid.

import type { NextRequest } from "next/server";
import type { CaptureResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { mockJson } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";
import { captureOrderForRequest } from "@/server/payments/orders";
import { confirmAfterResponse } from "@/server/payments/live";
import { payPalFromEnv } from "@/server/payments/paypal";
import { paymentErrorResponse, paymentOutcomeResponse } from "@/server/payments/responses";

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/payments/orders/[orderId]/capture">,
) {
  const { orderId } = await ctx.params;
  if (orderId === "MOCK0RDER00000003") {
    const result: CaptureResult = { requestId: DEMO_REQUEST_ID, status: "paid", captureId: "MOCKCAPTURE0000003" };
    return mockJson(result);
  }
  try {
    const db = getDb();
    const outcome = await captureOrderForRequest(db, orderId, {
      paypal: payPalFromEnv(),
      appUrl: new URL(request.url).origin,
      onPaid: confirmAfterResponse(db),
    });
    return paymentOutcomeResponse(outcome);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
