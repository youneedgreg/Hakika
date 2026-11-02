// GET /api/requests/[id] — the approval card. The demo request stays mock data until the rest of its
// flow (decline, PayPal order, capture) moves to the database; every other ID is a real request.

import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { apiError, mockJson, notFound } from "@/server/http";
import { DEMO_REQUEST_ID, approvalCard } from "@/server/mocks/demo";
import { FxRateUnavailable } from "@/server/pricing/fx";
import { loadApprovalCard } from "@/server/requests/card";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/requests/[id]">) {
  const { id } = await ctx.params;
  if (id === DEMO_REQUEST_ID) return mockJson(approvalCard);
  try {
    const card = await loadApprovalCard(getDb(), id);
    return card ? Response.json(card) : notFound("Request");
  } catch (error) {
    if (error instanceof FxRateUnavailable) {
      return apiError(503, "fx_rate_unavailable", "The USD/KES rate is not available right now.");
    }
    throw error;
  }
}
