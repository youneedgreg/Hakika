// Judge Mode's three scenarios, run on the server through the same pipeline as WhatsApp. Each one
// puts in place what it needs first and says so, so a judge can run them in any order, and then
// sends Peter's messages as simulated WhatsApp messages. Nothing is sent to a phone, no model is
// called (replay.ts), and no money moves: approving a request goes through PayPal sandbox as usual.

import { and, desc, eq } from "drizzle-orm";
import type { ProofPhoto } from "@/server/ai/proof-vision";
import type { AnyDb } from "@/server/db/client";
import { DEMO } from "@/server/db/demo";
import { newId } from "@/server/db/ids";
import * as s from "@/server/db/schema";
import { formatKes, kesCentsToUsdCents } from "@/server/pricing/money";
import { generateToken, hashToken, PROOF_LINK_TTL_MS } from "@/server/proofs/codes";
import { dHash, hammingDistance } from "@/server/proofs/dhash";
import { HELD_MESSAGE, milestoneHold } from "@/server/proofs/holds";
import { findDeliveryDue } from "@/server/proofs/requests";
import { DUPLICATE_MAX_BITS } from "@/server/proofs/verify";
import { runRequestPipeline, type ReadingModels } from "@/server/requests/pipeline";
import { findContactById, processInbound, type InboundMessage, type IntakeDeps } from "@/server/whatsapp/intake";
import type { MediaFile } from "@/server/whatsapp/media";
import type { ScenarioId, ScenarioResult } from "@/shared/api";
import { JUDGE_DELIVERY_CODE, JUDGE_MEDIA, type JudgeMediaName } from "./media";
import type { JudgeModels } from "./replay";

export type JudgeDeps = {
  db: AnyDb;
  models: JudgeModels;
  readMedia: (name: JudgeMediaName) => Promise<MediaFile>; // the test files
  storeMedia: IntakeDeps["storeMedia"]; // private Blob storage
  readPhoto: (blobPath: string) => Promise<ProofPhoto | null>; // a stored photo, shrunk for the model
  rate: () => Promise<{ kesPerUsd: string }>; // for the seeded delivery's USD amount
  linkBase: string; // proof links in stored replies (the token itself is hidden)
  now?: () => Date;
};

type Step =
  | { kind: "text"; text: string }
  | { kind: "image"; media: JudgeMediaName }
  | { kind: "location"; lat: number; lng: number };

// Both points are fictional. The demo site is -0.4201, 36.9476 with a 150 m radius.
const AT_SITE = { lat: -0.42016, lng: 36.94771 };
const FAR_FROM_SITE = { lat: -0.0917, lng: 37.0062 }; // about 37 km away, near Karatina

export const SCENARIOS: Record<ScenarioId, { title: string; steps: Step[] }> = {
  "inflated-quote": {
    title: "Inflated quote",
    steps: [{ kind: "image", media: JUDGE_MEDIA.quote }],
  },
  "valid-delivery": {
    title: "Valid delivery",
    steps: [
      { kind: "text", text: "PROOF" },
      { kind: "location", ...AT_SITE },
      { kind: "image", media: JUDGE_MEDIA.delivery },
    ],
  },
  "recycled-photo": {
    title: "Recycled photo",
    steps: [
      { kind: "text", text: "DONE" },
      { kind: "location", ...FAR_FROM_SITE },
      { kind: "image", media: JUDGE_MEDIA.recycledFoundation },
    ],
  },
};

export function isScenarioId(id: string): id is ScenarioId {
  return Object.hasOwn(SCENARIOS, id);
}

const NEVER_SENT = () => Promise.reject(new Error("Judge Mode never sends real WhatsApp messages."));
const JUDGE_MEDIA_NAMES = new Set<string>(Object.values(JUDGE_MEDIA));
const clock = (deps: JudgeDeps) => (deps.now ?? (() => new Date()))();

// "Valid delivery" sends the same photo every time. Once it's on record, sending it again would
// rightly be caught as a reused photo, so that scenario runs once per reset.
export class ScenarioNeedsReset extends Error {}

