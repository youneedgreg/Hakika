// GET /api/projects/[id]/overview — the owner dashboard, from the database.

import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/http";
import { loadOverview } from "@/server/projects/overview";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]/overview">) {
  const { id } = await ctx.params;
  const overview = await loadOverview(getDb(), id);
  return overview ? Response.json(overview) : notFound("Project");
}
