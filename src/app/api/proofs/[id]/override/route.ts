// POST /api/proofs/[id]/override — the owner overrides a verdict with a typed reason, which will be
// logged in the money trail. Mock: nothing is stored or released.

import type { NextRequest } from "next/server";
import type { OverrideResult } from "@/shared/api";
import { mockJson, notFound, readJson } from "@/server/http";
import { proofReviews } from "@/server/mocks/demo";
import { overrideSchema } from "@/server/schemas";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/proofs/[id]/override">) {
  const { id } = await ctx.params;
  if (!Object.hasOwn(proofReviews, id)) return notFound("Proof");
  const body = await readJson(request, overrideSchema);
  if ("response" in body) return body.response;
  const result: OverrideResult = {
    proofId: id,
    overridden: true,
    reason: body.data.reason,
    at: new Date().toISOString(),
  };
  return mockJson(result);
}
