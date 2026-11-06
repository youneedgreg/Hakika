// A proof photo from the phone capture page: check the link, hash the photo, store it, record it.

import { newId } from "@/server/db/ids";
import { dHash, UnreadableImage } from "./dhash";
import { findByToken, recordProof, type LinkProblem, type ProofDeps } from "./requests";

export type StoredFile = { bytes: Uint8Array; contentType: string };

export type CaptureDeps = ProofDeps & {
  storeFile: (path: string, file: StoredFile) => Promise<string>; // returns the stored path
  deleteFile: (path: string) => Promise<void>;
};

export type CaptureUpload = {
  image: StoredFile;
  lat: number;
  lng: number;
  accuracyM: number;
  clientTime: Date;
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
};

export async function submitCaptureProof(
  deps: CaptureDeps,
  token: string,
  upload: CaptureUpload,
): Promise<{ proofId: string } | { problem: LinkProblem | "unreadable_image" }> {
  const found = await findByToken(deps, token);
  if ("problem" in found) return found;

  let hash: string;
  try {
    hash = await dHash(upload.image.bytes);
  } catch (error) {
    if (error instanceof UnreadableImage) return { problem: "unreadable_image" };
    throw error;
  }

  const proofId = newId("prf");
  const blobPath = await deps.storeFile(`proofs/${proofId}.${EXTENSIONS[upload.image.contentType] ?? "img"}`, upload.image);
  const result = await recordProof(deps, found.request.id, {
    proofId,
    source: "capture_page",
    blobPath,
    contentType: upload.image.contentType,
    sizeBytes: upload.image.bytes.byteLength,
    dhash: hash,
    capture: { lat: upload.lat, lng: upload.lng, accuracyM: upload.accuracyM },
    clientTime: upload.clientTime,
  });
  if ("problem" in result) {
    // Someone else used the link, or it expired, while this photo was uploading.
    await deps.deleteFile(blobPath).catch(() => undefined);
  }
  return result;
}
