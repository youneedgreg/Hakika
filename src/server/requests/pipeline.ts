// From a stored WhatsApp message to a price-checked request. Only a foreman's messages go to the
// models. A quote photo becomes a request; a text or voice note asking for materials gets asked for
// the quote. Models read; the price check decides; nothing here can move money. A quote with a total
// goes to the owner for approval. One without stays at "checked" until the foreman sends it again.

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { ExplainFindings } from "@/server/ai/explain";
import type { ParsedMessage } from "@/server/ai/parse-message";
import type { CatalogItem } from "@/server/ai/nova";
import type { ReadQuote } from "@/server/ai/quote";
import type { Translation } from "@/server/ai/translate";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { checkPrices, type PriceCheckInput } from "@/server/pricing/engine";
import { writeOwnerSummary } from "@/server/requests/summary";
import { requestMachine } from "@/server/state/machines";
import { describeError, replyWithTemplate, type IntakeDeps, type StoredInbound } from "@/server/whatsapp/intake";
import type { MediaFile } from "@/server/whatsapp/media";

export type ReadingModels = {
  translate: (file: MediaFile) => Promise<Translation>;
  readQuote: (file: MediaFile, catalog: CatalogItem[]) => Promise<ReadQuote>;
  parseMessage: (message: { text: string; source: "text" | "voice" }, catalog: CatalogItem[]) => Promise<ParsedMessage>;
  explainFindings: ExplainFindings;
};

type Deps = Pick<IntakeDeps, "db" | "send">;
type Status = (typeof s.requests.$inferSelect)["status"];

const RECENT_QUOTE_MS = 15 * 60_000; // a voice note just after a quote is about that quote
const UNKNOWN_ITEM = "unknown"; // request_lines needs a key; this one has no reference, so it's never priced as checked
// Quantities already committed to the milestone: approved or paid for, whatever happened afterwards.
const COMMITTED: Status[] = ["approved", "paid", "awaiting_proof", "verified", "held"];

export async function runRequestPipeline(deps: Deps, models: ReadingModels, stored: StoredInbound): Promise<void> {
  const { contact, message, file } = stored;
  if (contact.role !== "foreman" || message.unsupported || !contact.projectId) return;
  try {
    if (message.kind === "image" && file) await handleQuotePhoto(deps, models, stored, file);
    else if (message.kind === "voice" && file) await handleVoiceNote(deps, models, stored, file);
    else if (message.kind === "text" && message.text) await handleText(deps, models, stored, message.text, "text");
  } catch (error) {
    console.error("The request pipeline failed:", describeError(error));
    await replyWithTemplate(deps, contact, message, "needs_info")
      .catch((replyError) => console.error("The clarifying reply failed:", describeError(replyError)));
  }
}

async function handleVoiceNote(deps: Deps, models: ReadingModels, stored: StoredInbound, file: MediaFile) {
  const translation = await models.translate(file);
  if (translation.outcome === "unreadable") {
    await replyWithTemplate(deps, stored.contact, stored.message, "needs_info");
    return;
  }
  await deps.db.update(s.messages).set({ body: translation.text }).where(eq(s.messages.id, stored.messageId));
  await handleText(deps, models, stored, translation.text, "voice");
}

async function handleText(
  deps: Deps,
  models: ReadingModels,
  { contact, message }: StoredInbound,
  text: string,
  source: "text" | "voice",
) {
  const parsed = await models.parseMessage({ text, source }, await loadCatalog(deps.db));
  if (parsed.outcome === "unreadable") {
    await replyWithTemplate(deps, contact, message, "needs_info");
    return;
  }
  if (parsed.intent !== "materials_request" || parsed.items.length === 0) return;

  const since = new Date(Date.now() - RECENT_QUOTE_MS);
  const [recent] = await deps.db.select({ id: s.requests.id }).from(s.requests)
    .where(and(eq(s.requests.contactId, contact.id), gte(s.requests.createdAt, since))).limit(1);
  if (!recent) await replyWithTemplate(deps, contact, message, "quote_needed");
}