export async function runScenario(deps: JudgeDeps, id: ScenarioId): Promise<ScenarioResult> {
  const { db, models } = deps;
  const peter = await findContactById(db, DEMO.contactIds.peter);
  if (!peter) throw new Error("The demo project isn't seeded: reset it first.");
  if (id === "valid-delivery" && await photoOnRecord(deps, JUDGE_MEDIA.delivery)) {
    throw new ScenarioNeedsReset("Valid delivery has already run since the last reset, and its photo is on record now: sending it again would be caught as a reused photo. Reset the demo to run it again.");
  }

  const setup = await SETUPS[id](deps);

  // The delivery photo shows a code drawn in advance, so that scenario's PROOF reply issues it.
  let fixedCode = id === "valid-delivery" ? JUDGE_DELIVERY_CODE : undefined;
  const reading: ReadingModels = {
    readQuote: models.readQuote,
    explainFindings: models.explainFindings,
    translate: () => Promise.reject(new Error("Judge Mode has no recorded voice notes.")),
    parseMessage: () => Promise.reject(new Error("Judge Mode has no recorded text messages.")),
  };
  const intake: IntakeDeps = {
    db,
    loadMedia: (name) => {
      if (!JUDGE_MEDIA_NAMES.has(name)) return Promise.reject(new Error("Not one of Judge Mode's test files."));
      return deps.readMedia(name as JudgeMediaName);
    },
    storeMedia: deps.storeMedia,
    send: NEVER_SENT,
    vision: { ...models.vision, readPhoto: deps.readPhoto },
    fresh: { notifier: { channel: "simulator", send: NEVER_SENT, testPhones: new Map() }, linkBase: deps.linkBase },
    linkBase: deps.linkBase,
    newCode: () => {
      const code = fixedCode;
      fixedCode = undefined; // only the first code; a fresh code after a failed photo is random
      return code;
    },
    afterReply: (stored) => runRequestPipeline(intake, reading, stored),
  };

  const messageIds: string[] = [];
  for (const step of SCENARIOS[id].steps) {
    const message: InboundMessage = {
      id: newId("msg"),
      channel: "simulator",
      kind: step.kind,
      ...(step.kind === "text" ? { text: step.text } : {}),
      ...(step.kind === "image" ? { media: { url: step.media } } : {}),
      ...(step.kind === "location" ? { location: { lat: step.lat, lng: step.lng } } : {}),
    };
    const storedId = await processInbound(intake, peter, message);
    if (storedId) messageIds.push(storedId);
  }

  const lastMessageId = messageIds.at(-1);
  const result = id === "inflated-quote"
    ? await quoteResult(db, lastMessageId)
    : await proofResult(db, lastMessageId);
  return { scenarioId: id, title: SCENARIOS[id].title, setup, models: [...models.notes], messageIds, ...result };
}

// What each scenario needs before its messages go in. Each returns sentences for the screen.
const SETUPS: Record<ScenarioId, (deps: JudgeDeps) => Promise<string[]>> = {
  "inflated-quote": closeOpenCodes,
  "valid-delivery": async (deps) => [...await closeOpenCodes(deps), ...await ensureDeliveryDue(deps)],
  "recycled-photo": async (deps) => [...await closeOpenCodes(deps), ...await ensureEarlierSitePhoto(deps)],
};

// A photo from someone with an open code is taken as that code's proof, so a code left open by an
// earlier run would swallow the next scenario's photo. Each run starts with Peter's codes closed.
async function closeOpenCodes({ db }: JudgeDeps): Promise<string[]> {
  const closed = await db.update(s.proofRequests).set({ status: "expired" })
    .where(and(eq(s.proofRequests.contactId, DEMO.contactIds.peter), eq(s.proofRequests.status, "issued")))
    .returning({ id: s.proofRequests.id, code: s.proofRequests.code, milestoneId: s.proofRequests.milestoneId });
  if (closed.length === 0) return [];
  await db.insert(s.auditEvents).values(closed.map((c) => ({
    projectId: DEMO.projectId,
    kind: "proof" as const,
    action: "judge.code_closed",
    description: `Judge Mode closed Peter's open proof code ${c.code} before running a scenario.`,
    actor: "system",
    milestoneId: c.milestoneId,
    data: { proofRequestId: c.id },
  })));
  return [`Closed Peter's open proof code${closed.length > 1 ? "s" : ""} ${closed.map((c) => c.code).join(", ")} from an earlier run, so this run's photo isn't taken as an answer to ${closed.length > 1 ? "them" : "it"}.`];
}

