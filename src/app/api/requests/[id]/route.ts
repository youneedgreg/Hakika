// GET /api/requests/[id] — the approval card. Mock data until requests are parsed and priced.

import type { NextRequest } from "next/server";
import { mockJson, notFound } from "@/server/http";
import { DEMO_REQUEST_ID, approvalCard } from "@/server/mocks/demo";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/requests/[id]">) {
  const { id } = await ctx.params;
  if (id !== DEMO_REQUEST_ID) return notFound("Request");
  return mockJson(approvalCard);
}
