// POST /api/payments/orders — create the PayPal order for a request (materials, to the supplier) or
// a verified milestone (labour, to the fundi). The browser names one of them only; the server
// computes the amount, the payee and the rate from the database. The demo request stays mock data
// (a fake order ID PayPal won't recognise) until its approval card moves to the database.

import type { NextRequest } from "next/server";
import type { CreateOrderResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { mockJson, readJson } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";
import { createOrderForMilestone, createOrderForRequest } from "@/server/payments/orders";
import { confirmAfterResponse } from "@/server/payments/live";
import { payPalFromEnv } from "@/server/payments/paypal";
import { paymentErrorResponse, paymentOutcomeResponse } from "@/server/payments/responses";
import { createOrderSchema } from "@/server/schemas";

export async function POST(request: NextRequest) {
  const body = await readJson(request, createOrderSchema);
  if ("response" in body) return body.response;
  if ("requestId" in body.data && body.data.requestId === DEMO_REQUEST_ID) {
    const result: CreateOrderResult = { orderId: "MOCK0RDER00000003" };
    return mockJson(result, 201);
  }
  try {
    const db = getDb();
    const deps = {
      paypal: payPalFromEnv(),
      appUrl: new URL(request.url).origin,
      onPaid: confirmAfterResponse(db),
    };
    const outcome = "requestId" in body.data
      ? await createOrderForRequest(db, body.data.requestId, deps)
      : await createOrderForMilestone(db, body.data.milestoneId, deps);
    return paymentOutcomeResponse(outcome, 201);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
