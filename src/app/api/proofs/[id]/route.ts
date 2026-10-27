// GET /api/proofs/[id] — the proof review: checks, evidence and outcome. Mock data for now.

import type { NextRequest } from "next/server";
import { mockJson, notFound } from "@/server/http";
import { proofReviews } from "@/server/mocks/demo";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/proofs/[id]">) {
  const { id } = await ctx.params;
  const review = Object.hasOwn(proofReviews, id) ? proofReviews[id] : undefined;
  if (!review) return notFound("Proof");
  return mockJson(review);
}
