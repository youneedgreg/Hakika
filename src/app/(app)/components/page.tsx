import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill, type StatusKey } from "@/components/ui/status-pill";
import { Money } from "@/components/ui/money";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { CheckList, type CheckItem } from "@/components/ui/check-list";
import { PhotoCompare } from "@/components/ui/photo-compare";
import { TimelineItem } from "@/components/ui/timeline-item";

// Placeholder images stand in for proof photos until real Vercel Blob URLs exist.
const placeholder = (label: string, hue: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue} 45% 80%)"/><text x="200" y="158" text-anchor="middle" font-family="sans-serif" font-size="22" fill="hsl(${hue} 40% 25%)">${label}</text></svg>`,
  )}`;

const statuses: StatusKey[] = [
  "received",
  "parsed",
  "checked",
  "awaiting_approval",
  "approved",
  "paid",
  "awaiting_proof",
  "verified",
  "held",
  "declined",
  "failed",
  "planned",
  "in_progress",
  "needs_fresh_proof",
  "suspicious",
];

const checks: CheckItem[] = [
  { name: "gps", label: "Location matches site", result: "pass", hard: true, detail: "Within 50 m of the approved site." },
  { name: "timestamp", label: "Photo taken today", result: "fail", hard: true, detail: "Metadata shows a photo from 3 days ago." },
  { name: "similarity", label: "Matches earlier photo", result: "unknown", hard: false, detail: "Not enough reference photos yet." },
];

const milestones = [
  { name: "Foundation poured", startDate: "2025-10-06", endDate: "2025-10-10", status: "verified" as const, percentDone: 100 },
  { name: "Walls up", startDate: "2025-10-13", endDate: "2025-10-20", status: "in_progress" as const, percentDone: 40 },
  { name: "Materials payment", startDate: "2025-10-20", endDate: "2025-10-20", status: "awaiting_proof" as const, kind: "payment_gate" as const },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

export default function ComponentGallery() {
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold">Component gallery</h1>
        <p className="text-sm text-muted">Every shared UI piece rendered with sample data.</p>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Approve payment</Button>
          <Button variant="secondary">Review</Button>
          <Button variant="danger">Hold payment</Button>
          <Button variant="ghost">View details</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Status pills">
        <div className="flex flex-wrap gap-2">
          {statuses.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title="Money">
        <Card>
          <div className="flex flex-wrap gap-8 text-2xl font-bold">
            <Money value={{ amount: "1234.5", currency: "KES" }} />
            <Money value={{ amount: "850", currency: "USD" }} />
          </div>
        </Card>
      </Section>

      <Section title="Cards">
        <Card title="Materials order" action={<StatusPill status="awaiting_approval" />}>
          <p className="text-sm text-muted">Cement and rebar for the walls milestone.</p>
        </Card>
      </Section>

      <Section title="Checks">
        <Card title="Proof checks">
          <CheckList items={checks} />
        </Card>
        <Card title="No checks yet">
          <CheckList items={[]} />
        </Card>
      </Section>

      <Section title="Proof comparison">
        <PhotoCompare
          left={{ src: placeholder("Before", 200), label: "Before", caption: "Mar 2" }}
          right={{ src: placeholder("After", 140), label: "After", caption: "Today" }}
        />
      </Section>

      <Section title="Timeline">
        <Card>
          <ul className="divide-y divide-line">
            {milestones.map((milestone) => (
              <TimelineItem key={milestone.name} {...milestone} />
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Empty and error states">
        <EmptyState
          title="No proofs yet"
          body="Proof photos appear here once the crew submits them."
          action={<Button variant="secondary">Send reminder</Button>}
        />
        <ErrorState body="We couldn't load this order. Check your connection and try again." action={<Button variant="secondary">Retry</Button>} />
      </Section>
    </div>
  );
}
