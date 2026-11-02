"use client";

import Link from "next/link";
import { use } from "react";
import { AskPanel } from "@/components/ask-panel";
import { AsyncView } from "@/components/async-view";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { ProjectOverview } from "@/shared/api";

const alertTone = {
  info: "border-info/30 bg-info-soft",
  warn: "border-accent/40 bg-accent-soft",
  block: "border-danger/30 bg-danger-soft",
} as const;

export default function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useApi<ProjectOverview>(`/api/projects/${id}/overview`);

  return (
    <AsyncView state={state} reload={reload}>
      {(overview) => (
        <div className="space-y-6">
          <header>
            <p className="text-sm text-muted">{overview.project.siteLabel}</p>
            <h2 className="text-2xl font-semibold">{overview.project.name}</h2>
            <p className="text-sm text-muted">Owner: {overview.project.ownerName}</p>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card title="Current milestone">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">{overview.currentMilestone.name}</p>
                <StatusPill status={overview.currentMilestone.status} />
              </div>
            </Card>
            <Card title="Spent">
              <Money value={overview.ledger.spent} className="text-2xl font-semibold" />
              <p className="mt-1 text-sm text-muted">
                <Money value={overview.ledger.spentUsd} /> at today&apos;s rate
              </p>
            </Card>
            <Card title="Budget">
              <Money value={overview.ledger.budget} className="text-2xl font-semibold" />
            </Card>
            <Card title="Payments made">
              <p className="text-2xl font-semibold tabular-nums">{overview.ledger.paymentsCount}</p>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-6">
              <Card title="Approvals">
                {overview.approvals.length === 0 ? (
                  <EmptyState title="No approvals yet" body="Requests from the site appear here." />
                ) : (
                  <ul className="divide-y divide-line">
                    {overview.approvals.map((approval) => (
                      <li key={approval.requestId} className="flex items-center justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <Link
                            href={`/requests/${approval.requestId}`}
                            className="font-semibold text-brand underline-offset-2 hover:underline"
                          >
                            {approval.title}
                          </Link>
                          <p className="text-xs text-muted">{formatDate(approval.createdAt)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <Money value={approval.total} className="text-sm font-semibold" />
                          <StatusPill status={approval.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <AskPanel projectId={overview.project.id} />
            </div>

            <Card title="Alerts">
              {overview.alerts.length === 0 ? (
                <EmptyState title="No alerts" body="Nothing needs attention right now." />
              ) : (
                <ul className="space-y-3">
                  {overview.alerts.map((alert) => {
                    const href = alert.link.proofId
                      ? `/proofs/${alert.link.proofId}`
                      : alert.link.requestId
                        ? `/requests/${alert.link.requestId}`
                        : null;
                    return (
                      <li key={alert.id} className={`rounded-xl border p-3 ${alertTone[alert.severity]}`}>
                        <p className="text-sm">{alert.message}</p>
                        {href && (
                          <Link href={href} className="mt-2 inline-block text-sm font-semibold text-brand underline-offset-2 hover:underline">
                            Open
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </AsyncView>
  );
}
