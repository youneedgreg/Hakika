// Day 16: Judge Mode's scenario runner, on an in-memory Postgres with fake storage. The test files
// are the real ones in public/, so dHash, shrinking and the duplicate check run for real. Model
// answers are recorded from fake models (through the same recorder the real recording uses) and then
// replayed: nothing here calls Nova, Groq, Twilio or PayPal.

import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryFacts } from "@/server/ai/explain";
import { type ProofInspection, shrinkForModel } from "@/server/ai/proof-vision";
import type { ReadQuote } from "@/server/ai/quote";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { loadJudgeChat, judgeMessageMedia, RESET_COOLDOWN_S, resetJudgeDemo } from "@/server/judge/chat";
import { JUDGE_DELIVERY_CODE, JUDGE_MEDIA, type JudgeMediaName, readJudgeMedia, SENT_MEDIA } from "@/server/judge/media";
import { ALL_PARTS, CallCapReached, type LiveModels, recordingModels } from "@/server/judge/record";
import { type JudgeRecordings, recordedModelId, replayModels } from "@/server/judge/replay";
import {
  isScenarioId, type JudgeDeps, runScenario, ScenarioNeedsReset, SEED_CAPTURE_PREFIX,
} from "@/server/judge/scenarios";
import { createOrderForMilestone } from "@/server/payments/orders";
import type { PayPalClient } from "@/server/payments/paypal";
import committed from "@/server/judge/recordings.json";
import type { ScenarioId } from "@/shared/api";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const LINK_BASE = "https://tryhakika.vercel.app";

// Fake private storage: whatever is stored can be read back, shrunk as the live reader does.
let stored: Map<string, Uint8Array>;
const storeMedia = vi.fn<JudgeDeps["storeMedia"]>(async (path, file) => {
  stored.set(path, file.bytes);
  return path;
});
const readPhoto: JudgeDeps["readPhoto"] = async (path) => {
  const bytes = stored.get(path);
  return bytes ? shrinkForModel(bytes) : null;
};

const deps = (models: JudgeDeps["models"]): JudgeDeps => ({
  db, models, readMedia: (name) => readJudgeMedia(name), storeMedia, readPhoto,
  rate: async () => ({ kesPerUsd: "129.980973" }), linkBase: LINK_BASE,
});

// What a model that reads well would answer for each test file.
const QUOTE: ReadQuote = {
  outcome: "read",
  supplierName: "Baraka Hardware",
  lines: [{ itemKey: "cement_50kg", description: "Cement 50kg bag", qty: 50, unit: "bag", unitPriceKesCents: 130_000 }],
  statedTotalKesCents: 6_500_000,
  raw: { fake: true },
  usage: { inputTokens: 1_500, outputTokens: 200 },
};
const inspected = (reading: Partial<Extract<ProofInspection, { outcome: "inspected" }>["reading"]>): ProofInspection => ({
  outcome: "inspected",
  reading: { code: null, medium: "scene", mediumReason: "A building site.", itemsSeen: [], sameSite: null, sameSiteReason: null, ...reading },
  raw: { fake: true },
  usage: { inputTokens: 1_700, outputTokens: 150 },
});
const DELIVERY = inspected({
  code: JUDGE_DELIVERY_CODE,
  itemsSeen: [{ itemKey: "cement_50kg", description: "Cement bags on a pallet", qty: 40 }],
});
const RECYCLED = inspected({ code: null, sameSite: "same", sameSiteReason: "The same foundation and steel." });
const SUMMARY = "Peter Mwangi, the foreman on site, sent a quote for KES 65,000 from a supplier Hakika has not verified.";

function fakeLive(): LiveModels & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    modelId: "eu.amazon.nova-2-lite-v1:0",
    readQuote: async () => { calls.push("quote"); return QUOTE; },
    explainFindings: async () => { calls.push("summary"); return SUMMARY; },
    inspect: async (_photo, input) => {
      calls.push(`inspect:${input.earlier.length}`);
      return input.earlier.length ? RECYCLED : DELIVERY;
    },
  };
}

async function testMedia(): Promise<Map<JudgeMediaName, Uint8Array>> {
  const entries = await Promise.all(SENT_MEDIA.map(async (name) => [name, (await readJudgeMedia(name)).bytes] as const));
  return new Map(entries);
}

