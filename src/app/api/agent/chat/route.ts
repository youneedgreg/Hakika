// POST /api/agent/chat — Ask Hakika. The owner's question is answered by Nova from this project's
// records through read-only tools (src/server/agent). Plain JSON, the ChatResult the Ask panel reads.
// It has no login yet, so a cap on questions comes before it goes live to judges.

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { answerQuestion } from "@/server/agent/answer";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { apiError, notFound, readJson } from "@/server/http";
import { chatSchema } from "@/server/schemas";
import { describeError } from "@/server/whatsapp/intake";
import type { ChatResult } from "@/shared/api";

export async function POST(request: NextRequest) {
  const body = await readJson(request, chatSchema);
  if ("response" in body) return body.response;
  const { projectId, question } = body.data;

  const db = getDb();
  const [project] = await db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId));
  if (!project) return notFound("Project");

  try {
    const { answer, citations, source, rejected, toolCalls } = await answerQuestion({ db }, projectId, question);
    console.info("Ask Hakika answered:", JSON.stringify({ projectId, source, rejected, toolCalls }));
    const result: ChatResult = { answer, citations };
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Ask Hakika failed:", describeError(error));
    return apiError(503, "agent_unavailable", "Ask Hakika can't answer right now. Try again in a minute.");
  }
}
