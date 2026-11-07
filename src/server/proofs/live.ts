// Proof checking's real connections, for the API routes: Nova on Bedrock, the private Blob store the
// photos are kept in, and WhatsApp for fresh-proof codes. Tests pass fakes instead.

import { get } from "@vercel/blob";
import { inspectProof, type ProofPhoto, type ProofVision, shrinkForModel } from "@/server/ai/proof-vision";
import { parseTestPhones } from "@/server/whatsapp/intake";
import { sendWhatsApp } from "@/server/whatsapp/twilio";
import type { FreshProofDeps } from "./fresh";
import { proofLinkBase } from "./whatsapp";

// Undefined when Bedrock isn't configured, so proofs are still checked, with the code and vision
// checks left unknown.
export function liveProofVision(): ProofVision | undefined {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) return undefined;
  return { modelId, inspect: (photo, input) => inspectProof(photo, input), readPhoto: readStoredPhoto };
}

// A stored proof photo from Blob, shrunk for the model. Null when it isn't stored.
export async function readStoredPhoto(blobPath: string): Promise<ProofPhoto | null> {
  const blob = await get(blobPath, { access: "private" });
  if (blob?.statusCode !== 200 || !blob.stream) return null;
  return shrinkForModel(new Uint8Array(await new Response(blob.stream).arrayBuffer()));
}

// How fresh-proof codes go out from a route. Twilio and the capture page send to mapped test phones;
// Judge Mode stores them on the simulator channel and never sends.
export function liveFreshProof(channel: "whatsapp" | "simulator"): FreshProofDeps {
  return {
    notifier: {
      channel,
      send: channel === "whatsapp" ? sendWhatsApp : () => Promise.reject(new Error("Judge Mode never sends real WhatsApp messages.")),
      testPhones: parseTestPhones(process.env.WHATSAPP_TEST_PHONES),
    },
    linkBase: proofLinkBase(),
  };
}
