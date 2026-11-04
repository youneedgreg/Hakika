// The PayPal client, fed PayPal's own published examples (Orders v2 spec 2.36, saved verbatim in
// tests/fixtures/paypal) rather than payloads this code wrote, so a wrong reading of PayPal's shape
// can't pass because the test shares the mistake.

import { describe, expect, it } from "vitest";
import createdOrder from "./fixtures/paypal/create-order-payer-action.json";
import capturedOrder from "./fixtures/paypal/capture-order-completed.json";
import payerActionError from "./fixtures/paypal/capture-order-422-payer-action.json";
import {
  captureOf, createPayPalClient, PayPalApiError, PayPalNotConfigured, payPalFromEnv, type NewOrder,
} from "@/server/payments/paypal";

type Call = { url: string; init: RequestInit };

function fakePayPal(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "token-1", expires_in: 32400 });
    return answer(call);
  }) as typeof fetch;
  return { calls, client: createPayPalClient({ clientId: "id", secret: "secret", fetchFn }) };
}

const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

const order: NewOrder = {
  requestId: "req_1",
  paymentId: "pay_1",
  payeeEmail: "mlima@business.example.com",
  usdAmount: "303.89",
  description: "Hakika (sandbox): building materials from Mlima Hardware",
  returnUrl: "https://tryhakika.vercel.app/requests/req_1?paypal=approved",
  cancelUrl: "https://tryhakika.vercel.app/requests/req_1?paypal=cancelled",
  idempotencyKey: "create-pay_1",
};

describe("the PayPal client", () => {
  it("creates a USD order paid straight to the supplier, and reads PayPal's example answer", async () => {
    const { calls, client } = fakePayPal(() => Response.json(createdOrder));
    const result = await client.createOrder(order);

    expect(result).toMatchObject({ id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED" });
    const create = calls[1];
    expect(create.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(header(create, "PayPal-Request-Id")).toBe("create-pay_1");
    expect(header(create, "Authorization")).toBe("Bearer token-1");
    const body = JSON.parse(create.init.body as string);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units).toEqual([{
      reference_id: "req_1",
      custom_id: "pay_1",
      description: order.description,
      amount: { currency_code: "USD", value: "303.89" },
      payee: { email_address: "mlima@business.example.com" },
    }]);
    expect(body.payment_source.paypal.experience_context).toMatchObject({
      user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: order.returnUrl, cancel_url: order.cancelUrl,
    });
  });

  it("captures with the payment's PayPal-Request-Id and finds the capture in PayPal's example answer", async () => {
    const { calls, client } = fakePayPal(() => Response.json(capturedOrder, { status: 201 }));
    const result = await client.captureOrder("5O190127TN364715T", "capture-pay_1");

    expect(calls[1].url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T/capture");
    expect(header(calls[1], "PayPal-Request-Id")).toBe("capture-pay_1");
    expect(result.status).toBe("COMPLETED");
    expect(captureOf(result)).toEqual({
      id: "3C679366HH908993F", status: "COMPLETED", amount: { currency_code: "USD", value: "100.00" },
    });
  });

  it("reads the issue name from PayPal's example 422 answer", async () => {
    const { client } = fakePayPal(() => Response.json(payerActionError, {
      status: 422, headers: { "paypal-debug-id": "f63fbc340a6ce" },
    }));
    const error = await client.captureOrder("5O190127TN364715T", "capture-pay_1").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalApiError);
    expect(error).toMatchObject({
      httpStatus: 422, errorName: "UNPROCESSABLE_ENTITY", issue: "PAYER_ACTION_REQUIRED", debugId: "f63fbc340a6ce",
    });
  });

  it("answers null for an order PayPal doesn't know", async () => {
    const { client } = fakePayPal(() => Response.json({ name: "RESOURCE_NOT_FOUND", details: [{ issue: "INVALID_RESOURCE_ID" }] }, { status: 404 }));
    expect(await client.getOrder("NOPE")).toBeNull();
  });

  it("asks for a token once and reuses it", async () => {
    const { calls, client } = fakePayPal(() => Response.json(createdOrder));
    await client.getOrder("5O190127TN364715T");
    await client.getOrder("5O190127TN364715T");
    expect(calls.filter((call) => call.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });

  it("refuses to run anywhere but the sandbox, or without keys", () => {
    const keys = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" };
    expect(() => payPalFromEnv({ PAYPAL_ENV: "live", ...keys })).toThrow(PayPalNotConfigured);
    expect(() => payPalFromEnv({ ...keys })).toThrow(PayPalNotConfigured);
    expect(() => payPalFromEnv({ PAYPAL_ENV: "sandbox" })).toThrow(PayPalNotConfigured);
    expect(() => payPalFromEnv({ PAYPAL_ENV: "sandbox", ...keys })).not.toThrow();
  });
});
