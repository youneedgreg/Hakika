"use client";

import Link from "next/link";
import { use } from "react";
import { AsyncView } from "@/components/async-view";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { LedgerResult, LedgerRow } from "@/shared/api";

const kindLabel: Record<LedgerRow["kind"], string> = {
  request: "Request",
  payment: "Payment",
  proof: "Proof",
  verdict: "Verdict",
  override: "Override",
  milestone: "Milestone",
};

export default function MoneyTrailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useApi<LedgerResult>(`/api/ledger?projectId=${encodeURIComponent(id)}`);

  return (
    <AsyncView state={state} reload={reload}>
      {(ledger) => (
        <Card
          title="Money trail"
          action={
            <a
              href={`/api/ledger?projectId=${encodeURIComponent(id)}&format=csv`}
              download
              className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper"
            >
              Download CSV
            </a>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Every request, payment, proof, override and milestone event for this project, in time order</caption>
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-semibold">When</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Event</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Description</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">Amount</th>
                  <th scope="col" className="py-2 pr-4 text-right font-semibold">USD</th>
                  <th scope="col" className="py-2 font-semibold">PayPal reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ledger.rows.map((row) => {
                  const href = row.link.requestId
                    ? `/requests/${row.link.requestId}`
                    : row.link.proofId
                      ? `/proofs/${row.link.proofId}`
                      : row.link.milestoneId
                        ? `/projects/${id}/gantt?milestone=${encodeURIComponent(row.link.milestoneId)}`
                        : null;
                  return (
                    <tr key={`${row.at}-${row.kind}-${row.description}`} className="align-top">
                      <td className="py-3 pr-4 whitespace-nowrap text-muted">{formatDateTime(row.at)}</td>
                      <td className="py-3 pr-4">{kindLabel[row.kind]}</td>
                      <td className="py-3 pr-4">
                        {href ? (
                          <Link href={href} className="text-brand underline-offset-2 hover:underline">
                            {row.description}
                          </Link>
                        ) : (
                          row.description
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right">{row.amount ? <Money value={row.amount} /> : "—"}</td>
                      <td className="py-3 pr-4 text-right">{row.amountUsd ? <Money value={row.amountUsd} /> : "—"}</td>
                      <td className="py-3 font-mono text-xs text-muted">
                        {row.paypalOrderId && <div>Order {row.paypalOrderId}</div>}
                        {row.paypalCaptureId && <div>Capture {row.paypalCaptureId}</div>}
                        {!row.paypalOrderId && !row.paypalCaptureId && "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AsyncView>
  );
}
