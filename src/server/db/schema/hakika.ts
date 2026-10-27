// Hakika's tables, grouped as in the roadmap's data model.
// Column names are snake_case in Postgres (the client and drizzle-kit both use casing: "snake_case").
// Money is stored as integer minor units (KES cents, USD cents); the API turns it into decimal strings.

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn, bigint, boolean, check, date, doublePrecision, index, integer, jsonb, numeric,
  pgTable, text, timestamp, unique,
} from "drizzle-orm/pg-core";
import type { Finding, ProofCheck } from "@/shared/types";
import {
  auditKind, contactRole, findingSeverity, findingType, language, messageChannel, messageDirection,
  messageKind, milestoneStatus, paymentKind, paymentStatus, proofPurpose, proofRequestStatus,
  proofSource, requestStatus, verdictOutcome, webhookProvider,
} from "../enums";
import { newId } from "../ids";
import { user } from "./auth";

const createdAt = () => timestamp({ withTimezone: true }).defaultNow().notNull();
const cents = () => bigint({ mode: "number" });

// People and places

export const projects = pgTable("projects", {
  id: text().primaryKey().$defaultFn(() => newId("prj")),
  ownerId: text().notNull().references(() => user.id, { onDelete: "restrict" }),
  name: text().notNull(),
  siteLabel: text().notNull(),
  siteLat: doublePrecision().notNull(),
  siteLng: doublePrecision().notNull(),
  siteRadiusM: integer().notNull(),
  budgetKesCents: cents().notNull(),
  createdAt: createdAt(),
}, (t) => [
  check("projects_site_radius_positive", sql`${t.siteRadiusM} > 0`),
  index().on(t.ownerId),
]);

export const suppliers = pgTable("suppliers", {
  id: text().primaryKey().$defaultFn(() => newId("sup")),
  name: text().notNull(),
  area: text().notNull(),
  verified: boolean().notNull().default(false),
  paypalEmail: text(),
  createdAt: createdAt(),
});

export const siteContacts = pgTable("site_contacts", {
  id: text().primaryKey().$defaultFn(() => newId("ct")),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text().notNull(),
  role: contactRole().notNull(),
  whatsappNumber: text().notNull(), // E.164, e.g. +2547...
  language: language().notNull(),
  paypalEmail: text(), // fundis are paid here for verified milestones
  supplierId: text().references(() => suppliers.id, { onDelete: "set null" }), // a supplier's own contact
  createdAt: createdAt(),
}, (t) => [unique("site_contacts_project_id_whatsapp_number_unique").on(t.projectId, t.whatsappNumber)]);

