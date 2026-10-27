// Every status and kind the database stores, as Postgres enums.
// The ones that also appear in src/shared/types.ts are checked against it at compile time,
// so the database and the contract with the UI can't drift apart.

import { pgEnum } from "drizzle-orm/pg-core";
import type { Finding, MilestoneStatus, ProofReview, RequestStatus } from "@/shared/types";
import type { ProjectDetails } from "@/shared/api";

export const REQUEST_STATUSES = [
  "received", "parsed", "checked", "awaiting_approval",
  "approved", "paid", "awaiting_proof", "verified",
  "held", "declined", "failed",
] as const;

export const MILESTONE_STATUSES = [
  "planned", "in_progress", "awaiting_proof", "verified", "held", "paid",
] as const;

export const FINDING_TYPES = [
  "price_above_market", "qty_above_plan", "unverified_supplier",
  "cheaper_verified_supplier", "missing_info",
] as const;

export const FINDING_SEVERITIES = ["info", "warn", "block"] as const;

export const VERDICT_OUTCOMES = ["verified", "needs_fresh_proof", "suspicious"] as const;

export const CONTACT_ROLES = ["foreman", "fundi", "supplier"] as const;

export const LANGUAGES = ["en", "sw"] as const;

// materials: paid to a supplier for a request. labour: paid to a fundi for a verified milestone.
export const PAYMENT_KINDS = ["materials", "labour"] as const;

// created: PayPal order exists. captured: money moved (the capture response says so).
// denied / refunded: from capture responses or webhooks. failed: the order could not be created or captured.
export const PAYMENT_STATUSES = ["created", "captured", "denied", "refunded", "failed"] as const;

export const PROOF_PURPOSES = ["delivery", "progress"] as const;

// used: a photo came in on the link. superseded: a fresh proof request replaced this one.
export const PROOF_REQUEST_STATUSES = ["issued", "used", "expired", "superseded"] as const;

export const PROOF_SOURCES = ["capture_page", "whatsapp"] as const;

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;

// simulator: Judge Mode, which feeds the same pipeline as Twilio.
export const MESSAGE_CHANNELS = ["whatsapp", "simulator"] as const;

export const MESSAGE_KINDS = ["text", "image", "voice", "location", "template"] as const;

// The ledger's row kinds, plus milestone changes, which the money trail also records.
export const AUDIT_KINDS = ["request", "payment", "proof", "verdict", "override", "milestone"] as const;

export const WEBHOOK_PROVIDERS = ["paypal", "twilio"] as const;

// Compile-time checks: each array holds exactly the values of the shared type.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Values<T extends readonly unknown[]> = T[number];
const contractChecks: [
  Same<Values<typeof REQUEST_STATUSES>, RequestStatus>,
  Same<Values<typeof MILESTONE_STATUSES>, MilestoneStatus>,
  Same<Values<typeof FINDING_TYPES>, Finding["type"]>,
  Same<Values<typeof FINDING_SEVERITIES>, Finding["severity"]>,
  Same<Values<typeof VERDICT_OUTCOMES>, ProofReview["outcome"]>,
  Same<Values<typeof CONTACT_ROLES>, ProjectDetails["contacts"][number]["role"]>,
  Same<Values<typeof LANGUAGES>, ProjectDetails["contacts"][number]["language"]>,
] = [true, true, true, true, true, true, true];
void contractChecks;

export const requestStatus = pgEnum("request_status", REQUEST_STATUSES);
export const milestoneStatus = pgEnum("milestone_status", MILESTONE_STATUSES);
export const findingType = pgEnum("finding_type", FINDING_TYPES);
export const findingSeverity = pgEnum("finding_severity", FINDING_SEVERITIES);
export const verdictOutcome = pgEnum("verdict_outcome", VERDICT_OUTCOMES);
export const contactRole = pgEnum("contact_role", CONTACT_ROLES);
export const language = pgEnum("language", LANGUAGES);
export const paymentKind = pgEnum("payment_kind", PAYMENT_KINDS);
export const paymentStatus = pgEnum("payment_status", PAYMENT_STATUSES);
export const proofPurpose = pgEnum("proof_purpose", PROOF_PURPOSES);
export const proofRequestStatus = pgEnum("proof_request_status", PROOF_REQUEST_STATUSES);
export const proofSource = pgEnum("proof_source", PROOF_SOURCES);
export const messageDirection = pgEnum("message_direction", MESSAGE_DIRECTIONS);
export const messageChannel = pgEnum("message_channel", MESSAGE_CHANNELS);
export const messageKind = pgEnum("message_kind", MESSAGE_KINDS);
export const auditKind = pgEnum("audit_kind", AUDIT_KINDS);
export const webhookProvider = pgEnum("webhook_provider", WEBHOOK_PROVIDERS);
