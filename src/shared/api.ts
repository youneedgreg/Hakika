// Request and response shapes for the API routes that the roadmap's shared types don't cover.
// PROPOSED in the bootstrap PR: Juliet reviews these before either of us builds on them.

import type {
  ApprovalCard, GanttDependency, GanttTask, MilestoneStatus, Money, ProofReview, RequestStatus,
} from "./types";

export type ApiError = { error: { code: string; message: string } };

// GET /api/projects/[id]
export type ProjectDetails = {
  id: string;
  name: string;
  owner: { name: string; location: string };
  site: { label: string; lat: number; lng: number; radiusM: number };
  budget: Money;
  milestones: {
    id: string; name: string; status: MilestoneStatus;
    plannedStart: string; plannedEnd: string;
    plannedMaterials: { itemKey: string; description: string; qty: number; unit: string }[];
  }[];
  contacts: { id: string; name: string; role: "foreman" | "fundi" | "supplier"; language: "en" | "sw" }[];
  suppliers: { id: string; name: string; area: string; verified: boolean }[];
};

// GET /api/projects/[id]/overview
export type ProjectOverview = {
  project: { id: string; name: string; ownerName: string; siteLabel: string };
  currentMilestone: { id: string; name: string; status: MilestoneStatus };
  approvals: { requestId: string; title: string; status: RequestStatus; total: Money; createdAt: string }[];
  alerts: {
    id: string; kind: "payment_held" | "price_warning" | "proof_overdue";
    severity: "info" | "warn" | "block"; message: string;
    link: { proofId?: string; requestId?: string };
  }[];
  ledger: { spent: Money; spentUsd: Money; budget: Money; paymentsCount: number };
};

// GET /api/projects/[id]/gantt
export type GanttData = { tasks: GanttTask[]; dependencies: GanttDependency[] };

// GET /api/requests/[id]
export type { ApprovalCard };

// POST /api/requests/[id]/decline
export type DeclineBody = { reason: string };
export type DeclineResult = { requestId: string; status: "declined" };

// POST /api/payments/orders — the server computes the amount; the browser only names the request.
export type CreateOrderBody = { requestId: string };
export type CreateOrderResult = { orderId: string };

// POST /api/payments/orders/[orderId]/capture
export type CaptureResult = { requestId: string; status: RequestStatus; captureId: string };

// GET /api/proof/[token]
export type ProofCapture = {
  code: string;
  purpose: "delivery" | "progress";
  milestoneName: string;
  instructions: { en: string; sw: string };
  expiresAt: string;
};

// POST /api/proof/[token] (multipart: image, latitude, longitude, accuracy, clientTime)
export type ProofUploadResult = { proofId: string; status: "received" };

// GET /api/proofs/[id]
export type { ProofReview };

// POST /api/proofs/[id]/override
export type OverrideBody = { reason: string };
export type OverrideResult = { proofId: string; overridden: true; reason: string; at: string };

// POST /api/agent/chat — JSON for now; will become a streamed response (format to agree with Juliet).
export type ChatBody = { projectId: string; question: string };
export type ChatResult = { answer: string; citations: { label: string; href: string }[] };

// GET /api/ledger?projectId=…&format=csv
export type LedgerRow = {
  at: string;
  kind: "request" | "payment" | "proof" | "verdict" | "override";
  description: string;
  amount?: Money;
  amountUsd?: Money;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  link: { requestId?: string; proofId?: string };
};
export type LedgerResult = { rows: LedgerRow[] };

// POST /api/judge/simulate
export type SimulateBody = {
  projectId: string;
  from: "peter" | "otieno" | "grace";
  kind: "text" | "image" | "voice" | "location";
  text?: string;
  mediaUrl?: string;
  location?: { lat: number; lng: number };
};
export type SimulateResult = { messageId: string; accepted: true };

// POST /api/judge/reset
export type ResetBody = { projectId: string };
export type ResetResult = { projectId: string; reset: true };
