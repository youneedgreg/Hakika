// Judge Mode's test files. They live under public/ (so the chat can show them) and are read from
// disk here, never fetched by URL: a preview deployment's protection would block a fetch to itself.
// next.config.ts traces public/judge and public/mock/proof into the judge routes.

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MediaFile } from "@/server/whatsapp/media";

// The code written on the card in the delivery photo. Judge Mode issues it for the "Valid
// delivery" scenario, because a ready-made photo can't show a code drawn at random. Everywhere
// else codes are random.
export const JUDGE_DELIVERY_CODE = "K7P3";

export const JUDGE_MEDIA = {
  quote: "judge/quote-baraka.jpg", // drawn by scripts/make-judge-media.ts
  delivery: "judge/delivery-cement-coded.jpg", // Juliet's AI-generated photo plus a drawn code card
  earlierFoundation: "mock/proof/foundation-2.jpg", // Juliet's AI-generated foundation photo
  recycledFoundation: "mock/proof/proof-foundation-recycled.png", // the same picture, pixel for pixel
} as const;

export type JudgeMediaName = (typeof JUDGE_MEDIA)[keyof typeof JUDGE_MEDIA];

// The files the scenarios send (the earlier foundation photo is only put in place beforehand).
export const SENT_MEDIA: JudgeMediaName[] = [JUDGE_MEDIA.quote, JUDGE_MEDIA.delivery, JUDGE_MEDIA.recycledFoundation];

const TYPES: Record<string, { contentType: string; extension: string }> = {
  ".jpg": { contentType: "image/jpeg", extension: "jpg" },
  ".png": { contentType: "image/png", extension: "png" },
};

export async function readJudgeMedia(name: JudgeMediaName, root = process.cwd()): Promise<MediaFile> {
  const type = TYPES[path.extname(name)];
  const bytes = await readFile(path.join(root, "public", name));
  return { bytes: new Uint8Array(bytes), ...type };
}

// Where the browser can load the file, for the simulator's chat.
export function judgeMediaUrl(name: JudgeMediaName): string {
  return `/${name}`;
}
