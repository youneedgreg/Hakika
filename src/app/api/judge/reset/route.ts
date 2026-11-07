// POST /api/judge/reset — rebuilds the demo project. Every judge shares it, so a reset is refused
// for RESET_COOLDOWN_S after the last one (429 reset_too_soon, with Retry-After).

import type { NextRequest } from "next/server";
import type { ResetResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { DEMO } from "@/server/db/demo";
import { apiError, notFound, readJson } from "@/server/http";
import { resetJudgeDemo } from "@/server/judge/chat";
import { demoPayees } from "@/server/judge/live";
import { resetSchema } from "@/server/schemas";
import { describeError } from "@/server/whatsapp/intake";

export async function POST(request: NextRequest) {
  const body = await readJson(request, resetSchema);
  if ("response" in body) return body.response;
  if (body.data.projectId !== DEMO.projectId) return notFound("Project");
  try {
    const outcome = await resetJudgeDemo(getDb(), demoPayees());
    if (!outcome.reset) {
      const response = apiError(429, "reset_too_soon", `The demo was reset moments ago. Try again in ${outcome.retryAfterS} seconds.`);
      response.headers.set("retry-after", String(outcome.retryAfterS));
      return response;
    }
    const result: ResetResult = { projectId: DEMO.projectId, reset: true };
    return Response.json(result);
  } catch (error) {
    console.error("The demo reset failed:", describeError(error));
    return apiError(500, "internal_error", "The demo couldn't be reset. Please try again.");
  }
}
