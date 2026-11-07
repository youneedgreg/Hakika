// Judge Mode never calls a model. Its three scenarios replay what Nova answered when the same test
// files were run once for real (scripts/record-judge.ts), and the screen says so. Everything after
// the model (the price check, the summary's number guard, the proof checks and outcome rule, holds
// and payments) runs for real on every run.
//
// A recording is used only when its input matches what the pipeline is about to send: the same
// quote file, the same summary facts, a proof photo with the same dHash. Anything else gets no
// model answer, which the pipeline already handles: the code-written summary, or vision checks
// left unknown. Nothing is ever made up to fill the gap.

import { createHash } from "node:crypto";
import type { ExplainFindings, SummaryFacts } from "@/server/ai/explain";
import type { ProofInspection, ProofVision } from "@/server/ai/proof-vision";
import type { ReadQuote } from "@/server/ai/quote";
import { dHash, hammingDistance } from "@/server/proofs/dhash";
import type { ReadingModels } from "@/server/requests/pipeline";
import type { ModelOutputNote } from "@/shared/api";
import type { JudgeMediaName } from "./media";

export type RecordedInspection = {
  media: JudgeMediaName;
  dhash: string; // of the original file; a photo shrunk for the model stays within a few bits
  earlierPhotos: number; // how many earlier site photos Nova compared it with
  output: ProofInspection;
};

export type JudgeRecordings = {
  modelId: string;
  recordedAt: string; // ISO time of the recording run
  quote: { media: JudgeMediaName; sha256: string; output: ReadQuote };
  // The owner summary depends on the demo's prices, so it can be recorded later, on its own.
  summary: { facts: SummaryFacts; text: string } | null;
  summaryRecordedAt?: string; // when the summary was recorded separately
  inspections: RecordedInspection[];
};

// The models a scenario run uses, and a note of each answer it gave, for the screen.
export type JudgeModels = {
  readQuote: ReadingModels["readQuote"];
  explainFindings: ExplainFindings;
  vision: Pick<ProofVision, "modelId" | "inspect">;
  notes: ModelOutputNote[];
};

// A shrunk proof photo is compared with the recorded original by dHash.
const PHOTO_MATCH_MAX_BITS = 8;

export class NoRecording extends Error {}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// JSON with keys sorted, so two equal fact objects always compare equal.
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
    : v));
}

export function recordedModelId(recordings: Pick<JudgeRecordings, "modelId" | "recordedAt">): string {
  return `${recordings.modelId}, recorded ${recordings.recordedAt.slice(0, 10)}`;
}

export function replayModels(recordings: JudgeRecordings): JudgeModels {
  const notes: ModelOutputNote[] = [];
  const recorded = { source: "recorded" as const, modelId: recordings.modelId, recordedAt: recordings.recordedAt };
  const missing = (task: ModelOutputNote["task"], detail: string): ModelOutputNote =>
    ({ task, source: "none", modelId: null, recordedAt: null, detail });

  return {
    notes,
    readQuote: async (file) => {
      if (sha256(file.bytes) !== recordings.quote.sha256) {
        notes.push(missing("quote_reading", "No recording for this quote photo, so it couldn't be read."));
        throw new NoRecording("No recorded reading for this quote photo.");
      }
      notes.push({ task: "quote_reading", ...recorded, detail: "Nova's reading of this quote photo, recorded once and replayed." });
      return recordings.quote.output;
    },
    explainFindings: async (facts) => {
      const { summary } = recordings;
      if (!summary) {
        notes.push(missing("owner_summary", "No owner summary has been recorded yet, so the owner sees the code-written summary."));
        throw new NoRecording("No summary recorded yet.");
      }
      if (stableJson(facts) !== stableJson(summary.facts)) {
        notes.push(missing("owner_summary", "The price check's facts differ from the recording, so the owner sees the code-written summary."));
        throw new NoRecording("No recorded summary for these facts.");
      }
      notes.push({
        task: "owner_summary", ...recorded, recordedAt: recordings.summaryRecordedAt ?? recordings.recordedAt,
        detail: "Nova's wording of the price check, recorded once and replayed. It still went through the number guard.",
      });
      return summary.text;
    },
    vision: {
      modelId: recordedModelId(recordings),
      inspect: async (photo) => {
        const hash = await dHash(photo.bytes);
        const match = recordings.inspections
          .map((r) => ({ r, bits: hammingDistance(hash, r.dhash) }))
          .filter((m) => m.bits <= PHOTO_MATCH_MAX_BITS)
          .sort((a, b) => a.bits - b.bits)[0];
        if (!match) {
          notes.push(missing("proof_inspection", "No recording for this photo, so its code and vision checks are unknown."));
          throw new NoRecording("No recorded inspection for this photo.");
        }
        notes.push({ task: "proof_inspection", ...recorded, detail: "Nova's look at this proof photo, recorded once and replayed. The checks and the outcome were worked out again in code." });
        return match.r.output;
      },
    },
  };
}
