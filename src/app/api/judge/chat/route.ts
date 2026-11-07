// GET /api/judge/chat?projectId=…&after=<ISO time> — the simulator's conversation, oldest first.
// Only simulated messages: nothing from real WhatsApp test phones shows here.

import type { NextRequest } from "next/server";
import type { JudgeChatResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { DEMO } from "@/server/db/demo";
import { apiError, notFound } from "@/server/http";
import { loadJudgeChat } from "@/server/judge/chat";
import { judgeChatQuerySchema } from "@/server/schemas";
import { describeError } from "@/server/whatsapp/intake";

export async function GET(request: NextRequest) {
  const parsed = judgeChatQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return apiError(400, "invalid_query", `${issue?.path.join(".") || "query"}: ${issue?.message ?? "Invalid query."}`);
  }
  const { projectId, after } = parsed.data;
  if (projectId !== DEMO.projectId) return notFound("Project");
  try {
    const result: JudgeChatResult = {
      projectId,
      messages: await loadJudgeChat(getDb(), projectId, after ? new Date(after) : undefined),
    };
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("The Judge Mode chat could not be loaded:", describeError(error));
    return apiError(500, "internal_error", "Something went wrong. Please try again.");
  }
}
