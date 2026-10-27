// GET /api/projects/[id]/gantt — milestones and payment gates for the Gantt. Mock data for now.

import type { NextRequest } from "next/server";
import { mockJson, notFound } from "@/server/http";
import { DEMO_PROJECT_ID, gantt } from "@/server/mocks/demo";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]/gantt">) {
  const { id } = await ctx.params;
  if (id !== DEMO_PROJECT_ID) return notFound("Project");
  return mockJson(gantt);
}
