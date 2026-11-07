// POST /api/proofs/[id]/override — the owner overrides a verdict with a typed reason, logged in the
// money trail. The delivery or milestone the proof was for becomes verified, which lifts the hold on
// its payments; no money moves until the owner approves a payment in PayPal.
// The demo proof IDs still answer with mock data (nothing stored), so the demo pages keep working.
// No owner sign-in yet: like the payment routes, the project's owner is recorded (Day 17 adds it).

import type { NextRequest } from "next/server";
import type { OverrideResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { apiError, mockJson, notFound, readJson } from "@/server/http";
import { proofReviews } from "@/server/mocks/demo";
import { overrideVerdict } from "@/server/proofs/override";
import { isWellFormedProofId } from "@/server/proofs/review";
import { overrideSchema } from "@/server/schemas";
import { describeError } from "@/server/whatsapp/intake";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/proofs/[id]/override">) {
  const { id } = await ctx.params;
  const isDemo = Object.hasOwn(proofReviews, id);
  if (!isDemo && !isWellFormedProofId(id)) return notFound("Proof");
  const body = await readJson(request, overrideSchema);
  if ("response" in body) return body.response;
  if (isDemo) {
    const result: OverrideResult = { proofId: id, overridden: true, reason: body.data.reason, at: new Date().toISOString() };
    return mockJson(result);
  }
  try {
    const outcome = await overrideVerdict({ db: getDb() }, id, body.data.reason);
    return outcome.ok ? Response.json(outcome.value) : apiError(outcome.httpStatus, outcome.code, outcome.message);
  } catch (error) {
    console.error("An override was not saved:", describeError(error));
    return apiError(500, "internal_error", "The override was not saved. Please try again.");
  }
}
