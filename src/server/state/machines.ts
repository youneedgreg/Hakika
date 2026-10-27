// The four state machines: requests, milestones, payments and proof requests.
// States are the database enums; events are named for what happened, not for the new state.

import type {
  MILESTONE_STATUSES, PAYMENT_STATUSES, PROOF_REQUEST_STATUSES, REQUEST_STATUSES,
} from "../db/enums";
import { defineMachine } from "./machine";

type RequestState = (typeof REQUEST_STATUSES)[number];
type MilestoneState = (typeof MILESTONE_STATUSES)[number];
type PaymentState = (typeof PAYMENT_STATUSES)[number];
type ProofRequestState = (typeof PROOF_REQUEST_STATUSES)[number];

// A proof's verdict, as the verification engine's outcome rule produces it.
type VerdictEvent = "proof_verified" | "proof_needs_fresh" | "proof_suspicious";

// Request: WhatsApp message → parsed → price-checked → owner decides → paid → proof → verified or held.
export type RequestEvent =
  | "parsed" | "parse_failed" | "checked" | "sent_for_approval"
  | "owner_approved" | "owner_declined" | "captured" | "capture_failed"
  | "proof_requested" | VerdictEvent | "owner_overrode";

export const requestMachine = defineMachine<RequestState, RequestEvent>("request", {
  received: { parsed: "parsed", parse_failed: "failed" },
  parsed: { checked: "checked" },
  checked: { sent_for_approval: "awaiting_approval" },
  awaiting_approval: { owner_approved: "approved", owner_declined: "declined" },
  // The owner approved in PayPal; the server is capturing. A failed capture goes back for another try.
  approved: { captured: "paid", capture_failed: "awaiting_approval" },
  paid: { proof_requested: "awaiting_proof" },
  awaiting_proof: {
    proof_verified: "verified", proof_needs_fresh: "awaiting_proof", proof_suspicious: "held",
  },
  held: {
    proof_verified: "verified", proof_needs_fresh: "held", proof_suspicious: "held", owner_overrode: "verified",
  },
  verified: {},
  declined: {},
  failed: {},
});

// Milestone: its labour payment unlocks only from "verified".
export type MilestoneEvent = "started" | "proof_requested" | VerdictEvent | "owner_overrode" | "labour_paid";

export const milestoneMachine = defineMachine<MilestoneState, MilestoneEvent>("milestone", {
  planned: { started: "in_progress" },
  in_progress: { proof_requested: "awaiting_proof" },
  awaiting_proof: {
    proof_verified: "verified", proof_needs_fresh: "awaiting_proof", proof_suspicious: "held",
  },
  held: {
    proof_verified: "verified", proof_needs_fresh: "held", proof_suspicious: "held", owner_overrode: "verified",
  },
  verified: { labour_paid: "paid" },
  paid: {},
});

// Payment: the capture response is the source of truth; webhooks confirm it later. A repeated
// event (a webhook after the capture response) is accepted and changes nothing.
export type PaymentEvent = "captured" | "denied" | "failed" | "refunded";

export const paymentMachine = defineMachine<PaymentState, PaymentEvent>("payment", {
  created: { captured: "captured", denied: "denied", failed: "failed" },
  captured: { captured: "captured", refunded: "refunded" },
  denied: { denied: "denied" },
  failed: {},
  refunded: { refunded: "refunded" },
});

// Proof request: single use, 30-minute expiry, replaced when fresh proof is needed.
export type ProofRequestEvent = "proof_received" | "expired" | "superseded";

export const proofRequestMachine = defineMachine<ProofRequestState, ProofRequestEvent>("proof_request", {
  issued: { proof_received: "used", expired: "expired", superseded: "superseded" },
  used: {},
  expired: {},
  superseded: {},
});
