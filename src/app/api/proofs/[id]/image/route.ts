// GET /api/proofs/[id]/image — the proof photo, streamed from private Blob storage.
// No owner sign-in yet: like the rest of the API, anyone with the proof's ID can see it.
// Demo proofs have their own images under /mock, so they aren't served here.

import { get } from "@vercel/blob";
import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { apiError, notFound } from "@/server/http";
import { isWellFormedProofId, proofImageResponse } from "@/server/proofs/review";
import { describeError } from "@/server/whatsapp/intake";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/proofs/[id]/image">) {
  const { id } = await ctx.params;
  if (!isWellFormedProofId(id)) return notFound("Proof photo");
  try {
    const response = await proofImageResponse(getDb(), id, async (path) => {
      const blob = await get(path, { access: "private" });
      return blob?.statusCode === 200 ? blob.stream : null;
    });
    return response ?? notFound("Proof photo");
  } catch (error) {
    console.error("A proof photo could not be served:", describeError(error));
    return apiError(500, "internal_error", "Something went wrong. Please try again.");
  }
}
