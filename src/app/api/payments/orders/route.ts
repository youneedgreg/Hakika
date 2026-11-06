// POST /api/payments/orders — create the PayPal order for a request. The browser names the request
// only; the server computes the amount, the payee and the rate from the database. The demo request
// stays mock data (a fake order ID PayPal won't recognise) until its approval card moves to the database.

import type { NextRequest } from "next/server";
import type { CreateOrderResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { mockJson, readJson } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";
import { createOrderForRequest } from "@/server/payments/orders";
import { confirmAfterResponse } from "@/server/payments/live";
import { payPalFromEnv } from "@/server/payments/paypal";
import { paymentErrorResponse, paymentOutcomeResponse } from "@/server/payments/responses";
import { createOrderSchema } from "@/server/schemas";

export async function POST(request: NextRequest) {
  const body = await readJson(request, createOrderSchema);
  if ("response" in body) return body.response;
  if (body.data.requestId === DEMO_REQUEST_ID) {
    const result: CreateOrderResult = { orderId: "MOCK0RDER00000003" };
    return mockJson(result, 201);
  }
  try {
    const db = getDb();
    const outcome = await createOrderForRequest(db, body.data.requestId, {
      paypal: payPalFromEnv(),
      appUrl: new URL(request.url).origin,
      onPaid: confirmAfterResponse(db),
    });
    return paymentOutcomeResponse(outcome, 201);
  } catch (error) {
    return paymentErrorResponse(error);
  }
}
