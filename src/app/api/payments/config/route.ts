import type { PayPalConfig } from "@/shared/api";

export async function GET() {
  const configured = process.env.PAYPAL_ENV === "sandbox"
    && Boolean(process.env.PAYPAL_CLIENT_ID)
    && Boolean(process.env.PAYPAL_CLIENT_SECRET);
  const result: PayPalConfig = { clientId: configured ? process.env.PAYPAL_CLIENT_ID! : null };
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}