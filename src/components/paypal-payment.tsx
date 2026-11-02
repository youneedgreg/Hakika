"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useState } from "react";
import { apiRequest, postJson } from "@/lib/api-client";
import type { CaptureResult, CreateOrderResult } from "@/shared/api";

const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

// The browser names the request only. The server computes the amount and PayPal enforces it.
export function PayPalPayment({
  requestId,
  onPaid,
}: {
  requestId: string;
  onPaid: (result: CaptureResult) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  if (!clientId) {
    return <p className="text-sm text-muted">PayPal sandbox is not configured on this deployment yet.</p>;
  }

  return (
    <div className="space-y-3">
      <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture" }}>
        <PayPalButtons
          style={{ layout: "vertical", label: "pay" }}
          createOrder={async () => {
            setError(null);
            const response = await postJson<CreateOrderResult>("/api/payments/orders", { requestId });
            return response.data.orderId;
          }}
          onApprove={async (data) => {
            try {
              const response = await apiRequest<CaptureResult>(
                `/api/payments/orders/${encodeURIComponent(data.orderID)}/capture`,
                { method: "POST" },
              );
              onPaid(response.data);
            } catch {
              setError("We could not confirm the payment. Check the money trail before trying again.");
            }
          }}
          onError={() => setError("PayPal did not finish. Try again.")}
        />
      </PayPalScriptProvider>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