async function freshDemo() {
  await db.delete(s.messages);
  await db.delete(s.auditEvents);
  await db.delete(s.payments);
  await db.delete(s.requests);
  await resetDemo(db, { otieno: "otieno@personal.example.com", mlima: "mlima@business.example.com" });
}

// Records scenarios on a fresh demo each, as scripts/record-judge.ts does.
async function record(
  live = fakeLive(),
  { maxCalls = 4, parts = ALL_PARTS, existing = null as JudgeRecordings | null, at = "2026-11-07T15:00:00Z" } = {},
): Promise<{ recordings: JudgeRecordings; live: ReturnType<typeof fakeLive> }> {
  const recorder = recordingModels(live, await testMedia(), { maxCalls, parts, existing });
  const ids: ScenarioId[] = parts.inspections ? ["inflated-quote", "valid-delivery", "recycled-photo"] : ["inflated-quote"];
  for (const id of ids) {
    await freshDemo();
    await runScenario(deps(recorder.models), id);
  }
  return { recordings: recorder.finish(new Date(at)), live };
}

let recordings: JudgeRecordings;
const replay = () => deps(replayModels(recordings));
const run = (id: ScenarioId) => runScenario(replay(), id);

const outbound = () => db.select().from(s.messages).where(eq(s.messages.direction, "outbound")).orderBy(asc(s.messages.createdAt));
const verdictOf = async (proofId: string) => (await db.select().from(s.verdicts).where(eq(s.verdicts.proofId, proofId)))[0];
const milestone = async (id = "m2") => (await db.select().from(s.milestones).where(eq(s.milestones.id, id)))[0];
const noPayPal = {} as PayPalClient; // a held milestone is refused before PayPal is called

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  stored = new Map();
  ({ recordings } = await record());
}, 120_000);

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  stored = new Map();
  await freshDemo();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recording", () => {
  it("makes exactly four model calls: the quote, its summary, and two proof photos", async () => {
    const { live, recordings: r } = await record();
    expect(live.calls).toEqual(["quote", "summary", "inspect:0", "inspect:1"]);
    expect(r.quote.media).toBe(JUDGE_MEDIA.quote);
    expect(r.inspections.map((i) => [i.media, i.earlierPhotos])).toEqual([
      [JUDGE_MEDIA.delivery, 0],
      [JUDGE_MEDIA.recycledFoundation, 1],
    ]);
    expect(r.summary?.text).toBe(SUMMARY);
  });

  it("stops before going past its call cap, and saves nothing", async () => {
    const live = fakeLive();
    await expect(record(live, { maxCalls: 1 })).rejects.toThrow(CallCapReached);
    expect(live.calls).toEqual(["quote"]);
  });

  it("can leave the summary out, then record only the summary later with one call", async () => {
    const first = await record(fakeLive(), { maxCalls: 3, parts: { quote: true, summary: false, inspections: true } });
    expect(first.live.calls).toEqual(["quote", "inspect:0", "inspect:1"]);
    expect(first.recordings.summary).toBeNull();

    const result = await runScenario(deps(replayModels(first.recordings)), "inflated-quote");
    expect(result.models[1]).toMatchObject({ task: "owner_summary", source: "none", detail: expect.stringMatching(/No owner summary has been recorded yet/) });

    const later = await record(fakeLive(), {
      maxCalls: 1, parts: { quote: false, summary: true, inspections: false }, existing: first.recordings, at: "2026-11-09T10:00:00Z",
    });
    expect(later.live.calls).toEqual(["summary"]);
    expect(later.recordings).toMatchObject({
      quote: first.recordings.quote, inspections: first.recordings.inspections,
      recordedAt: first.recordings.recordedAt, summaryRecordedAt: "2026-11-09T10:00:00.000Z", summary: { text: SUMMARY },
    });
    await freshDemo();
    const replayed = await runScenario(deps(replayModels(later.recordings)), "inflated-quote");
    expect(replayed.models[1]).toMatchObject({ source: "recorded", recordedAt: "2026-11-09T10:00:00.000Z" });
  });
});

