// Shared types: the contract between the API (Greg) and the UI (Juliet).
// These are the types from the roadmap, unchanged. Changing one needs Juliet told first.

export type Money = { amount: string; currency: "USD" | "KES" }; // decimal string

export type RequestStatus =
  | "received" | "parsed" | "checked" | "awaiting_approval"
  | "approved" | "paid" | "awaiting_proof" | "verified"
  | "held" | "declined" | "failed";

export type MilestoneStatus =
  | "planned" | "in_progress" | "awaiting_proof"
  | "verified" | "held" | "paid";

export type Finding = {
  type: "price_above_market" | "qty_above_plan" | "unverified_supplier"
      | "cheaper_verified_supplier" | "missing_info";
  severity: "info" | "warn" | "block";
  message: string;               // one sentence, shown as written
  data: Record<string, unknown>; // the numbers behind the message
};

export type QuoteLine = {
  itemKey: string; description: string;
  qty: number; unit: string; unitPrice: Money;
  referenceUnitPrice?: Money;
};

export type ApprovalCard = {
  requestId: string; status: RequestStatus;
  milestone: { id: string; name: string };
  requestedBy: { name: string; role: string };
  lines: QuoteLine[]; quotedTotal: Money;
  recommended: null | {
    supplierId: string; supplierName: string;
    total: Money; totalUsd: Money; fxRate: number;
  };
  findings: Finding[]; summary: string;
};

export type ProofCheck = {
  name: "code" | "freshness" | "duplicate" | "location"
      | "screen_or_print" | "expected_items" | "consistency";
  result: "pass" | "fail" | "unknown";
  hard: boolean; detail: string;
  evidence?: { matchImageUrl?: string; distanceM?: number; hamming?: number };
};

export type ProofReview = {
  proofId: string; imageUrl: string; receivedAt: string;
  capture?: { lat: number; lng: number; accuracyM: number };
  site: { lat: number; lng: number; radiusM: number };
  checks: ProofCheck[];
  outcome: "verified" | "needs_fresh_proof" | "suspicious";
  explanation: string;
};

export type GanttTask = {
  id: string; name: string; startDate: string; endDate: string;
  percentDone: number; status: MilestoneStatus;
  kind: "work" | "payment_gate";
};
export type GanttDependency = { id: string; fromTask: string; toTask: string };
