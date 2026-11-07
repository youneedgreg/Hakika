// /api/proof/[token] — the phone capture page.
// GET: the code, instructions and expiry. POST: multipart upload of the photo and location.
// The demo token still answers with mock data, so the demo pages keep working.

import { del, put } from "@vercel/blob";
import type { NextRequest } from "next/server";
import type { ProofUploadResult } from "@/shared/api";
import { getDb } from "@/server/db/client";
import { apiError, mockJson, notFound } from "@/server/http";
import { DEMO_PROOF_TOKEN, proofCapture } from "@/server/mocks/demo";
import { submitCaptureProof, type CaptureDeps } from "@/server/proofs/capture";
import { isWellFormedToken } from "@/server/proofs/codes";
import { liveProofVision } from "@/server/proofs/live";
import { captureView, type LinkProblem } from "@/server/proofs/requests";
import { proofFieldsSchema } from "@/server/schemas";
import { describeError } from "@/server/whatsapp/intake";

// Vercel refuses request bodies over 4.5 MB before this code runs, so the limit sits under that.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function linkProblem(problem: LinkProblem): Response {
  if (problem === "used") return apiError(410, "proof_link_used", "This proof link has already been used.");
  if (problem === "expired") {
    return apiError(410, "proof_link_expired", "This proof link has expired. Reply PROOF on WhatsApp for a new code.");
  }
  return notFound("Proof link");
}

function captureDeps(): CaptureDeps {
  return {
    db: getDb(),
    vision: liveProofVision(),
    storeFile: async (path, file) => {
      const blob = await put(path, Buffer.from(file.bytes), { access: "private", contentType: file.contentType });
      return blob.pathname;
    },
    deleteFile: (path) => del(path),
  };
}

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/proof/[token]">) {
  const { token } = await ctx.params;
  if (token === DEMO_PROOF_TOKEN) return mockJson(proofCapture);
  if (!isWellFormedToken(token)) return notFound("Proof link");
  try {
    const view = await captureView({ db: getDb() }, token);
    if ("problem" in view) return linkProblem(view.problem);
    return Response.json(view.capture, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("A proof link could not be read:", describeError(error));
    return apiError(500, "internal_error", "Something went wrong. Please try again.");
  }
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/proof/[token]">) {
  const { token } = await ctx.params;
  if (token !== DEMO_PROOF_TOKEN && !isWellFormedToken(token)) return notFound("Proof link");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError(400, "invalid_form", "Send the proof as multipart form data.");
  }

  const image = form.get("image");
  if (!(image instanceof File) || image.size === 0) {
    return apiError(400, "missing_image", "Attach the photo as the image field.");
  }
  if (!IMAGE_TYPES.includes(image.type)) {
    return apiError(415, "unsupported_image", "The photo must be JPEG, PNG, WebP or HEIC.");
  }
  if (image.size > MAX_IMAGE_BYTES) {
    return apiError(413, "image_too_large", "The photo must be 4 MB or smaller.");
  }

  const fields = proofFieldsSchema.safeParse({
    latitude: form.get("latitude"),
    longitude: form.get("longitude"),
    accuracy: form.get("accuracy"),
    clientTime: form.get("clientTime"),
  });
  if (!fields.success) {
    const issue = fields.error.issues[0];
    return apiError(400, "invalid_fields", `${issue?.path.join(".")}: ${issue?.message}`);
  }

  if (token === DEMO_PROOF_TOKEN) {
    const result: ProofUploadResult = { proofId: "proof-mock-upload", status: "received" };
    return mockJson(result, 201);
  }

  try {
    const result = await submitCaptureProof(captureDeps(), token, {
      image: { bytes: new Uint8Array(await image.arrayBuffer()), contentType: image.type },
      lat: fields.data.latitude,
      lng: fields.data.longitude,
      accuracyM: fields.data.accuracy,
      clientTime: new Date(fields.data.clientTime),
    });
    if ("problem" in result) {
      if (result.problem === "unreadable_image") {
        return apiError(415, "unreadable_image", "We could not read this photo. Please take it again.");
      }
      return linkProblem(result.problem);
    }
    const body: ProofUploadResult = { proofId: result.proofId, status: "received" };
    return Response.json(body, { status: 201 });
  } catch (error) {
    console.error("A proof upload failed:", describeError(error));
    return apiError(500, "internal_error", "The photo was not saved. Please try again.");
  }
}