// "Valid delivery" proves a paid delivery. A request approved in PayPal sandbox (after "Inflated
// quote") is used when there is one; otherwise a paid cement delivery is put in place, clearly
// marked: it has no PayPal payment behind it.
async function ensureDeliveryDue(deps: JudgeDeps): Promise<string[]> {
  const { db } = deps;
  const peter = (await findContactById(db, DEMO.contactIds.peter))!;
  const due = await findDeliveryDue(db, peter);
  if (due) {
    const [payment] = await db.select({ paypalCaptureId: s.payments.paypalCaptureId }).from(s.payments).where(eq(s.payments.id, due.paymentId));
    return payment?.paypalCaptureId?.startsWith(SEED_CAPTURE_PREFIX)
      ? ["Used the paid cement delivery Judge Mode set up earlier (no PayPal payment behind it)."]
      : ["Used the delivery you paid for in PayPal sandbox."];
  }

  const QTY = 50;
  const [price] = await db.select().from(s.supplierPrices)
    .where(and(eq(s.supplierPrices.supplierId, DEMO.supplierIds.mlima), eq(s.supplierPrices.itemKey, "cement_50kg")));
  const [reference] = await db.select().from(s.priceReferences).where(eq(s.priceReferences.itemKey, "cement_50kg"));
  const [supplier] = await db.select().from(s.suppliers).where(eq(s.suppliers.id, DEMO.supplierIds.mlima));
  const [milestone] = await db.select().from(s.milestones)
    .where(and(eq(s.milestones.projectId, DEMO.projectId), eq(s.milestones.id, "m2")));
  if (!price || !reference || !supplier || !milestone) throw new Error("The demo project isn't seeded: reset it first.");

  const totalKesCents = price.unitPriceKesCents * QTY;
  const { kesPerUsd } = await deps.rate();
  const requestId = newId("req");
  const paymentId = newId("pay");
  const now = clock(deps);
  const summary = `Set up by Judge Mode so "Valid delivery" can run on its own: ${QTY} bags of cement from ${supplier.name} for ${formatKes(totalKesCents)}, marked paid without a PayPal payment.`;

  await db.transaction(async (tx) => {
    await tx.insert(s.requests).values({
      id: requestId,
      projectId: DEMO.projectId,
      milestoneId: milestone.id,
      contactId: DEMO.contactIds.peter,
      status: "paid",
      quotedSupplierId: supplier.id,
      quotedSupplierName: supplier.name,
      quotedTotalKesCents: totalKesCents,
      recommendedSupplierId: supplier.id,
      recommendedTotalKesCents: totalKesCents,
      summary,
    });
    await tx.insert(s.requestLines).values({
      requestId, position: 0, itemKey: "cement_50kg", description: reference.description, qty: QTY, unit: reference.unit,
      unitPriceKesCents: price.unitPriceKesCents, referenceUnitPriceKesCents: reference.medianKesCents,
    });
    await tx.insert(s.payments).values({
      id: paymentId,
      projectId: DEMO.projectId,
      kind: "materials",
      requestId,
      payeeSupplierId: supplier.id,
      payeeEmail: supplier.paypalEmail ?? SEED_PAYEE_EMAIL,
      amountKesCents: totalKesCents,
      amountUsdCents: kesCentsToUsdCents(totalKesCents, kesPerUsd),
      kesPerUsd,
      status: "captured",
      paypalRequestId: `judge-seed-${paymentId}`,
      paypalCaptureId: `${SEED_CAPTURE_PREFIX}${paymentId}`,
      capturedAt: now,
    });
    await tx.insert(s.auditEvents).values({
      projectId: DEMO.projectId,
      kind: "payment",
      action: "judge.delivery_seeded",
      description: `Judge Mode set up a paid delivery of ${QTY} bags of cement from ${supplier.name} (${formatKes(totalKesCents)}) so "Valid delivery" can run on its own. No PayPal payment was made for it.`,
      actor: "system",
      requestId,
      paymentId,
      milestoneId: milestone.id,
    });
  });
  return [`Set up a paid delivery of ${QTY} bags of cement from ${supplier.name}, marked paid without a PayPal payment (approve "Inflated quote" in PayPal sandbox first to prove a real one).`];
}

// Whether a proof on the demo project looks like this test file, by the duplicate check's measure.
async function photoOnRecord(deps: JudgeDeps, name: JudgeMediaName): Promise<boolean> {
  const hash = await dHash((await deps.readMedia(name)).bytes);
  const existing = await deps.db.select({ dhash: s.proofs.dhash }).from(s.proofs).where(eq(s.proofs.projectId, DEMO.projectId));
  return existing.some((p) => hammingDistance(p.dhash, hash) <= DUPLICATE_MAX_BITS);
}

