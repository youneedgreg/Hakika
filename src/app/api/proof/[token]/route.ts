// /api/proof/[token] — the phone capture page.
// GET: the code, instructions and expiry. POST: multipart upload of the photo and location.
// Mock: one demo token; uploads are checked but not stored.

import type { NextRequest } from "next/server";
import type { ProofUploadResult } from "@/shared/api";
import { apiError, mockJson, notFound } from "@/server/http";
import { DEMO_PROOF_TOKEN, proofCapture } from "@/server/mocks/demo";
import { proofFieldsSchema } from "@/server/schemas";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/proof/[token]">) {
  const { token } = await ctx.params;
  if (token !== DEMO_PROOF_TOKEN) return notFound("Proof link");
  return mockJson(proofCapture);
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/proof/[token]">) {
  const { token } = await ctx.params;
  if (token !== DEMO_PROOF_TOKEN) return notFound("Proof link");

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
    return apiError(413, "image_too_large", "The photo must be 10 MB or smaller.");
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

  const result: ProofUploadResult = { proofId: "proof-mock-upload", status: "received" };
  return mockJson(result, 201);
}
