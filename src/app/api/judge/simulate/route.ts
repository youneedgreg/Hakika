// POST /api/judge/simulate — inject a simulated WhatsApp message into the same pipeline Twilio
// uses. The answer is stored for the simulator to show; no real WhatsApp message is sent.

import { after, type NextRequest } from "next/server";
import type { SimulateResult } from "@/shared/api";
import { DEMO } from "@/server/db/demo";
import { newId } from "@/server/db/ids";
import { apiError, notFound, readJson } from "@/server/http";
import { simulateSchema } from "@/server/schemas";
import { describeError, findContactById, processInbound, type InboundMessage } from "@/server/whatsapp/intake";
import { simulatorDeps } from "@/server/whatsapp/live";

export async function POST(request: NextRequest) {
  const body = await readJson(request, simulateSchema);
  if ("response" in body) return body.response;
  const msg = body.data;
  if (msg.projectId !== DEMO.projectId) return notFound("Project");
  if (msg.kind === "text" && !msg.text) return apiError(400, "invalid_body", "text: Required for a text message.");
  if ((msg.kind === "image" || msg.kind === "voice") && !msg.mediaUrl) {
    return apiError(400, "invalid_body", "mediaUrl: Required for an image or voice message.");
  }
  if (msg.kind === "location" && !msg.location) {
    return apiError(400, "invalid_body", "location: Required for a location message.");
  }
  // The server fetches this URL, so it may only point at the app's own test files.
  if (msg.mediaUrl && new URL(msg.mediaUrl).origin !== request.nextUrl.origin) {
    return apiError(400, "invalid_body", "mediaUrl: Must be one of this app's own files.");
  }

  const messageId = newId("msg");
  const message: InboundMessage = {
    id: messageId,
    channel: "simulator",
    kind: msg.kind,
    text: msg.text,
    media: msg.mediaUrl ? { url: msg.mediaUrl } : undefined,
    location: msg.location,
  };
  const contactId = DEMO.contactIds[msg.from];
  after(async () => {
    try {
      const deps = simulatorDeps();
      const contact = await findContactById(deps.db, contactId);
      if (contact) await processInbound(deps, contact, message);
    } catch (error) {
      console.error("Simulated intake failed:", describeError(error));
    }
  });

  const result: SimulateResult = { messageId, accepted: true };
  return Response.json(result, { status: 202 });
}
