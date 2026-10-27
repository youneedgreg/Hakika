// POST /api/agent/chat — Ask Hakika. Mock: the same canned answer for any question about the demo
// project. The live route will stream; the response format is still to agree with Juliet.

import type { NextRequest } from "next/server";
import { mockJson, notFound, readJson } from "@/server/http";
import { DEMO_PROJECT_ID, chatAnswer } from "@/server/mocks/demo";
import { chatSchema } from "@/server/schemas";

export async function POST(request: NextRequest) {
  const body = await readJson(request, chatSchema);
  if ("response" in body) return body.response;
  if (body.data.projectId !== DEMO_PROJECT_ID) return notFound("Project");
  return mockJson(chatAnswer);
}
