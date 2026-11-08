"use client";

import { use, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AsyncView } from "@/components/async-view";
import { PayPalPayment } from "@/components/paypal-payment";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { apiRequest, toApiClientError } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import type { GanttData, PaymentCaptureResult } from "@/shared/api";
import { GanttChart } from "./gantt-chart";
import { statusLabel } from "./gantt-data";

const legend = Object.entries(statusLabel);

export default function GanttPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useApi<GanttData>(`/api/projects/${id}/gantt`);
  const searchParams = useSearchParams();
  const paypalStatus = searchParams.get("paypal");
  const milestoneId = searchParams.get("milestone");
  const returnedOrderId = searchParams.get("token");
  const returnHandled = useRef<string | null>(null);
  const [capture, setCapture] = useState<PaymentCaptureResult | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  useEffect(() => {
    if (paypalStatus !== "approved" || !milestoneId || !returnedOrderId || returnHandled.current === returnedOrderId) return;
    returnHandled.current = returnedOrderId;
    let active = true;
    apiRequest<PaymentCaptureResult>(`/api/payments/orders/${encodeURIComponent(returnedOrderId)}/capture`, { method: "POST" }).then(
      ({ data }) => {
        if (!active) return;
        if (!("milestoneId" in data) || data.milestoneId !== milestoneId) {
          setCaptureError("This PayPal order does not belong to the selected milestone.");
          return;
        }
        setCapture(data);
        reload();
      },
      (error: unknown) => {
        if (active) setCaptureError(toApiClientError(error).message);
      },
    );
    return () => { active = false; };
  }, [paypalStatus, milestoneId, returnedOrderId, reload]);

  return (
    <AsyncView state={state} reload={reload}>
      {(data) => (
        <div className="space-y-6">
          {paypalStatus === "cancelled" && (
            <p role="status" className="rounded-xl border border-line bg-paper px-4 py-3 text-sm text-muted">
              Payment cancelled. No payment was captured.
            </p>
          )}
          {paypalStatus === "approved" && (!milestoneId || !returnedOrderId) && (
            <ErrorState body="PayPal returned without a milestone or order reference. Check the money trail before trying again." />
          )}
          {captureError && <ErrorState body={captureError} />}
          {capture && "milestoneId" in capture && (
            <p role="status" className="rounded-xl border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
              {capture.status === "paid"
                ? "Labour payment captured. The timeline will refresh shortly."
                : "Payment processing. PayPal has not completed the capture yet."}
            </p>
          )}
          <Card title="Milestones and payment gates">
            <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Colour key">
              {legend.map(([status, label]) => (
                <li key={status}>{label}</li>
              ))}
            </ul>
            <GanttChart data={data} />
          </Card>
          <Card title="Labour payments">
            {data.tasks.some((task) => task.kind === "work" && task.status === "verified") ? (
              <ul className="divide-y divide-line">
                {data.tasks.filter((task) => task.kind === "work" && task.status === "verified").map((task) => {
                  const processing = capture && "milestoneId" in capture
                    && capture.milestoneId === task.id && capture.status !== "paid";
                  return (
                    <li key={task.id} className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div>
                        <p className="font-semibold">{task.name}</p>
                        <p className="text-sm text-muted">Verified, ready for the owner&apos;s PayPal approval</p>
                      </div>
                      {processing
                        ? <span className="text-sm text-info">Payment processing</span>
                        : <PayPalPayment
                            target={{ milestoneId: task.id }}
                            onCaptured={(result) => {
                              if ("milestoneId" in result) setCapture(result);
                              reload();
                            }}
                          />}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="No labour payment ready" body="A verified milestone will appear here for PayPal approval." />
            )}
          </Card>
        </div>
      )}
    </AsyncView>
  );
}
