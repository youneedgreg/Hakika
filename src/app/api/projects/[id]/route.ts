// GET /api/projects/[id] — project details, from the database.

import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/http";
import { loadProjectDetails } from "@/server/projects/details";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const details = await loadProjectDetails(getDb(), id);
  return details ? Response.json(details) : notFound("Project");
}