async function handleQuotePhoto(deps: Deps, models: ReadingModels, stored: StoredInbound, file: MediaFile) {
  const { db } = deps;
  const { contact, message, messageId } = stored;
  const milestone = await currentMilestone(db, contact.projectId);

  const [{ id: requestId }] = await db.insert(s.requests).values({
    projectId: contact.projectId,
    milestoneId: milestone?.id ?? null,
    contactId: contact.id,
    messageId,
    quoteImagePath: await storedMediaPath(db, messageId),
  }).returning({ id: s.requests.id });
  await audit(db, contact, requestId, "request.received", `${contact.name} sent a quote photo.`);

  let quote: ReadQuote;
  try {
    quote = await models.readQuote(file, await loadCatalog(db));
  } catch (error) {
    await failRequest(db, contact, requestId, "request.read_failed", "The quote photo could not be read.");
    throw error;
  }

  if (quote.outcome === "suspicious") {
    await failRequest(
      db, contact, requestId, "request.suspicious_quote",
      "The quote photo contained text aimed at the reading model, so nothing from it was used.",
      { allText: quote.allText, raw: quote.raw },
    );
    await replyWithTemplate(deps, contact, message, "needs_info");
    return;
  }
  if (quote.outcome === "unreadable" || quote.lines.length === 0) {
    await failRequest(db, contact, requestId, "request.unreadable_quote", "No items could be read from the quote photo.");
    await replyWithTemplate(deps, contact, message, "needs_info");
    return;
  }

  const input = await loadPriceInput(db, milestone?.id ?? null, quote);
  const result = checkPrices(input);
  const complete = result.lines.filter((line) => line.qty !== null && line.unitPriceKesCents !== null);

  const parsedStatus = requestMachine.transition("received", "parsed");
  const checkedStatus = requestMachine.transition(parsedStatus, "checked");
  const canApprove = result.quotedTotalKesCents !== null;
  // Outside the transaction: a model call shouldn't hold a database connection open.
  const written = await writeOwnerSummary(models.explainFindings, contact.name, input.quotedSupplier, result);

  await db.transaction(async (tx) => {
    await tx.update(s.requests).set({
      status: canApprove ? requestMachine.transition(checkedStatus, "sent_for_approval") : checkedStatus,
      quotedSupplierId: input.quotedSupplier.id,
      quotedSupplierName: quote.supplierName,
      quotedTotalKesCents: result.quotedTotalKesCents ?? quote.statedTotalKesCents,
      recommendedSupplierId: result.recommended?.supplierId ?? null,
      recommendedTotalKesCents: result.recommended?.totalKesCents ?? null,
      summary: written.summary,
      parsed: quote.raw as object,
    }).where(eq(s.requests.id, requestId));
    if (complete.length > 0) {
      await tx.insert(s.requestLines).values(complete.map((line, position) => ({
        requestId,
        position,
        itemKey: line.itemKey ?? UNKNOWN_ITEM,
        description: line.description,
        qty: line.qty!,
        unit: line.unit,
        unitPriceKesCents: line.unitPriceKesCents!,
        referenceUnitPriceKesCents: line.referenceUnitPriceKesCents,
      })));
    }
    if (result.findings.length > 0) {
      await tx.insert(s.findings).values(result.findings.map((finding, position) => ({ requestId, position, ...finding })));
    }
    await audit(tx, contact, requestId, "request.checked", `The quote was read and checked: ${result.findings.length} findings.`);
    if (canApprove) {
      await audit(tx, contact, requestId, "request.sent_for_approval", "The request was sent to the owner for approval.", {
        summarySource: written.source,
        ...(written.rejected ? { summaryRejected: written.rejected } : {}),
      });
    }
  });

  if (!canApprove) await replyWithTemplate(deps, contact, message, "needs_info");
}

