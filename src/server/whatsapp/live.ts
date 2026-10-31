// The pipeline's real connections, for the API routes. Tests pass fakes instead.

import { put } from "@vercel/blob";
import { getDb } from "@/server/db/client";
import type { IntakeDeps } from "./intake";
import { fetchOwnMedia, type MediaFile } from "./media";
import { fetchTwilioMedia, sendWhatsApp } from "./twilio";

async function storeMedia(path: string, file: MediaFile): Promise<string> {
  const blob = await put(path, Buffer.from(file.bytes), { access: "private", contentType: file.contentType });
  return blob.pathname;
}

export function twilioDeps(): IntakeDeps {
  return { db: getDb(), loadMedia: fetchTwilioMedia, storeMedia, send: sendWhatsApp };
}

export function simulatorDeps(): IntakeDeps {
  return {
    db: getDb(),
    loadMedia: fetchOwnMedia,
    storeMedia,
    send: () => Promise.reject(new Error("Judge Mode never sends real WhatsApp messages.")),
  };
}
