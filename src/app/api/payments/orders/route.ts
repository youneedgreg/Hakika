// POST /api/payments/orders — create the PayPal order for a request. The browser names the request
// only; the server will compute the amount from the database. Mock: returns a fake order ID that
// PayPal will not recognise, so the real button can't approve it until this route goes live.

import type { NextRequest } from "next/server";
import type { CreateOrderResult } from "@/shared/api";
import { mockJson, notFound, readJson } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";
import { createOrderSchema } from "@/server/schemas";

export async function POST(request: NextRequest) {
  const body = await readJson(request, createOrderSchema);
  if ("response" in body) return body.response;
  if (body.data.requestId !== DEMO_REQUEST_ID) return notFound("Request");
  const result: CreateOrderResult = { orderId: "MOCK0RDER00000003" };
  return mockJson(result, 201);
}