describe("Inflated quote", () => {
  it("reads Peter's quote, price-checks it and sends it for approval, with every model answer replayed", async () => {
    const result = await run("inflated-quote");

    const [request] = await db.select().from(s.requests).where(eq(s.requests.id, result.requestId!));
    expect(request.status).toBe("awaiting_approval");
    expect(request.quotedTotalKesCents).toBe(6_500_000);
    expect(request.summary).toBe(SUMMARY);
    const findings = await db.select().from(s.findings).where(eq(s.findings.requestId, request.id));
    expect(findings.map((f) => f.type)).toEqual(expect.arrayContaining(["price_above_market", "unverified_supplier", "cheaper_verified_supplier"]));

    expect(result.models.map((m) => [m.task, m.source])).toEqual([["quote_reading", "recorded"], ["owner_summary", "recorded"]]);
    expect(result.models[0]).toMatchObject({ modelId: "eu.amazon.nova-2-lite-v1:0", recordedAt: "2026-11-07T15:00:00.000Z" });
    expect(result.links).toEqual([{ label: "Open the approval card", href: `/requests/${request.id}` }]);
    expect(result.outcome).toMatch(/KES 65,000.*waiting for the owner's approval/);
    expect(result.setup).toEqual([]);
  });

  it("answers on the simulator channel only", async () => {
    await run("inflated-quote");
    const replies = await outbound();
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.every((m) => m.channel === "simulator" && m.twilioSid === null)).toBe(true);
  });

  it("falls back to the code-written summary when the price check's facts no longer match the recording", async () => {
    const summary = recordings.summary!;
    const changed: JudgeRecordings = { ...recordings, summary: { text: summary.text, facts: { ...summary.facts, quotedTotal: "KES 1" } as SummaryFacts } };
    const result = await runScenario(deps(replayModels(changed)), "inflated-quote");
    const [request] = await db.select().from(s.requests).where(eq(s.requests.id, result.requestId!));
    expect(request.summary).not.toBe(SUMMARY);
    expect(request.status).toBe("awaiting_approval");
    expect(result.models[1]).toMatchObject({ task: "owner_summary", source: "none", modelId: null });
  });
});

describe("Valid delivery", () => {
  it("sets up a clearly marked paid delivery, issues the code on the photo, and verifies it", async () => {
    const result = await run("valid-delivery");

    expect(result.setup).toEqual([expect.stringMatching(/marked paid without a PayPal payment/)]);
    const [payment] = await db.select().from(s.payments).where(like(s.payments.paypalCaptureId, `${SEED_CAPTURE_PREFIX}%`));
    expect(payment).toMatchObject({ status: "captured", kind: "materials", amountKesCents: 50 * 79_000 });
    const [seeded] = await db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "judge.delivery_seeded"));
    expect(seeded.description).toMatch(/No PayPal payment was made for it/);

    const [code] = await db.select().from(s.proofRequests).where(eq(s.proofRequests.paymentId, payment.id));
    expect(code.code).toBe(JUDGE_DELIVERY_CODE);
    expect(result.verdict).toBe("verified");
    const verdict = await verdictOf(result.proofId!);
    expect(verdict.modelId).toBe(recordedModelId(recordings));
    expect(verdict.checks.find((c) => c.name === "location")?.result).toBe("pass");
    const [request] = await db.select().from(s.requests).where(eq(s.requests.id, payment.requestId!));
    expect(request.status).toBe("verified");
    expect(result.models).toEqual([expect.objectContaining({ task: "proof_inspection", source: "recorded" })]);
  });

  it("runs once per reset: its photo is on record afterwards, and would be caught as reused", async () => {
    await run("valid-delivery");
    await expect(run("valid-delivery")).rejects.toThrow(ScenarioNeedsReset);
    expect(await db.select().from(s.proofs).where(eq(s.proofs.projectId, DEMO.projectId))).toHaveLength(1);
  });

  it("proves a delivery paid in PayPal sandbox instead, when there is one", async () => {
    const [request] = await db.insert(s.requests).values({
      projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, status: "paid",
    }).returning();
    await db.insert(s.requestLines).values({
      requestId: request.id, position: 0, itemKey: "cement_50kg", description: "Cement, 50 kg bag", qty: 50, unit: "bag", unitPriceKesCents: 110_000,
    });
    await db.insert(s.payments).values({
      projectId: DEMO.projectId, kind: "materials", requestId: request.id, payeeSupplierId: DEMO.supplierIds.kiawara,
      payeeEmail: "kiawara@business.example.com", amountKesCents: 5_500_000, amountUsdCents: 42_314, kesPerUsd: "129.980973",
      status: "captured", paypalRequestId: "req-1", paypalOrderId: "ORDER1", paypalCaptureId: "CAP-ORDER1", capturedAt: new Date(),
    });

    const result = await run("valid-delivery");
    expect(result.setup).toEqual(["Used the delivery you paid for in PayPal sandbox."]);
    expect(result.verdict).toBe("verified");
    expect((await db.select().from(s.requests).where(eq(s.requests.id, request.id)))[0].status).toBe("verified");
  });

  it("leaves the vision checks unknown when no recording fits the photo, so it needs fresh proof", async () => {
    const result = await runScenario(deps(replayModels({ ...recordings, inspections: [] })), "valid-delivery");
    expect(result.verdict).toBe("needs_fresh_proof");
    expect(result.models).toEqual([expect.objectContaining({ task: "proof_inspection", source: "none" })]);
    const verdict = await verdictOf(result.proofId!);
    expect(verdict.checks.find((c) => c.name === "code")?.result).toBe("unknown");
  });
});

