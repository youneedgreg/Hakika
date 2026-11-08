// GET /api/payments/config — the PayPal client ID the button needs, or null when this deployment
// isn't set up for the sandbox. Read per request: a prerendered copy would keep the values from
// build time until the next deploy. The client ID is public; the secret is only checked, never sent.

import { connection } from "next/server";
import type { PayPalConfig } from "@/shared/api";

export async function GET() {
  await connection();
  const configured = process.env.PAYPAL_ENV === "sandbox"
    && Boolean(process.env.PAYPAL_CLIENT_ID)
    && Boolean(process.env.PAYPAL_CLIENT_SECRET);
  const result: PayPalConfig = { clientId: configured ? process.env.PAYPAL_CLIENT_ID! : null };
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
