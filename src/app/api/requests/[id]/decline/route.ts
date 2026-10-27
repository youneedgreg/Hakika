// POST /api/requests/[id]/decline — the owner declines with a reason. Mock: nothing is stored
// and no WhatsApp message is sent yet.

import type { NextRequest } from "next/server";
import type { DeclineResult } from "@/shared/api";
import { mockJson, notFound, readJson } from "@/server/http";
import { DEMO_REQUEST_ID } from "@/server/mocks/demo";
import { declineSchema } from "@/server/schemas";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[id]/decline">) {
  const { id } = await ctx.params;
  if (id !== DEMO_REQUEST_ID) return notFound("Request");
  const body = await readJson(request, declineSchema);
  if ("response" in body) return body.response;
  const result: DeclineResult = { requestId: id, status: "declined" };
  return mockJson(result);
}
