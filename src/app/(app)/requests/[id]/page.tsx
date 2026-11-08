"use client";

import { use, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AsyncView } from "@/components/async-view";
import { PayPalPayment } from "@/components/paypal-payment";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { ErrorState } from "@/components/ui/states";
import { apiRequest, postJson, toApiClientError } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import type { ApprovalCard, Finding } from "@/shared/types";
import type { CaptureResult, DeclineResult } from "@/shared/api";

const severityTone: Record<Finding["severity"], string> = {
  info: "border-info/30 bg-info-soft text-info",
  warn: "border-accent/40 bg-accent-soft text-accent-strong",
  block: "border-danger/30 bg-danger-soft text-danger",
};

export default function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useApi<ApprovalCard>(`/api/requests/${id}`);
  const searchParams = useSearchParams();
  const paypalStatus = searchParams.get("paypal");
  const returnedOrderId = searchParams.get("token");
  const returnHandled = useRef<string | null>(null);
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (paypalStatus !== "approved" || !returnedOrderId || returnHandled.current === returnedOrderId) return;
    returnHandled.current = returnedOrderId;
    let active = true;
    apiRequest<CaptureResult>(`/api/payments/orders/${encodeURIComponent(returnedOrderId)}/capture`, { method: "POST" }).then(
      ({ data }) => {
        if (!active) return;
        setCapture(data);
        reload();
      },
      (error: unknown) => {
        if (active) setCaptureError(toApiClientError(error).message);
      },
    );
    return () => { active = false; };
  }, [paypalStatus, returnedOrderId, reload]);

  return (
    <AsyncView state={state} reload={reload}>
      {(card) => {
        const status = capture?.status ?? card.status;
        return (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">
                  {card.requestedBy.name}, {card.requestedBy.role}
                </p>
                <h2 className="text-2xl font-semibold">{card.milestone.name}</h2>
              </div>
              <StatusPill status={status} />
            </header>

            {capture?.status === "paid" && (
              <div role="status" className="rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand-strong">
                Payment captured. The money trail will show it shortly.
              </div>
            )}
            {capture?.status === "approved" && (
              <div role="status" className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
                Payment processing. PayPal has approved the order but has not completed the capture yet.
              </div>
            )}
            {paypalStatus === "cancelled" && (
              <div role="status" className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-muted">
                Payment cancelled. No payment was captured.
              </div>
            )}
            {paypalStatus === "approved" && !returnedOrderId && (
              <ErrorState body="PayPal returned without an order reference. Check the money trail before trying again." />
            )}
            {captureError && <ErrorState body={captureError} />}

            <p className="text-sm leading-relaxed">{card.summary}</p>

            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="space-y-6">
                <Card title="Quote lines">
                  <p className="mb-3 text-xs leading-relaxed text-muted">Reference prices are indicative for this demo.</p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-left text-sm">
                      <thead className="text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th scope="col" className="py-2 font-semibold">Item</th>
                          <th scope="col" className="py-2 text-right font-semibold">Qty</th>
                          <th scope="col" className="py-2 text-right font-semibold">Unit price</th>
                          <th scope="col" className="py-2 text-right font-semibold">Usual price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {card.lines.map((line) => (
                          <tr key={line.itemKey}>
                            <td className="py-2 pr-4">{line.description}</td>
                            <td className="py-2 text-right tabular-nums">
                              {line.qty} {line.unit}
                            </td>
                            <td className="py-2 text-right">
                              <Money value={line.unitPrice} />
                            </td>
                            <td className="py-2 text-right text-muted">
                              {line.referenceUnitPrice ? <Money value={line.referenceUnitPrice} /> : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-4 flex justify-end gap-3 text-sm">
                    <span className="text-muted">Quoted total</span>
                    <Money value={card.quotedTotal} className="font-semibold" />
                  </p>
                </Card>

                {card.findings.length > 0 && (
                  <Card title="Checks on this quote">
                    <ul className="space-y-3">
                      {card.findings.map((finding, index) => (
                        <li key={`${finding.type}-${index}`} className={`min-w-0 break-words rounded-xl border p-3 text-sm leading-relaxed ${severityTone[finding.severity]}`}>
                          {finding.message}
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>

              <div className="space-y-6">
                <Card title="Recommended supplier">
                  {card.recommended ? (
                    <dl className="space-y-2 text-sm">
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Supplier</dt>
                        <dd className="font-semibold">{card.recommended.supplierName}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Total</dt>
                        <dd>
                          <Money value={card.recommended.total} />
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Paid in USD</dt>
                        <dd className="font-semibold">
                          <Money value={card.recommended.totalUsd} />
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Rate used</dt>
                        <dd className="tabular-nums">1 USD = {card.recommended.fxRate} KES</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="text-sm text-muted">No supplier has been recommended for this quote.</p>
                  )}
                </Card>

                {status === "awaiting_approval" && card.recommended && !capture && (
                  <Card title="Approve payment">
                    <p className="mb-4 text-sm text-muted">
                      You will be asked to approve <Money value={card.recommended.totalUsd} /> in PayPal.
                    </p>
                    <PayPalPayment target={{ requestId: card.requestId }} onCaptured={(result) => {
                      if ("requestId" in result) setCapture(result);
                      reload();
                    }} />
                    <DeclineForm requestId={card.requestId} onDeclined={reload} />
                  </Card>
                )}
              </div>
            </div>
          </div>
        );
      }}
    </AsyncView>
  );
}

function DeclineForm({ requestId, onDeclined }: { requestId: string; onDeclined: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="mt-6 border-t border-line pt-4">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Decline this request
        </Button>
      </div>
    );
  }

  return (
    <form
      className="mt-6 space-y-3 border-t border-line pt-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          await postJson<DeclineResult>(`/api/requests/${requestId}/decline`, { reason: reason.trim() });
          onDeclined();
        } catch {
          setError("The request could not be declined. Try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor="decline-reason" className="block text-sm font-semibold">
        Why are you declining?
      </label>
      <textarea
        id="decline-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        minLength={3}
        maxLength={500}
        rows={3}
        required
        className="w-full rounded-xl border border-line bg-surface p-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-brand"
      />
      {error && <ErrorState body={error} />}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending || reason.trim().length < 3}>
          {pending ? "Declining…" : "Confirm decline"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
