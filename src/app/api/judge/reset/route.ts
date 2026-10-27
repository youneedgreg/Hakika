// POST /api/judge/reset — reseed the demo project. Mock: nothing to reset yet.

import type { NextRequest } from "next/server";
import type { ResetResult } from "@/shared/api";
import { mockJson, notFound, readJson } from "@/server/http";
import { DEMO_PROJECT_ID } from "@/server/mocks/demo";
import { resetSchema } from "@/server/schemas";

export async function POST(request: NextRequest) {
  const body = await readJson(request, resetSchema);
  if ("response" in body) return body.response;
  if (body.data.projectId !== DEMO_PROJECT_ID) return notFound("Project");
  const result: ResetResult = { projectId: body.data.projectId, reset: true };
  return mockJson(result);
}
