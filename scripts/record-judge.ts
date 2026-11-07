// Records the Nova answers Judge Mode replays, by running its scenarios once on an in-memory
// database with the live models. Every call costs money (Bedrock), so it's capped and asks for
// nothing it doesn't need. Only Judge Mode's synthetic test files are sent.
//
//   npx tsx scripts/record-judge.ts --parts quote,inspections   # 3 calls: the quote and both photos
//   npx tsx scripts/record-judge.ts --parts summary             # 1 call: the owner summary, kept with the rest
//
// It writes src/server/judge/recordings.json, merging with what's there. Env files load as
// `next dev` loads them (BEDROCK_* from .env.local).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { loadEnvConfig } from "@next/env";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { explainFindings } from "../src/server/ai/explain";
import { inspectProof, shrinkForModel } from "../src/server/ai/proof-vision";
import { readQuote } from "../src/server/ai/quote";
import { resetDemo } from "../src/server/db/demo";
import * as s from "../src/server/db/schema";
import { readJudgeMedia, SENT_MEDIA } from "../src/server/judge/media";
import { recordingModels, type RecordParts } from "../src/server/judge/record";
import type { JudgeRecordings } from "../src/server/judge/replay";
import { runScenario, type JudgeDeps } from "../src/server/judge/scenarios";
import type { ScenarioId } from "../src/shared/api";

const OUT = "src/server/judge/recordings.json";

function parseParts(argv: string[]): RecordParts {
  const flag = argv.indexOf("--parts");
  const names = flag >= 0 ? (argv[flag + 1] ?? "").split(",") : [];
  const parts = { quote: names.includes("quote"), summary: names.includes("summary"), inspections: names.includes("inspections") };
  if (!parts.quote && !parts.summary && !parts.inspections) throw new Error("Say what to record: --parts quote,summary,inspections (any of them).");
  return parts;
}

async function main() {
  loadEnvConfig(process.cwd(), true);
  const parts = parseParts(process.argv);
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) throw new Error("BEDROCK_MODEL_ID isn't set.");
  const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) as JudgeRecordings : null;
  if ((!parts.quote || !parts.inspections) && !existing) throw new Error(`Record the quote and inspections first: ${OUT} doesn't exist.`);

  // The quote is read in "Inflated quote", and its summary written there; the photos are inspected
  // in the other two. Nothing else calls a model.
  const maxCalls = (parts.quote ? 1 : 0) + (parts.summary ? 1 : 0) + (parts.inspections ? 2 : 0);
  const scenarios: ScenarioId[] = parts.inspections ? ["inflated-quote", "valid-delivery", "recycled-photo"] : ["inflated-quote"];

  const media = new Map(await Promise.all(SENT_MEDIA.map(async (name) => [name, (await readJudgeMedia(name)).bytes] as const)));
  const recorder = recordingModels({
    modelId,
    readQuote: (file, catalog) => readQuote(file, catalog),
    explainFindings: (facts) => explainFindings(facts),
    inspect: (photo, input) => inspectProof(photo, input),
  }, media, { maxCalls, parts, existing });

  const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  const stored = new Map<string, Uint8Array>();
  const deps: JudgeDeps = {
    db,
    models: recorder.models,
    readMedia: (name) => readJudgeMedia(name),
    storeMedia: async (path, file) => { stored.set(path, file.bytes); return path; },
    readPhoto: async (path) => { const bytes = stored.get(path); return bytes ? shrinkForModel(bytes) : null; },
    rate: async () => ({ kesPerUsd: "129.000000" }), // only for the in-memory seeded delivery
    linkBase: "https://tryhakika.vercel.app",
  };

  console.log(`Recording ${Object.entries(parts).filter(([, on]) => on).map(([p]) => p).join(", ")}: at most ${maxCalls} Nova call${maxCalls === 1 ? "" : "s"} on ${modelId}.`);
  for (const id of scenarios) {
    await resetDemo(db, { mlima: "mlima@business.example.com", kiawara: "kiawara@business.example.com", otieno: "otieno@personal.example.com" });
    const result = await runScenario(deps, id);
    console.log(`\n${result.title}: ${result.outcome}`);
    if (result.proofId) {
      const [verdict] = await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, result.proofId));
      for (const check of verdict?.checks ?? []) console.log(`  ${check.name}: ${check.result} (${check.detail})`);
    }
  }

  const recordings = recorder.finish(new Date());
  writeFileSync(OUT, `${JSON.stringify(recordings, null, 2)}\n`);
  console.log(`\n${recorder.calls()} Nova call${recorder.calls() === 1 ? "" : "s"} made. Wrote ${OUT}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
