// GET /api/judge/messages/[id]/image — a photo sent in the simulator, streamed from private Blob
// storage. Simulated messages only: a real WhatsApp photo is never served here.

import { get } from "@vercel/blob";
import type { NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { apiError, notFound } from "@/server/http";
import { judgeMessageMedia } from "@/server/judge/chat";
import { isWellFormedMessageId } from "@/server/judge/live";
import { describeError } from "@/server/whatsapp/intake";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/judge/messages/[id]/image">) {
  const { id } = await ctx.params;
  if (!isWellFormedMessageId(id)) return notFound("Photo");
  try {
    const media = await judgeMessageMedia(getDb(), id);
    if (!media) return notFound("Photo");
    const blob = await get(media.path, { access: "private" });
    if (blob?.statusCode !== 200 || !blob.stream) return notFound("Photo");
    return new Response(blob.stream, {
      headers: { "content-type": media.contentType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
    });
  } catch (error) {
    console.error("A Judge Mode photo could not be served:", describeError(error));
    return apiError(500, "internal_error", "Something went wrong. Please try again.");
  }
}
