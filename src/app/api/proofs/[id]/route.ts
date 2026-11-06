// GET /api/proofs/[id] — the proof review: checks, evidence and outcome, from the database.
// The demo proof IDs still answer with mock data, so the demo pages keep working.
// No owner sign-in yet: like the rest of the API, anyone with the proof's ID can read it.

import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { apiError, mockJson, notFound } from "@/server/http";
import { proofReviews } from "@/server/mocks/demo";
import { liveProofVision } from "@/server/proofs/live";
import { isWellFormedProofId, loadProofReview } from "@/server/proofs/review";
import { describeError } from "@/server/whatsapp/intake";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/proofs/[id]">) {
  const { id } = await ctx.params;
  if (Object.hasOwn(proofReviews, id)) return mockJson(proofReviews[id]);
  if (!isWellFormedProofId(id)) return notFound("Proof");
  try {
    const review = await loadProofReview({ db: getDb(), vision: liveProofVision() }, id);
    if (!review) return notFound("Proof");
    return Response.json(review, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("A proof review could not be loaded:", describeError(error));
    return apiError(500, "internal_error", "Something went wrong. Please try again.");
  }
}