export const milestones = pgTable("milestones", {
  id: text().primaryKey().$defaultFn(() => newId("ms")),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  name: text().notNull(),
  status: milestoneStatus().notNull().default("planned"),
  plannedStart: date({ mode: "string" }).notNull(),
  plannedEnd: date({ mode: "string" }).notNull(),
  dependsOnId: text().references((): AnyPgColumn => milestones.id, { onDelete: "set null" }),
  // The labour payment this milestone's verification unlocks, and who receives it.
  labourKesCents: cents(),
  labourContactId: text().references(() => siteContacts.id, { onDelete: "set null" }),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [
  unique("milestones_project_id_position_unique").on(t.projectId, t.position),
  check("milestones_dates_ordered", sql`${t.plannedEnd} >= ${t.plannedStart}`),
]);

export const materialPlanLines = pgTable("material_plan_lines", {
  id: text().primaryKey().$defaultFn(() => newId("mpl")),
  milestoneId: text().notNull().references(() => milestones.id, { onDelete: "cascade" }),
  itemKey: text().notNull(),
  description: text().notNull(),
  qty: doublePrecision().notNull(),
  unit: text().notNull(),
}, (t) => [unique("material_plan_lines_milestone_id_item_key_unique").on(t.milestoneId, t.itemKey)]);

export const supplierPrices = pgTable("supplier_prices", {
  id: text().primaryKey().$defaultFn(() => newId("sp")),
  supplierId: text().notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  itemKey: text().notNull(),
  unit: text().notNull(),
  unitPriceKesCents: cents().notNull(),
  observedOn: date({ mode: "string" }).notNull(),
}, (t) => [unique("supplier_prices_supplier_id_item_key_unique").on(t.supplierId, t.itemKey)]);

// The market median for each item, from Juliet's price sheet.
export const priceReferences = pgTable("price_references", {
  id: text().primaryKey().$defaultFn(() => newId("pref")),
  itemKey: text().notNull().unique("price_references_item_key_unique"),
  description: text().notNull(),
  unit: text().notNull(),
  medianKesCents: cents().notNull(),
  source: text().notNull(),
  observedOn: date({ mode: "string" }).notNull(),
});

// One USD/KES rate per day; each payment also keeps the rate it used.
export const fxRates = pgTable("fx_rates", {
  day: date({ mode: "string" }).primaryKey(),
  kesPerUsd: numeric({ precision: 14, scale: 6 }).notNull(),
  source: text().notNull(),
  fetchedAt: createdAt(),
});

// Records (messages first: requests point at the message that started them)

export const messages = pgTable("messages", {
  id: text().primaryKey().$defaultFn(() => newId("msg")),
  projectId: text().references(() => projects.id, { onDelete: "cascade" }),
  contactId: text().references(() => siteContacts.id, { onDelete: "set null" }),
  direction: messageDirection().notNull(),
  channel: messageChannel().notNull(),
  kind: messageKind().notNull(),
  body: text(), // inbound text or translated voice note; outbound rendered template
  mediaPath: text(), // our Blob copy; Twilio media URLs need credentials and expire
  mediaContentType: text(),
  latitude: doublePrecision(),
  longitude: doublePrecision(),
  templateKey: text(),
  language: language(),
  twilioSid: text().unique("messages_twilio_sid_unique"),
  createdAt: createdAt(),
}, (t) => [index().on(t.projectId, t.createdAt)]);

// Requests

export const requests = pgTable("requests", {
  id: text().primaryKey().$defaultFn(() => newId("req")),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  milestoneId: text().references(() => milestones.id, { onDelete: "set null" }),
  contactId: text().references(() => siteContacts.id, { onDelete: "set null" }),
  messageId: text().references(() => messages.id, { onDelete: "set null" }),
  status: requestStatus().notNull().default("received"),
  quoteImagePath: text(),
  quotedSupplierId: text().references(() => suppliers.id, { onDelete: "set null" }),
  quotedSupplierName: text(), // as written on the quote, which may not be a verified supplier
  quotedTotalKesCents: cents(),
  recommendedSupplierId: text().references(() => suppliers.id, { onDelete: "set null" }),
  recommendedTotalKesCents: cents(),
  summary: text(),
  parsed: jsonb(), // validated model output, kept for the eval and the audit trail
  declineReason: text(),
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (t) => [index().on(t.projectId, t.status)]);

export const requestLines = pgTable("request_lines", {
  id: text().primaryKey().$defaultFn(() => newId("rl")),
  requestId: text().notNull().references(() => requests.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  itemKey: text().notNull(),
  description: text().notNull(),
  qty: doublePrecision().notNull(),
  unit: text().notNull(),
  unitPriceKesCents: cents().notNull(),
  referenceUnitPriceKesCents: cents(),
}, (t) => [
  unique("request_lines_request_id_position_unique").on(t.requestId, t.position),
  check("request_lines_qty_positive", sql`${t.qty} > 0`),
  check("request_lines_price_not_negative", sql`${t.unitPriceKesCents} >= 0`),
]);

export const findings = pgTable("findings", {
  id: text().primaryKey().$defaultFn(() => newId("fnd")),
  requestId: text().notNull().references(() => requests.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  type: findingType().notNull(),
  severity: findingSeverity().notNull(),
  message: text().notNull(),
  data: jsonb().$type<Finding["data"]>().notNull(),
  acknowledgedAt: timestamp({ withTimezone: true }), // block findings must be acknowledged before paying
}, (t) => [unique("findings_request_id_position_unique").on(t.requestId, t.position)]);

// Money

export const payments = pgTable("payments", {
  id: text().primaryKey().$defaultFn(() => newId("pay")),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: paymentKind().notNull(),
  requestId: text().references(() => requests.id, { onDelete: "restrict" }),
  milestoneId: text().references(() => milestones.id, { onDelete: "restrict" }),
  payeeSupplierId: text().references(() => suppliers.id, { onDelete: "restrict" }),
  payeeContactId: text().references(() => siteContacts.id, { onDelete: "restrict" }),
  payeeEmail: text().notNull(), // snapshot of the PayPal email the order was created with
  amountKesCents: cents().notNull(),
  amountUsdCents: cents().notNull(),
  kesPerUsd: numeric({ precision: 14, scale: 6 }).notNull(),
  status: paymentStatus().notNull().default("created"),
  paypalRequestId: text().notNull().unique("payments_paypal_request_id_unique"), // PayPal-Request-Id, so a retried capture can't charge twice
  paypalOrderId: text().unique("payments_paypal_order_id_unique"),
  paypalCaptureId: text().unique("payments_paypal_capture_id_unique"),
  createdAt: createdAt(),
  capturedAt: timestamp({ withTimezone: true }),
}, (t) => [
  index().on(t.projectId, t.createdAt),
  check("payments_amounts_positive", sql`${t.amountKesCents} > 0 and ${t.amountUsdCents} > 0`),
  // materials go to a supplier for a request; labour goes to a site contact for a milestone
  check("payments_kind_matches_payee", sql`
    (${t.kind} = 'materials' and ${t.requestId} is not null
      and ${t.payeeSupplierId} is not null and ${t.payeeContactId} is null)
    or (${t.kind} = 'labour' and ${t.milestoneId} is not null
      and ${t.payeeContactId} is not null and ${t.payeeSupplierId} is null)`),
  check("payments_captured_has_capture_id",
    sql`${t.status} <> 'captured' or (${t.paypalCaptureId} is not null and ${t.capturedAt} is not null)`),
]);

// Proof

export const proofRequests = pgTable("proof_requests", {
  id: text().primaryKey().$defaultFn(() => newId("prq")),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  milestoneId: text().notNull().references(() => milestones.id, { onDelete: "cascade" }),
  paymentId: text().references(() => payments.id, { onDelete: "set null" }), // the delivery this proves
  contactId: text().references(() => siteContacts.id, { onDelete: "set null" }), // who was asked
  purpose: proofPurpose().notNull(),
  code: text().notNull(),
  tokenHash: text().notNull().unique("proof_requests_token_hash_unique"), // SHA-256 of the link token; the token itself is never stored
  status: proofRequestStatus().notNull().default("issued"),
  replacesId: text().references((): AnyPgColumn => proofRequests.id, { onDelete: "set null" }),
  issuedAt: createdAt(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
}, (t) => [
  index().on(t.milestoneId, t.status),
  check("proof_requests_expiry_after_issue", sql`${t.expiresAt} > ${t.issuedAt}`),
]);

export const proofs = pgTable("proofs", {
  id: text().primaryKey().$defaultFn(() => newId("prf")),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  proofRequestId: text().unique("proofs_proof_request_id_unique").references(() => proofRequests.id, { onDelete: "cascade" }),
  source: proofSource().notNull(),
  blobPath: text().notNull(),
  contentType: text().notNull(),
  sizeBytes: integer().notNull(),
  dhash: text().notNull(), // 64-bit dHash as 16 hex characters; compared in code by Hamming distance
  captureLat: doublePrecision(),
  captureLng: doublePrecision(),
  accuracyM: doublePrecision(),
  clientTime: timestamp({ withTimezone: true }),
  receivedAt: createdAt(),
}, (t) => [
  index().on(t.projectId, t.receivedAt),
  check("proofs_dhash_hex", sql`${t.dhash} ~ '^[0-9a-f]{16}$'`),
]);

export const verdicts = pgTable("verdicts", {
  id: text().primaryKey().$defaultFn(() => newId("vrd")),
  proofId: text().notNull().unique("verdicts_proof_id_unique").references(() => proofs.id, { onDelete: "cascade" }),
  outcome: verdictOutcome().notNull(),
  checks: jsonb().$type<ProofCheck[]>().notNull(),
  explanation: text().notNull(),
  modelId: text(),
  rawModelOutput: jsonb(), // stored as returned, so any verdict can be re-examined
  createdAt: createdAt(),
  overriddenAt: timestamp({ withTimezone: true }),
  overrideReason: text(),
  overriddenBy: text().references(() => user.id, { onDelete: "set null" }),
}, (t) => [
  check("verdicts_override_has_reason",
    sql`${t.overriddenAt} is null or (${t.overrideReason} is not null and ${t.overriddenBy} is not null)`),
]);

// Records

// The money trail: one row per thing that happened. Rows are only ever inserted.
export const auditEvents = pgTable("audit_events", {
  id: text().primaryKey().$defaultFn(() => newId("aud")),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  at: createdAt(),
  kind: auditKind().notNull(),
  action: text().notNull(), // e.g. request.received, payment.captured, proof.held
  description: text().notNull(),
  actor: text().notNull(), // system, owner:<userId> or contact:<contactId>
  requestId: text().references(() => requests.id, { onDelete: "set null" }),
  paymentId: text().references(() => payments.id, { onDelete: "set null" }),
  proofId: text().references(() => proofs.id, { onDelete: "set null" }),
  milestoneId: text().references(() => milestones.id, { onDelete: "set null" }),
  amountKesCents: cents(),
  amountUsdCents: cents(),
  paypalOrderId: text(),
  paypalCaptureId: text(),
  data: jsonb(),
}, (t) => [index().on(t.projectId, t.at)]);

// Provider event IDs, so a repeated webhook delivery is ignored.
export const webhookEvents = pgTable("webhook_events", {
  id: text().primaryKey().$defaultFn(() => newId("whe")),
  provider: webhookProvider().notNull(),
  eventId: text().notNull(),
  type: text().notNull(),
  payload: jsonb().notNull(),
  receivedAt: createdAt(),
  processedAt: timestamp({ withTimezone: true }),
}, (t) => [unique("webhook_events_provider_event_id_unique").on(t.provider, t.eventId)]);