describe("Recycled photo", () => {
  it("catches the reused, far-away photo, holds the foundation and blocks Otieno's labour payment", async () => {
    const result = await run("recycled-photo");

    expect(result.setup).toEqual([expect.stringMatching(/foundation photo from six days ago/)]);
    expect(result.verdict).toBe("suspicious");
    const verdict = await verdictOf(result.proofId!);
    const checks = Object.fromEntries(verdict.checks.map((c) => [c.name, c.result]));
    expect(checks).toMatchObject({ duplicate: "fail", location: "fail", code: "fail" });
    expect((await milestone()).status).toBe("held");
    expect(result.outcome).toMatch(/Payments for this milestone are held/);
    expect(result.links.map((l) => l.href)).toEqual([`/proofs/${result.proofId}`, `/projects/${DEMO.projectId}/gantt`]);

    const labour = await createOrderForMilestone(db, "m2", { paypal: noPayPal, appUrl: LINK_BASE, rate: async () => ({ kesPerUsd: "129.980973" }) });
    expect(labour).toMatchObject({ ok: false, code: expect.stringMatching(/milestone_held|not_verified/) });
  });

  it("seeds the earlier photo once, however often it runs", async () => {
    await run("recycled-photo");
    const again = await run("recycled-photo");
    expect(again.setup).toEqual([
      expect.stringMatching(/Closed Peter's open proof code/),
      "Used Peter's earlier foundation photo, already in place from a previous run.",
    ]);
    expect(await db.select().from(s.auditEvents).where(eq(s.auditEvents.action, "judge.earlier_photo_seeded"))).toHaveLength(1);
    expect(again.verdict).toBe("suspicious");
  });
});

describe("running in any order", () => {
  it("runs every scenario after every other, without a reset in between", async () => {
    const recycled = await run("recycled-photo");
    const delivery = await run("valid-delivery");
    const quote = await run("inflated-quote");
    expect([recycled.verdict, delivery.verdict]).toEqual(["suspicious", "verified"]);
    expect(quote.requestId).toBeDefined();
    const [request] = await db.select().from(s.requests).where(eq(s.requests.id, quote.requestId!));
    expect(request.status).toBe("awaiting_approval");
  });

  it("knows only its three scenarios", () => {
    expect(["inflated-quote", "valid-delivery", "recycled-photo"].every(isScenarioId)).toBe(true);
    expect(isScenarioId("toString")).toBe(false);
    expect(isScenarioId("cement-request")).toBe(false);
  });
});

describe("the simulator's chat", () => {
  it("shows what Peter sent and what Hakika answered, oldest first, and nothing from real WhatsApp", async () => {
    await db.insert(s.messages).values({
      projectId: DEMO.projectId, contactId: DEMO.contactIds.peter, direction: "inbound", channel: "whatsapp", kind: "text", body: "real phone",
    });
    await run("valid-delivery");

    const chat = await loadJudgeChat(db, DEMO.projectId);
    expect(chat.some((m) => m.text === "real phone")).toBe(false);
    const inbound = chat.filter((m) => m.direction === "inbound");
    expect(inbound.map((m) => m.kind)).toEqual(["text", "location", "image"]);
    expect(inbound[0]).toMatchObject({ text: "PROOF", contact: { id: DEMO.contactIds.peter, name: "Peter Mwangi", role: "foreman" } });
    expect(inbound[1].location).toEqual({ lat: -0.42016, lng: 36.94771 });
    expect(inbound[2].imageUrl).toBe(`/api/judge/messages/${inbound[2].id}/image`);
    const code = chat.find((m) => m.templateKey === "proof_request");
    expect(code?.text).toContain(JUDGE_DELIVERY_CODE);
    expect(code?.text).toContain("[link hidden]");

    const later = await loadJudgeChat(db, DEMO.projectId, new Date(chat.at(-1)!.at));
    expect(later).toEqual([]);
  });

  it("serves a simulated photo, and never a real WhatsApp one", async () => {
    await run("valid-delivery");
    const [image] = (await loadJudgeChat(db, DEMO.projectId)).filter((m) => m.imageUrl);
    expect(await judgeMessageMedia(db, image.id)).toMatchObject({ contentType: "image/jpeg" });

    const [real] = await db.insert(s.messages).values({
      projectId: DEMO.projectId, direction: "inbound", channel: "whatsapp", kind: "image", mediaPath: "whatsapp/x.jpg", mediaContentType: "image/jpeg",
    }).returning();
    expect(await judgeMessageMedia(db, real.id)).toBeNull();
  });
});

describe("reset", () => {
  it("is refused within the cooldown after the last reset, then rebuilds the demo", async () => {
    await run("recycled-photo");
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, DEMO.projectId));

    const soon = await resetJudgeDemo(db, {}, new Date(project.createdAt.getTime() + 5_000));
    expect(soon).toEqual({ reset: false, retryAfterS: RESET_COOLDOWN_S - 5 });
    expect((await milestone()).status).toBe("held");

    const later = await resetJudgeDemo(db, {}, new Date(project.createdAt.getTime() + RESET_COOLDOWN_S * 1000));
    expect(later).toEqual({ reset: true });
    expect((await milestone()).status).toBe("in_progress");
    expect(await db.select().from(s.proofs).where(eq(s.proofs.projectId, DEMO.projectId))).toEqual([]);
  });
});

