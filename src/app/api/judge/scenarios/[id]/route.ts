// POST /api/judge/scenarios/[id] — runs one Judge Mode scenario on the server and answers when it has
// finished, with the records it made. No model is called (recorded answers are replayed and labelled),
// nothing is sent to a phone, and no money moves.

import type { NextRequest } from "next/server";
import type { ScenarioResult } from "@/shared/api";
import { DEMO } from "@/server/db/demo";
import { apiError, notFound, readJson } from "@/server/http";
import { liveJudgeDeps } from "@/server/judge/live";
import { isScenarioId, runScenario, ScenarioNeedsReset } from "@/server/judge/scenarios";
import { runScenarioSchema } from "@/server/schemas";
import { describeError } from "@/server/whatsapp/intake";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/judge/scenarios/[id]">) {
  const { id } = await ctx.params;
  if (!isScenarioId(id)) return notFound("Scenario");
  const body = await readJson(request, runScenarioSchema);
  if ("response" in body) return body.response;
  if (body.data.projectId !== DEMO.projectId) return notFound("Project");

  try {
    const result: ScenarioResult = await runScenario(liveJudgeDeps(request.nextUrl.origin), id);
    return Response.json(result);
  } catch (error) {
    if (error instanceof ScenarioNeedsReset) return apiError(409, "reset_needed", error.message);
    console.error(`Judge Mode scenario ${id} failed:`, describeError(error));
    return apiError(500, "internal_error", "The scenario couldn't finish. Reset the demo and try again.");
  }
}
