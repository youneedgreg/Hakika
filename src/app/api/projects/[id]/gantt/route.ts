// GET /api/projects/[id]/gantt — milestones and payment gates for the Gantt, from the database.
// The page polls it every 10 seconds, so nothing caches it.

import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { apiError, notFound } from "@/server/http";
import { loadGantt } from "@/server/projects/gantt";
import { describeError } from "@/server/whatsapp/intake";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]/gantt">) {
  const { id } = await ctx.params;
  try {
    const gantt = await loadGantt(getDb(), id);
    if (!gantt) return notFound("Project");
    return Response.json(gantt, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("The Gantt could not be loaded:", describeError(error));
    return apiError(500, "internal_error", "Something went wrong. Please try again.");
  }
}