// The real recording (Nova, 7 Nov). If a code change makes a recording stop fitting, this says so.
describe("the committed recording", () => {
  const real = () => deps(replayModels(committed as JudgeRecordings));

  it("replays Nova's quote reading: an inflated quote from an unverified supplier", async () => {
    const result = await runScenario(real(), "inflated-quote");
    expect(result.models[0]).toMatchObject({ task: "quote_reading", source: "recorded", modelId: "eu.amazon.nova-2-lite-v1:0" });
    const findings = await db.select().from(s.findings).where(eq(s.findings.requestId, result.requestId!));
    expect(findings.map((f) => f.type)).toEqual(expect.arrayContaining(["price_above_market", "unverified_supplier"]));
    // The summary is recorded once main's prices are in this branch.
    expect(result.models[1]).toMatchObject({ task: "owner_summary", source: (committed as JudgeRecordings).summary ? "recorded" : "none" });
  });

  it("replays Nova's look at the delivery photo: the code read right, so it verifies", async () => {
    const result = await runScenario(real(), "valid-delivery");
    expect(result.verdict).toBe("verified");
    const verdict = await verdictOf(result.proofId!);
    expect(verdict.checks.find((c) => c.name === "code")).toMatchObject({ result: "pass" });
    expect(verdict.checks.find((c) => c.name === "expected_items")?.detail).toMatch(/check the delivery note/);
  });

  it("replays Nova's look at the recycled photo: Suspicious, and the foundation is held", async () => {
    const result = await runScenario(real(), "recycled-photo");
    expect(result.verdict).toBe("suspicious");
    expect(result.models).toEqual([expect.objectContaining({ source: "recorded" })]);
    expect((await milestone()).status).toBe("held");
  });
});

describe("the committed test files", () => {
  it("are the ones the scenarios name", async () => {
    for (const name of Object.values(JUDGE_MEDIA)) {
      expect((await readFile(`public/${name}`)).byteLength).toBeGreaterThan(10_000);
    }
  });

  it("include a recycled photo the duplicate check catches", async () => {
    await run("recycled-photo");
    const proofs = await db.select().from(s.proofs).where(and(eq(s.proofs.projectId, DEMO.projectId))).orderBy(asc(s.proofs.receivedAt));
    expect(proofs).toHaveLength(2);
  });
});
