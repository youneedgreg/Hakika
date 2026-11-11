// POST /api/requests/[id]/decline — the owner declines a request waiting for approval, with a reason
// logged in the money trail. Nothing is paid, and an unpaid PayPal order for it is closed. The
// foreman is told in a fixed template after the response. The demo request ID still answers with
// mock data (nothing stored), so the demo pages keep working.

import { after, type NextRequest } from "next/server";
import type { DeclineResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { apiError, mockJson, readJson } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";
import { declineRequest, notifyDeclined } from "@/server/requests/decline";
import { declineSchema } from "@/server/schemas";
import { describeError, parseTestPhones } from "@/server/whatsapp/intake";
import { sendWhatsApp } from "@/server/whatsapp/twilio";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[id]/decline">) {
  const { id } = await ctx.params;
  const body = await readJson(request, declineSchema);
  if ("response" in body) return body.response;
  if (id === DEMO_REQUEST_ID) {
    const result: DeclineResult = { requestId: id, status: "declined" };
    return mockJson(result);
  }
  try {
    const db = getDb();
    const outcome = await declineRequest({ db }, id, body.data.reason);
    if (!outcome.ok) return apiError(outcome.httpStatus, outcome.code, outcome.message);
    if (outcome.newlyDeclined) {
      after(async () => {
        try {
          await notifyDeclined(db, { send: sendWhatsApp, testPhones: parseTestPhones(process.env.WHATSAPP_TEST_PHONES) }, id);
        } catch (error) {
          console.error("The decline message was not sent:", describeError(error));
        }
      });
    }
    return Response.json(outcome.value);
  } catch (error) {
    console.error("A decline was not saved:", describeError(error));
    return apiError(500, "internal_error", "The decline was not saved. Please try again.");
  }
}