async function failRequest(
  db: AnyDb,
  contact: StoredInbound["contact"],
  requestId: string,
  action: string,
  description: string,
  parsed?: object,
) {
  await db.update(s.requests)
    .set({ status: requestMachine.transition("received", "parse_failed"), summary: description, ...(parsed ? { parsed } : {}) })
    .where(eq(s.requests.id, requestId));
  await audit(db, contact, requestId, action, description);
}

function audit(
  db: AnyDb,
  contact: StoredInbound["contact"],
  requestId: string,
  action: string,
  description: string,
  data?: object,
) {
  return db.insert(s.auditEvents).values({
    projectId: contact.projectId, kind: "request", action, description, requestId, actor: `contact:${contact.id}`, data,
  });
}

// The milestone a new quote belongs to: the first one still under way (in progress, waiting on
// proof, or held), else the next planned one. A held milestone keeps its quotes, so its hold
// blocks them, rather than the quote slipping onto the next milestone and its materials plan.
const UNDER_WAY = new Set(["in_progress", "awaiting_proof", "held"]);

export async function currentMilestone(db: AnyDb, projectId: string) {
  const milestones = await db.select().from(s.milestones)
    .where(eq(s.milestones.projectId, projectId)).orderBy(asc(s.milestones.position));
  return milestones.find((m) => UNDER_WAY.has(m.status)) ?? milestones.find((m) => m.status === "planned") ?? null;
}

async function storedMediaPath(db: AnyDb, messageId: string) {
  const [row] = await db.select({ mediaPath: s.messages.mediaPath }).from(s.messages).where(eq(s.messages.id, messageId));
  return row?.mediaPath ?? null;
}

async function loadCatalog(db: AnyDb): Promise<CatalogItem[]> {
  return db.select({
    itemKey: s.priceReferences.itemKey, description: s.priceReferences.description, unit: s.priceReferences.unit,
  }).from(s.priceReferences).orderBy(asc(s.priceReferences.itemKey));
}

// The numbers the price check needs, all from the database apart from what the quote says.
async function loadPriceInput(
  db: AnyDb,
  milestoneId: string | null,
  quote: Extract<ReadQuote, { outcome: "read" }>,
): Promise<PriceCheckInput> {
  const references = await db.select().from(s.priceReferences);
  const suppliers = await db.select().from(s.suppliers);
  const prices = await db.select().from(s.supplierPrices);

  const name = quote.supplierName?.trim() ?? "";
  // An exact match only: a near match could pass an unverified shop off as a verified one.
  const known = suppliers.find((supplier) => supplier.name.toLowerCase() === name.toLowerCase());

  return {
    lines: quote.lines,
    quotedSupplier: known
      ? { id: known.id, name: known.name, verified: known.verified }
      : { id: null, name: name || "The unnamed supplier", verified: false },
    statedTotalKesCents: quote.statedTotalKesCents,
    references: references.map(({ itemKey, unit, medianKesCents }) => ({ itemKey, unit, medianKesCents })),
    planRemaining: milestoneId ? await loadPlanRemaining(db, milestoneId) : [],
    verifiedSuppliers: suppliers.filter((supplier) => supplier.verified).map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      prices: prices.filter((price) => price.supplierId === supplier.id),
    })),
  };
}

async function loadPlanRemaining(db: AnyDb, milestoneId: string) {
  const plan = await db.select().from(s.materialPlanLines).where(eq(s.materialPlanLines.milestoneId, milestoneId));
  const committed = await db.select({ itemKey: s.requestLines.itemKey, qty: sql<number>`sum(${s.requestLines.qty})`.mapWith(Number) })
    .from(s.requestLines)
    .innerJoin(s.requests, eq(s.requestLines.requestId, s.requests.id))
    .where(and(eq(s.requests.milestoneId, milestoneId), inArray(s.requests.status, COMMITTED)))
    .groupBy(s.requestLines.itemKey);
  return plan.map(({ itemKey, unit, qty }) => ({
    itemKey,
    unit,
    qty: Math.max(qty - (committed.find((row) => row.itemKey === itemKey)?.qty ?? 0), 0),
  }));
}
