// GET /api/projects/[id]/overview — the owner dashboard. Mock data until the database is built.

import type { NextRequest } from "next/server";
import { mockJson, notFound } from "@/server/http";
import { DEMO_PROJECT_ID, overview } from "@/server/mocks/demo";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]/overview">) {
  const { id } = await ctx.params;
  if (id !== DEMO_PROJECT_ID) return notFound("Project");
  return mockJson(overview);
}
