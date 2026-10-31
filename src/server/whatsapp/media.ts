// Which files Hakika accepts from WhatsApp, and the limit on their size.

export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
};

export type MediaFile = { bytes: Uint8Array; contentType: string; extension: string };

export class MediaRejected extends Error {}

export async function readMediaResponse(response: Response): Promise<MediaFile> {
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new MediaRejected(`Unsupported media type: ${contentType || "none"}.`);
  if (Number(response.headers.get("content-length")) > MAX_MEDIA_BYTES) throw new MediaRejected("The file is too large.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_MEDIA_BYTES) throw new MediaRejected("The file is too large.");
  return { bytes, contentType, extension };
}

// Judge Mode's test files, which the app serves itself. Never a URL from anywhere else.
export async function fetchOwnMedia(url: string): Promise<MediaFile> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new MediaRejected(`The media file could not be read: HTTP ${response.status}.`);
  return readMediaResponse(response);
}
