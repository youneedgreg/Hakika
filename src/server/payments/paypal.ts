// PayPal Orders v2, sandbox only. The server creates each order with the supplier as payee and
// captures it after the owner approves in PayPal; nothing here can run against live PayPal.

import { z } from "zod";

const SANDBOX_API = "https://api-m.sandbox.paypal.com";

export class PayPalNotConfigured extends Error {}

// A PayPal error response: `issue` is the first detail's issue name (ORDER_ALREADY_CAPTURED, …).
export class PayPalApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorName: string | undefined,
    readonly issue: string | undefined,
    readonly debugId: string | null,
  ) {
    super(`PayPal answered HTTP ${httpStatus}${issue ? ` (${issue})` : errorName ? ` (${errorName})` : ""}.`);
    this.name = "PayPalApiError";
  }
}

const moneySchema = z.object({ currency_code: z.string(), value: z.string() });

const captureSchema = z.object({
  id: z.string(),
  status: z.enum(["COMPLETED", "DECLINED", "PARTIALLY_REFUNDED", "PENDING", "REFUNDED", "FAILED"]),
  amount: moneySchema.optional(),
});

const orderSchema = z.object({
  id: z.string(),
  status: z.enum(["CREATED", "SAVED", "APPROVED", "VOIDED", "COMPLETED", "PAYER_ACTION_REQUIRED"]),
  purchase_units: z.array(z.object({
    payments: z.object({ captures: z.array(captureSchema).optional() }).optional(),
  })).optional(),
});

const errorSchema = z.object({
  name: z.string().optional(),
  details: z.array(z.object({ issue: z.string().optional() })).optional(),
});

export type PayPalOrder = z.infer<typeof orderSchema>;
export type PayPalCapture = z.infer<typeof captureSchema>;

export type NewOrder = {
  requestId: string; // reference_id
  paymentId: string; // custom_id
  payeeEmail: string;
  usdAmount: string; // "303.89"
  description: string;
  returnUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type PayPalClient = {
  createOrder(order: NewOrder): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder | null>; // null when PayPal doesn't know the order
  captureOrder(orderId: string, idempotencyKey: string): Promise<PayPalOrder>;
};

// The order's capture, if it has one. Hakika puts one purchase unit in each order.
export function captureOf(order: PayPalOrder): PayPalCapture | null {
  return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}

export function payPalFromEnv(env: Record<string, string | undefined> = process.env): PayPalClient {
  if (env.PAYPAL_ENV !== "sandbox") throw new PayPalNotConfigured("PAYPAL_ENV must be sandbox.");
  const clientId = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new PayPalNotConfigured("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set.");
  return createPayPalClient({ clientId, secret });
}

export function createPayPalClient(
  { clientId, secret, fetchFn = fetch }: { clientId: string; secret: string; fetchFn?: typeof fetch },
): PayPalClient {
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value;
    const response = await fetchFn(`${SANDBOX_API}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!response.ok) throw new PayPalApiError(response.status, "TOKEN_REQUEST_FAILED", undefined, response.headers.get("paypal-debug-id"));
    const body = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await response.json());
    // A minute early, so a token never expires between this check and PayPal reading it.
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  async function call(method: "GET" | "POST", path: string, body?: object, headers: Record<string, string> = {}) {
    const response = await fetchFn(`${SANDBOX_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = errorSchema.safeParse(json);
      throw new PayPalApiError(
        response.status,
        error.success ? error.data.name : undefined,
        error.success ? error.data.details?.[0]?.issue : undefined,
        response.headers.get("paypal-debug-id"),
      );
    }
    return orderSchema.parse(json);
  }

  return {
    createOrder(order) {
      return call("POST", "/v2/checkout/orders", {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: order.requestId,
          custom_id: order.paymentId,
          description: order.description,
          amount: { currency_code: "USD", value: order.usdAmount },
          payee: { email_address: order.payeeEmail },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "Hakika",
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: order.returnUrl,
              cancel_url: order.cancelUrl,
            },
          },
        },
      }, { "PayPal-Request-Id": order.idempotencyKey });
    },
    async getOrder(orderId) {
      try {
        return await call("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
      } catch (error) {
        if (error instanceof PayPalApiError && error.httpStatus === 404) return null;
        throw error;
      }
    },
    captureOrder(orderId, idempotencyKey) {
      // The same PayPal-Request-Id on a retry returns the first capture instead of charging again.
      return call("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, undefined, {
        "PayPal-Request-Id": idempotencyKey,
        Prefer: "return=representation",
      });
    },
  };
}
