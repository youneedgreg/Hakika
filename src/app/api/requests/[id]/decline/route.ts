// POST /api/requests/[id]/decline — the owner declines a request waiting for approval, with a reason
// logged in the money trail. Nothing is paid, and an unpaid PayPal order for it is closed. No
// WhatsApp message is sent yet. The demo request ID still answers with mock data (nothing stored),
// so the demo pages keep working.

import type { NextRequest } from "next/server";
import type { DeclineResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { apiError, mockJson, readJson } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";
import { declineRequest } from "@/server/requests/decline";
import { declineSchema } from "@/server/schemas";
import { describeError } from "@/server/whatsapp/intake";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[id]/decline">) {
  const { id } = await ctx.params;
  const body = await readJson(request, declineSchema);
  if ("response" in body) return body.response;
  if (id === DEMO_REQUEST_ID) {
    const result: DeclineResult = { requestId: id, status: "declined" };
    return mockJson(result);
  }
  try {
    const outcome = await declineRequest({ db: getDb() }, id, body.data.reason);
    return outcome.ok ? Response.json(outcome.value) : apiError(outcome.httpStatus, outcome.code, outcome.message);
  } catch (error) {
    console.error("A decline was not saved:", describeError(error));
    return apiError(500, "internal_error", "The decline was not saved. Please try again.");
  }
}
