// The demo project's story for Ask Hakika's tests: Judge Mode's three scenarios (inflated quote,
// verified delivery, recycled photo), replayed from the committed Nova recording. No model is called.

import { shrinkForModel } from "@/server/ai/proof-vision";
import type { AnyDb } from "@/server/db/client";
import { resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { readJudgeMedia } from "@/server/judge/media";
import { type JudgeRecordings, replayModels } from "@/server/judge/replay";
import committed from "@/server/judge/recordings.json";
import { type JudgeDeps, runScenario } from "@/server/judge/scenarios";

export function demoStory(db: AnyDb) {
  let stored = new Map<string, Uint8Array>();
  const judge = (): JudgeDeps => ({
    db,
    models: replayModels(committed as JudgeRecordings),
    readMedia: (name) => readJudgeMedia(name),
    storeMedia: async (path, file) => {
      stored.set(path, file.bytes);
      return path;
    },
    readPhoto: async (path) => {
      const bytes = stored.get(path);
      return bytes ? shrinkForModel(bytes) : null;
    },
    rate: async () => ({ kesPerUsd: "129.980973" }),
    linkBase: "https://tryhakika.vercel.app",
  });

  return {
    // The seeded project, with nothing requested, paid or proved yet.
    async fresh() {
      stored = new Map();
      await db.delete(s.messages);
      await db.delete(s.auditEvents);
      await db.delete(s.payments);
      await db.delete(s.requests);
      await resetDemo(db, { otieno: "otieno@personal.example.com", mlima: "mlima@business.example.com" });
    },
    async play() {
      await runScenario(judge(), "inflated-quote");
      await runScenario(judge(), "valid-delivery");
      await runScenario(judge(), "recycled-photo");
    },
  };
}
