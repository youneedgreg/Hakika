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
    id: string; kind: "payment_held" | "price_warning" | "proof_overdue" | "quote_problem";
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

// POST /api/payments/orders — the server computes the amount; the browser only names what is paid
// for: a request (materials, to the supplier) or a verified milestone (labour, to the fundi).
export type CreateOrderBody = { requestId: string } | { milestoneId: string };
export type CreateOrderResult = { orderId: string };

// POST /api/payments/orders/[orderId]/capture — CaptureResult for a request's order,
// LabourCaptureResult for a milestone's (tell them apart by requestId or milestoneId).
export type CaptureResult = { requestId: string; status: RequestStatus; captureId: string };
export type LabourCaptureResult = { milestoneId: string; status: MilestoneStatus; captureId: string };

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

// POST /api/judge/reset — 429 `reset_too_soon` within RESET_COOLDOWN_S of the last reset, because
// every judge shares the one demo project.
export type ResetBody = { projectId: string };
export type ResetResult = { projectId: string; reset: true };

// POST /api/judge/scenarios/[id] — runs one scenario on the server and answers when it has finished.
// Each scenario first puts in place what it needs (listed in `setup`), so they run in any order.
export type ScenarioId = "inflated-quote" | "valid-delivery" | "recycled-photo";
export type RunScenarioBody = { projectId: string };

// Where a model's answer came from. Judge Mode never calls a model: "recorded" is Nova's answer from
// one real run on the same test file, replayed; "none" means no recording fitted, so the pipeline
// went on without it (the code-written summary, or vision checks left unknown). Show this on screen.
export type ModelOutputNote = {
  task: "quote_reading" | "owner_summary" | "proof_inspection";
  source: "recorded" | "none";
  modelId: string | null;
  recordedAt: string | null;
  detail: string; // one sentence, shown as written
};

export type ScenarioResult = {
  scenarioId: ScenarioId;
  title: string;
  outcome: string; // one or two sentences on what happened, shown as written
  setup: string[]; // what was put in place before the messages were sent, shown as written
  models: ModelOutputNote[];
  links: { label: string; href: string }[]; // the records to open next
  requestId?: string;
  proofId?: string;
  milestoneId?: string;
  verdict?: ProofReview["outcome"];
  messageIds: string[]; // the simulated messages sent, in order
};

// GET /api/judge/chat?projectId=…&after=<ISO time> — the simulator's conversation, oldest first:
// what each site contact "sent" and what Hakika answered (never sent to a phone).
export type JudgeChatMessage = {
  id: string;
  at: string;
  direction: "inbound" | "outbound";
  contact: { id: string; name: string; role: "foreman" | "fundi" | "supplier" } | null;
  kind: "text" | "image" | "voice" | "location" | "template";
  text: string | null;
  imageUrl?: string; // /api/judge/messages/[id]/image
  location?: { lat: number; lng: number };
  templateKey?: string;
};
export type JudgeChatResult = { projectId: string; messages: JudgeChatMessage[] };
