// Voice notes to English text with Groq Whisper. The result is data to be parsed later; it never
// moves money and is never followed as an instruction. Only demo audio goes to Groq, whose free
// tier may train on what it receives. Errors here never quote what was said.

import { z } from "zod";
import type { MediaFile } from "@/server/whatsapp/media";

const TRANSLATIONS_URL = "https://api.groq.com/openai/v1/audio/translations";
const MODEL = "whisper-large-v3";
const SUPPORTED_EXTENSIONS = new Set(["ogg", "mp3", "m4a"]); // of the types media.ts accepts from WhatsApp
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 5_000; // this runs after the webhook has answered, but not for long
// Whisper's own defaults for "this wasn't speech" and "this wasn't understood".
const MAX_NO_SPEECH_PROB = 0.6;
const MIN_AVG_LOGPROB = -1;
// English context and spellings for Whisper (at most 224 tokens). It fixed "pieces" and "the mill" on
// a real note, but it can also pull other words towards these, so a supplier is never taken from
// voice note text: it comes from the quote photo.
const VOCABULARY_HINT =
  "A foreman on a building site in Kenya orders materials. Mifuko means bags. Cement is sold in bags. " +
  "Suppliers: Mlima Hardware, Kiawara Builders Supplies.";

export class TranslationFailed extends Error {}

export type Translation =
  | { outcome: "translated"; text: string; model: string; quality: Quality }
  | { outcome: "unreadable"; reason: "unsupported_format" | "empty" | "no_speech" | "garbled"; quality?: Quality };

type Quality = { durationSeconds: number; avgLogprob: number; noSpeechProb: number };

const verboseResponse = z.object({
  text: z.string(),
  duration: z.number().optional(),
  segments: z.array(z.object({
    start: z.number(),
    end: z.number(),
    avg_logprob: z.number(),
    no_speech_prob: z.number(),
  })).default([]),
});

// Each segment counts for as long as it lasts, so a short noise can't sink a long clear message.
function measureQuality({ duration, segments }: z.infer<typeof verboseResponse>): Quality {
  const lengths = segments.map((segment) => Math.max(segment.end - segment.start, 0.01));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const weighted = (value: (i: number) => number) =>
    total === 0 ? 0 : lengths.reduce((sum, length, i) => sum + length * value(i), 0) / total;
  return {
    durationSeconds: duration ?? total,
    avgLogprob: weighted((i) => segments[i].avg_logprob),
    noSpeechProb: weighted((i) => segments[i].no_speech_prob),
  };
}

// Null when it's worth trying again, and how long to wait first.
function retryWait(response: Response, attempt: number): number | null {
  if (attempt >= MAX_RETRIES || (response.status !== 429 && response.status < 500)) return null;
  const header = Number(response.headers.get("retry-after"));
  const wait = Number.isFinite(header) && header > 0 ? header * 1000 : 500 * 2 ** attempt;
  return wait <= MAX_RETRY_WAIT_MS ? wait : null;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function translateVoiceNote(
  file: MediaFile,
  { fetchFn = fetch, sleep = pause }: { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<Translation> {
  if (!SUPPORTED_EXTENSIONS.has(file.extension)) return { outcome: "unreadable", reason: "unsupported_format" };

  const key = process.env.GROQ_API_KEY;
  if (!key) throw new TranslationFailed("GROQ_API_KEY must be set.");

  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.set("file", new Blob([Buffer.from(file.bytes)], { type: file.contentType }), `voice.${file.extension}`);
    form.set("model", MODEL);
    form.set("response_format", "verbose_json");
    form.set("temperature", "0");
    form.set("prompt", VOCABULARY_HINT);

    const response = await fetchFn(TRANSLATIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const wait = retryWait(response, attempt);
      if (wait === null) throw new TranslationFailed(`Groq refused the voice note: HTTP ${response.status}.`);
      await sleep(wait);
      continue;
    }

    const parsed = verboseResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new TranslationFailed("Groq's answer was not in the expected shape.");

    const text = parsed.data.text.trim();
    const quality = measureQuality(parsed.data);
    if (!text) return { outcome: "unreadable", reason: "empty", quality };
    if (quality.noSpeechProb > MAX_NO_SPEECH_PROB) return { outcome: "unreadable", reason: "no_speech", quality };
    if (quality.avgLogprob < MIN_AVG_LOGPROB) return { outcome: "unreadable", reason: "garbled", quality };
    return { outcome: "translated", text, model: MODEL, quality };
  }
}