// "Recycled photo" needs an earlier photo to recycle: Peter's foundation photo from six days ago.
async function ensureEarlierSitePhoto(deps: JudgeDeps): Promise<string[]> {
  const { db } = deps;
  if (await photoOnRecord(deps, JUDGE_MEDIA.earlierFoundation)) {
    return ["Used Peter's earlier foundation photo, already in place from a previous run."];
  }
  const file = await deps.readMedia(JUDGE_MEDIA.earlierFoundation);
  const hash = await dHash(file.bytes);

  const sixDaysAgo = new Date(clock(deps).getTime() - 6 * 24 * 60 * 60 * 1000);
  const proofRequestId = newId("prq");
  const proofId = newId("prf");
  const blobPath = await deps.storeMedia(`judge/${proofId}.${file.extension}`, file);
  await db.transaction(async (tx) => {
    await tx.insert(s.proofRequests).values({
      id: proofRequestId,
      projectId: DEMO.projectId,
      milestoneId: "m2",
      contactId: DEMO.contactIds.peter,
      purpose: "progress",
      code: "HM4K",
      tokenHash: hashToken(generateToken()),
      status: "used",
      issuedAt: sixDaysAgo,
      expiresAt: new Date(sixDaysAgo.getTime() + PROOF_LINK_TTL_MS),
      usedAt: sixDaysAgo,
    });
    await tx.insert(s.proofs).values({
      id: proofId,
      projectId: DEMO.projectId,
      proofRequestId,
      source: "whatsapp",
      blobPath,
      contentType: file.contentType,
      sizeBytes: file.bytes.byteLength,
      dhash: hash,
      captureLat: AT_SITE.lat,
      captureLng: AT_SITE.lng,
      receivedAt: sixDaysAgo,
    });
    await tx.insert(s.auditEvents).values({
      projectId: DEMO.projectId,
      kind: "proof",
      action: "judge.earlier_photo_seeded",
      description: "Judge Mode added Peter's foundation photo from six days ago, so \"Recycled photo\" has an earlier photo to reuse.",
      actor: "system",
      proofId,
      milestoneId: "m2",
    });
  });
  return ["Added Peter's foundation photo from six days ago, the one this scenario sends again."];
}

export const SEED_CAPTURE_PREFIX = "JUDGE-SEED-";
const SEED_PAYEE_EMAIL = "no-paypal-payment@judge-mode.invalid";

async function quoteResult(db: AnyDb, messageId: string | undefined): Promise<Partial<ScenarioResult> & Pick<ScenarioResult, "outcome" | "links">> {
  const [request] = messageId
    ? await db.select().from(s.requests).where(eq(s.requests.messageId, messageId)).limit(1)
    : [];
  if (!request) return { outcome: "The quote photo didn't become a request. Open the chat to see Hakika's reply.", links: [] };
  const findings = await db.select({ type: s.findings.type }).from(s.findings).where(eq(s.findings.requestId, request.id));
  const total = request.quotedTotalKesCents === null ? "no total" : formatKes(request.quotedTotalKesCents);
  const recommended = request.recommendedTotalKesCents === null ? "" : ` Hakika recommends a verified supplier at ${formatKes(request.recommendedTotalKesCents)}.`;
  const held = request.milestoneId && await milestoneHold(db, request.milestoneId)
    ? " Its milestone is held by a failed proof, so paying it is refused until fresh proof passes or the owner overrides."
    : "";
  const outcome = request.status === "awaiting_approval"
    ? `Peter's quote (${total}) was read and price-checked with ${findings.length} finding${findings.length === 1 ? "" : "s"}, and is waiting for the owner's approval.${recommended}${held}`
    : `Peter's quote was read; the request is now "${request.status}".`;
  return {
    outcome,
    requestId: request.id,
    milestoneId: request.milestoneId ?? undefined,
    links: [{ label: "Open the approval card", href: `/requests/${request.id}` }],
  };
}

async function proofResult(db: AnyDb, messageId: string | undefined): Promise<Partial<ScenarioResult> & Pick<ScenarioResult, "outcome" | "links">> {
  const [message] = messageId ? await db.select().from(s.messages).where(eq(s.messages.id, messageId)) : [];
  const [row] = message?.mediaPath
    ? await db.select({ proofId: s.proofs.id, milestoneId: s.proofRequests.milestoneId, outcome: s.verdicts.outcome, explanation: s.verdicts.explanation })
      .from(s.proofs)
      .innerJoin(s.proofRequests, eq(s.proofRequests.id, s.proofs.proofRequestId))
      .leftJoin(s.verdicts, eq(s.verdicts.proofId, s.proofs.id))
      .where(eq(s.proofs.blobPath, message.mediaPath))
      .orderBy(desc(s.proofs.receivedAt)).limit(1)
    : [];
  if (!row) return { outcome: "The photo wasn't taken as proof. Open the chat to see Hakika's reply.", links: [] };

  const hold = await milestoneHold(db, row.milestoneId);
  const words = { verified: "Verified", needs_fresh_proof: "Needs fresh proof", suspicious: "Suspicious" } as const;
  const verdict = row.outcome ? `${words[row.outcome]}. ${row.explanation}` : "The photo is stored but not checked yet.";
  return {
    outcome: hold ? `${verdict} ${HELD_MESSAGE}` : verdict,
    proofId: row.proofId,
    milestoneId: row.milestoneId,
    verdict: row.outcome ?? undefined,
    links: [
      { label: "Open the proof review", href: `/proofs/${row.proofId}` },
      { label: "Open the timeline", href: `/projects/${DEMO.projectId}/gantt` },
    ],
  };
}
