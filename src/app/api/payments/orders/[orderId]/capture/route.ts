// POST /api/payments/orders/[orderId]/capture — capture after the owner approves in PayPal.
// Mock: nothing is captured; it answers as if the mock order was paid.

import type { NextRequest } from "next/server";
import type { CaptureResult } from "@/shared/api";
import { mockJson, notFound } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";

export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/payments/orders/[orderId]/capture">,
) {
  const { orderId } = await ctx.params;
  if (orderId !== "MOCK0RDER00000003") return notFound("Order");
  const result: CaptureResult = {
    requestId: DEMO_REQUEST_ID,
    status: "paid",
    captureId: "MOCKCAPTURE0000003",
  };
  return mockJson(result);
}
