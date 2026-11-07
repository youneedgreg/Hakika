// PayPal webhook events, after the route has checked PayPal's signature. Each event is stored by
// its ID first, so a repeated delivery is ignored. Events only point at an order; what happened to
// it is read back from PayPal (syncPaymentFromPayPal), and nothing here can capture or pay.

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { syncPaymentFromPayPal, type PaymentDeps, type SyncResult } from "./orders";

const linkSchema = z.object({ rel: z.string(), href: z.string() });

export const payPalEventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z.object({
    id: z.string().optional(),
    supplementary_data: z.object({
      related_ids: z.object({ order_id: z.string().optional() }).optional(),
    }).optional(),
    links: z.array(linkSchema).optional(),
  }).passthrough().optional(),
}).passthrough();

export type PayPalEvent = z.infer<typeof payPalEventSchema>;

// The resource is a capture: its ID, and the order it belongs to.
const CAPTURE_EVENTS = new Set([
  "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.DENIED",
]);
// The resource is a refund (or reversal), whose "up" link names the capture.
const REFUND_EVENTS = new Set(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"]);

export type WebhookResult = "duplicate" | "ignored" | SyncResult;

export async function handlePayPalEvent(
  db: AnyDb,
  event: PayPalEvent,
  deps: PaymentDeps,
): Promise<WebhookResult> {
  const now = deps.now ?? (() => new Date());
  const key = and(eq(s.webhookEvents.provider, "paypal"), eq(s.webhookEvents.eventId, event.id));
  await db.insert(s.webhookEvents)
    .values({ provider: "paypal", eventId: event.id, type: event.event_type, payload: event })
    .onConflictDoNothing();
  const [stored] = await db.select().from(s.webhookEvents).where(key);
  // Processed before. One that failed half-way has no processedAt, so PayPal's retry runs it
  // again; that's safe because syncing only records what PayPal says.
  if (stored.processedAt) return "duplicate";

  const orderId = await orderIdFor(db, event);
  const result = orderId
    ? await syncPaymentFromPayPal(db, orderId, deps, { eventId: event.id, eventType: event.event_type })
    : "ignored";
  await db.update(s.webhookEvents).set({ processedAt: now() }).where(key);
  return result;
}

async function orderIdFor(db: AnyDb, event: PayPalEvent): Promise<string | null> {
  const resource = event.resource;
  if (!resource) return null;
  if (CAPTURE_EVENTS.has(event.event_type)) {
    const orderId = resource.supplementary_data?.related_ids?.order_id;
    if (orderId) return orderId;
    return resource.id ? orderIdOfCapture(db, resource.id) : null;
  }
  if (REFUND_EVENTS.has(event.event_type)) {
    const up = resource.links?.find((link) => link.rel === "up")?.href;
    const captureId = up?.match(/\/v2\/payments\/captures\/([^/?#]+)$/)?.[1];
    return captureId ? orderIdOfCapture(db, decodeURIComponent(captureId)) : null;
  }
  return null;
}

async function orderIdOfCapture(db: AnyDb, captureId: string): Promise<string | null> {
  const [payment] = await db.select({ orderId: s.payments.paypalOrderId }).from(s.payments)
    .where(eq(s.payments.paypalCaptureId, captureId));
  return payment?.orderId ?? null;
}
