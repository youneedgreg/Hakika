export type StatusKey =
  | "received"
  | "parsed"
  | "checked"
  | "awaiting_approval"
  | "approved"
  | "paid"
  | "awaiting_proof"
  | "verified"
  | "held"
  | "declined"
  | "failed"
  | "planned"
  | "in_progress"
  | "needs_fresh_proof"
  | "suspicious";

type Tone = "neutral" | "brand" | "accent" | "info" | "danger";

const statusConfig: Record<StatusKey, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "neutral" },
  parsed: { label: "Parsed", tone: "info" },
  checked: { label: "Checked", tone: "info" },
  awaiting_approval: { label: "Awaiting approval", tone: "accent" },
  approved: { label: "Approved", tone: "info" },
  paid: { label: "Paid", tone: "brand" },
  awaiting_proof: { label: "Awaiting proof", tone: "accent" },
  verified: { label: "Verified", tone: "brand" },
  held: { label: "Held", tone: "danger" },
  declined: { label: "Declined", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  planned: { label: "Planned", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  needs_fresh_proof: { label: "Needs fresh proof", tone: "accent" },
  suspicious: { label: "Suspicious", tone: "danger" },
};

const toneClasses: Record<Tone, string> = {
  neutral: "bg-line/60 text-muted",
  brand: "bg-brand-soft text-brand-strong",
  accent: "bg-accent-soft text-accent-strong",
  info: "bg-info-soft text-info",
  danger: "bg-danger-soft text-danger",
};

export function StatusPill({ status }: { status: StatusKey }) {
  const { label, tone } = statusConfig[status];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}
