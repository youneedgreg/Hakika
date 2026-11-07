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
  referenceId: "req_1",
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

describe("checking a webhook's signature with PayPal", () => {
  const signed = new Headers({
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test",
    "paypal-transmission-id": "transmission-1",
    "paypal-transmission-sig": "ZmFrZS1zaWduYXR1cmUtZm9yLXRlc3Rz",
    "paypal-transmission-time": "2026-11-06T18:40:00Z",
  });
  const rawBody = '{"id":"WH-TEST-1","event_type":"PAYMENT.CAPTURE.COMPLETED",  "resource":{"id":"CAP-1"}}';

  it("sends PayPal the headers, the webhook ID and the event exactly as it arrived", async () => {
    const { calls, client } = fakePayPal(() => Response.json({ verification_status: "SUCCESS" }));

    expect(await client.verifyWebhookSignature({ headers: signed, rawBody, webhookId: "WH-ID" })).toBe(true);
    const call = calls.at(-1)!;
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    const sent = call.init.body as string;
    expect(sent.endsWith(`"webhook_event":${rawBody}}`)).toBe(true); // spacing and key order untouched
    expect(JSON.parse(sent)).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: signed.get("paypal-cert-url"),
      transmission_id: signed.get("paypal-transmission-id"),
      transmission_sig: signed.get("paypal-transmission-sig"),
      transmission_time: "2026-11-06T18:40:00Z",
      webhook_id: "WH-ID",
    });
  });

  it("treats any status but SUCCESS as a failed check", async () => {
    const { client } = fakePayPal(() => Response.json({ verification_status: "FAILURE" }));
    expect(await client.verifyWebhookSignature({ headers: signed, rawBody, webhookId: "WH-ID" })).toBe(false);
  });

  it("fails without asking PayPal when a signature header is missing", async () => {
    const { calls, client } = fakePayPal(() => Response.json({ verification_status: "SUCCESS" }));
    const headers = new Headers(signed);
    headers.delete("paypal-transmission-sig");
    expect(await client.verifyWebhookSignature({ headers, rawBody, webhookId: "WH-ID" })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("refuses a body that isn't exactly one JSON object, so it can't smuggle in its own webhook_id", async () => {
    const { calls, client } = fakePayPal(() => Response.json({ verification_status: "SUCCESS" }));
    for (const body of [`${rawBody},"webhook_id":"ATTACKER"`, "[1]", "not json", ""]) {
      expect(await client.verifyWebhookSignature({ headers: signed, rawBody: body, webhookId: "WH-ID" })).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("throws a PayPalApiError when PayPal can't check it", async () => {
    const { client } = fakePayPal(() => Response.json({ name: "INTERNAL_SERVER_ERROR" }, { status: 500 }));
    await expect(client.verifyWebhookSignature({ headers: signed, rawBody, webhookId: "WH-ID" }))
      .rejects.toBeInstanceOf(PayPalApiError);
  });
});
