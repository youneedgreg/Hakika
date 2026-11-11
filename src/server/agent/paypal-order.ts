// PayPal order lookups for Ask Hakika, through PayPal's Agent Toolkit. Read-only by construction:
//
// - The toolkit is configured with only `orders.get`, but its handleToolCall runs any method name it
//   is given (pay_order included), so the method is hard-coded here as get_order. The model never
//   supplies a method name, only an order ID.
// - The tool that calls this first checks the order ID belongs to one of the project's own payments.
// - Sandbox only: with PAYPAL_ENV anything but "sandbox", no lookup is made.
// - What comes back is cut down to status, amounts, captures and times: no payer or payee details.

import type { PayPalAgentToolkit } from "@paypal/agent-toolkit/bedrock";

// The raw order JSON PayPal returned, or an error.
export type OrderLookup = (orderId: string) => Promise<unknown>;

export const PAYPAL_ORDER_ID = /^[A-Z0-9]{17,32}$/; // the toolkit's own check for an order ID

export function toolkitOrderLookup(): OrderLookup {
  let toolkit: Promise<PayPalAgentToolkit> | null = null;
  return async (orderId) => {
    const { PAYPAL_ENV, PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = process.env;
    if (PAYPAL_ENV !== "sandbox" || !clientId || !clientSecret) throw new Error("PayPal sandbox is not configured.");
    if (!PAYPAL_ORDER_ID.test(orderId)) throw new Error("Not a PayPal order ID.");
    // Loaded on first use: the toolkit is large, and most questions never need it.
    toolkit ??= import("@paypal/agent-toolkit/bedrock").then(({ PayPalAgentToolkit: Toolkit }) => new Toolkit({
      clientId,
      clientSecret,
      configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
    })).catch((error: unknown) => {
      toolkit = null; // try loading again next time
      throw error;
    });
    const result = await (await toolkit).handleToolCall({ toolUseId: "ask-hakika", name: "get_order", input: { id: orderId } });
    const text = result.content[0]?.text;
    if (!text) throw new Error("PayPal returned nothing for this order.");
    return JSON.parse(text) as unknown;
  };
}

type Amount = { currency_code?: string; value?: string };
type RawOrder = {
  id?: string;
  status?: string;
  create_time?: string;
  update_time?: string;
  purchase_units?: {
    amount?: Amount;
    payments?: { captures?: { id?: string; status?: string; amount?: Amount; create_time?: string }[] };
  }[];
};

const money = (amount: Amount | undefined) =>
  amount?.currency_code && amount.value ? `${amount.currency_code} ${amount.value}` : null;

// What PayPal says about the order, without anyone's name, email or address.
export function orderSummary(raw: unknown) {
  const order = (raw ?? {}) as RawOrder;
  const unit = order.purchase_units?.[0];
  return {
    status: order.status ?? null,
    amount: money(unit?.amount),
    createdAt: order.create_time ?? null,
    updatedAt: order.update_time ?? null,
    captures: (unit?.payments?.captures ?? []).map((capture) => ({
      id: capture.id ?? null,
      status: capture.status ?? null,
      amount: money(capture.amount),
      at: capture.create_time ?? null,
    })),
  };
}
