// The pipeline's real connections, for the API routes. Tests pass fakes instead.

import { put } from "@vercel/blob";
import { explainFindings } from "@/server/ai/explain";
import { parseMessage } from "@/server/ai/parse-message";
import { readQuote } from "@/server/ai/quote";
import { translateVoiceNote } from "@/server/ai/translate";
import { getDb } from "@/server/db/client";
import { liveFreshProof, liveProofVision } from "@/server/proofs/live";
import { runRequestPipeline } from "@/server/requests/pipeline";
import type { IntakeDeps } from "./intake";
import { fetchOwnMedia, type MediaFile } from "./media";
import { fetchTwilioMedia, sendWhatsApp } from "./twilio";

export async function storeMedia(path: string, file: MediaFile): Promise<string> {
  const blob = await put(path, Buffer.from(file.bytes), { access: "private", contentType: file.contentType });
  return blob.pathname;
}

export function twilioDeps(): IntakeDeps {
  const deps: IntakeDeps = {
    db: getDb(),
    loadMedia: fetchTwilioMedia,
    storeMedia,
    send: sendWhatsApp,
    vision: liveProofVision(),
    fresh: liveFreshProof("whatsapp"),
    afterReply: (stored) => runRequestPipeline(deps, { translate: translateVoiceNote, readQuote, parseMessage, explainFindings }, stored),
  };
  return deps;
}

// No reading models here: this route has no login or rate limit yet, so anyone could spend the
// Groq and Bedrock allowances through it. Add them with the Judge Mode login.
export function simulatorDeps(): IntakeDeps {
  return {
    db: getDb(),
    loadMedia: fetchOwnMedia,
    storeMedia,
    send: () => Promise.reject(new Error("Judge Mode never sends real WhatsApp messages.")),
    fresh: liveFreshProof("simulator"),
  };
}
