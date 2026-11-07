// Records the model answers Judge Mode replays. scripts/record-judge.ts runs the scenarios on an
// in-memory database with these wrapped around the live Nova calls; tests wrap fakes. A cap on
// calls keeps a recording run from spending more than it was approved to.
//
// Parts can be recorded separately: the owner summary depends on the demo's prices, so it can be
// recorded on its own later while the quote reading and photo inspections are kept. A part that
// isn't being recorded is replayed from `existing`, or left without an answer (no call is made).

import type { ExplainFindings } from "@/server/ai/explain";
import type { ProofVision } from "@/server/ai/proof-vision";
import type { ReadQuote } from "@/server/ai/quote";
import { dHash, hammingDistance } from "@/server/proofs/dhash";
import type { ReadingModels } from "@/server/requests/pipeline";
import type { JudgeMediaName } from "./media";
import { type JudgeModels, type JudgeRecordings, NoRecording, type RecordedInspection, replayModels, sha256 } from "./replay";

export type LiveModels = {
  modelId: string;
  readQuote: ReadingModels["readQuote"];
  explainFindings: ExplainFindings;
  inspect: ProofVision["inspect"];
};

export type RecordParts = { quote: boolean; summary: boolean; inspections: boolean };
export const ALL_PARTS: RecordParts = { quote: true, summary: true, inspections: true };

export class CallCapReached extends Error {}

// `media` maps each file the scenarios send to its bytes, so a recorded answer names its file.
// The pipeline catches model errors (a summary falls back, a photo goes uninspected), so hitting the
// cap is remembered and reported by finish().
export function recordingModels(
  live: LiveModels,
  media: Map<JudgeMediaName, Uint8Array>,
  { maxCalls, parts = ALL_PARTS, existing = null }: { maxCalls: number; parts?: RecordParts; existing?: JudgeRecordings | null },
) {
  let calls = 0;
  let capped = false;
  const spend = () => {
    if (calls >= maxCalls) {
      capped = true;
      throw new CallCapReached(`Stopped: the recording would go past ${maxCalls} model calls.`);
    }
    calls += 1;
  };
  const kept = existing ? replayModels(existing) : null;
  const notRecorded = (what: string) => Promise.reject(new NoRecording(`${what} isn't being recorded in this run.`));

  let quote: JudgeRecordings["quote"] | null = null;
  let summary: JudgeRecordings["summary"] = null;
  const inspections: RecordedInspection[] = [];

  const byHash = new Map([...media].map(([name, bytes]) => [sha256(bytes), name]));
  const hashes = Promise.all([...media].map(async ([name, bytes]) => ({ name, hash: await dHash(bytes) })));

  const models: JudgeModels = {
    notes: [],
    readQuote: async (file, catalog) => {
      if (!parts.quote) return kept ? kept.readQuote(file, catalog) : notRecorded("The quote reading");
      const name = byHash.get(sha256(file.bytes));
      if (!name) throw new Error("Not one of Judge Mode's test files.");
      spend();
      const output: ReadQuote = await live.readQuote(file, catalog);
      quote = { media: name, sha256: sha256(file.bytes), output };
      return output;
    },
    explainFindings: async (facts) => {
      if (!parts.summary) return notRecorded("The owner summary");
      spend();
      const text = await live.explainFindings(facts);
      summary = { facts, text };
      return text;
    },
    vision: {
      modelId: live.modelId,
      inspect: async (photo, input) => {
        if (!parts.inspections) return kept ? kept.vision.inspect(photo, input) : notRecorded("A proof inspection");
        const hash = await dHash(photo.bytes);
        const closest = (await hashes)
          .map((m) => ({ ...m, bits: hammingDistance(hash, m.hash) }))
          .sort((a, b) => a.bits - b.bits)[0];
        if (!closest || closest.bits > 8) throw new Error("Not one of Judge Mode's test photos.");
        spend();
        const output = await live.inspect(photo, input);
        inspections.push({ media: closest.name, dhash: hash, earlierPhotos: input.earlier.length, output });
        return output;
      },
    },
  };

  return {
    models,
    calls: () => calls,
    finish: (recordedAt: Date): JudgeRecordings => {
      if (capped) throw new CallCapReached(`The recording needed more than ${maxCalls} model calls, so it was stopped and nothing was saved.`);
      const finalQuote = parts.quote ? quote : existing?.quote ?? null;
      const finalInspections = parts.inspections ? inspections : existing?.inspections ?? [];
      const finalSummary = parts.summary ? summary : existing?.summary ?? null;
      if (!finalQuote || finalInspections.length === 0 || (parts.summary && !finalSummary)) {
        throw new Error("The recording run didn't reach every model call it was meant to record.");
      }
      return {
        modelId: live.modelId,
        recordedAt: parts.quote || parts.inspections ? recordedAt.toISOString() : existing!.recordedAt,
        quote: finalQuote,
        summary: finalSummary,
        ...(parts.summary && !parts.quote ? { summaryRecordedAt: recordedAt.toISOString() } : existing?.summaryRecordedAt ? { summaryRecordedAt: existing.summaryRecordedAt } : {}),
        inspections: finalInspections,
      };
    },
  };
}
