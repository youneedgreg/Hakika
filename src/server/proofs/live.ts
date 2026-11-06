// Proof inspection's real connections, for the API routes: Nova on Bedrock, and the private Blob
// store the photos are kept in. Tests pass fakes instead.

import { get } from "@vercel/blob";
import { inspectProof, type ProofVision, shrinkForModel } from "@/server/ai/proof-vision";

// Undefined when Bedrock isn't configured, so proofs are still checked, with the code and vision
// checks left unknown.
export function liveProofVision(): ProofVision | undefined {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) return undefined;
  return {
    modelId,
    inspect: (photo, input) => inspectProof(photo, input),
    readPhoto: async (blobPath) => {
      const blob = await get(blobPath, { access: "private" });
      if (blob?.statusCode !== 200 || !blob.stream) return null;
      return shrinkForModel(new Uint8Array(await new Response(blob.stream).arrayBuffer()));
    },
  };
}
