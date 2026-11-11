"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useRef, useState } from "react";
import { AsyncView } from "@/components/async-view";
import { apiRequest, postJson } from "@/lib/api-client";
import { useApi } from "@/lib/use-api";
import type { CreateOrderResult, PaymentCaptureResult, PayPalConfig } from "@/shared/api";

type PaymentTarget = { requestId: string } | { milestoneId: string };

// The browser names what is paid for only; the server computes the amount and payee.
export function PayPalPayment({
  target,
  onCaptured,
}: {
  target: PaymentTarget;
  onCaptured: (result: PaymentCaptureResult) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // The server's own reason when it refused to create the order (a held milestone, a missing
  // payee): PayPal then calls onError, which must not replace it with a generic line.
  const serverError = useRef<string | null>(null);
  const { state, reload } = useApi<PayPalConfig>("/api/payments/config");

  return (
    <AsyncView state={state} reload={reload}>
      {(config) => config.clientId ? (
        <div className="space-y-3">
          <PayPalScriptProvider options={{ clientId: config.clientId, currency: "USD", intent: "capture" }}>
            <PayPalButtons
              style={{ layout: "vertical", label: "pay" }}
              createOrder={async () => {
                setError(null);
                serverError.current = null;
                try {
                  const response = await postJson<CreateOrderResult>("/api/payments/orders", target);
                  return response.data.orderId;
                } catch (caught) {
                  serverError.current = caught instanceof Error ? caught.message : null;
                  throw caught;
                }
              }}
              onApprove={async (data) => {
                try {
                  const response = await apiRequest<PaymentCaptureResult>(
                    `/api/payments/orders/${encodeURIComponent(data.orderID)}/capture`,
                    { method: "POST" },
                  );
                  onCaptured(response.data);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "We could not confirm the payment. Check the money trail before trying again.");
                }
              }}
              onCancel={() => setError("Payment cancelled. No payment was captured.")}
              onError={() => setError(serverError.current ?? "PayPal did not finish. Try again.")}
            />
          </PayPalScriptProvider>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">PayPal sandbox is not configured on this deployment yet.</p>
      )}
    </AsyncView>
  );
}
