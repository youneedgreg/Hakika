// POST /api/judge/simulate — inject a simulated WhatsApp message into the same pipeline Twilio
// uses. Mock: the message is checked and acknowledged, but nothing is processed yet.

import type { NextRequest } from "next/server";
import type { SimulateResult } from "@/shared/api";
import { apiError, mockJson, notFound, readJson } from "@/server/http";
import { DEMO_PROJECT_ID } from "@/server/mocks/demo";
import { simulateSchema } from "@/server/schemas";

export async function POST(request: NextRequest) {
  const body = await readJson(request, simulateSchema);
  if ("response" in body) return body.response;
  const msg = body.data;
  if (msg.projectId !== DEMO_PROJECT_ID) return notFound("Project");
  if (msg.kind === "text" && !msg.text) return apiError(400, "invalid_body", "text: Required for a text message.");
  if ((msg.kind === "image" || msg.kind === "voice") && !msg.mediaUrl) {
    return apiError(400, "invalid_body", "mediaUrl: Required for an image or voice message.");
  }
  if (msg.kind === "location" && !msg.location) {
    return apiError(400, "invalid_body", "location: Required for a location message.");
  }
  const result: SimulateResult = { messageId: "msg-mock-1", accepted: true };
  return mockJson(result, 202);
}
