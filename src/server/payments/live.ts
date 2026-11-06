// The payment routes' real connections. Tests pass fakes to the payment steps instead.

import { after } from "next/server";
import type { AnyDb } from "@/server/db/client";
import { describeError, parseTestPhones } from "@/server/whatsapp/intake";
import { sendWhatsApp } from "@/server/whatsapp/twilio";
import { sendPaymentConfirmations } from "./confirmations";

// For PaymentDeps.onPaid: the WhatsApp confirmations go out after the response, so the owner's
// payment never waits on Twilio.
export function confirmAfterResponse(db: AnyDb): (paymentIds: string[]) => void {
  return (paymentIds) => after(async () => {
    const deps = { db, send: sendWhatsApp, testPhones: parseTestPhones(process.env.WHATSAPP_TEST_PHONES) };
    for (const paymentId of paymentIds) {
      try {
        await sendPaymentConfirmations(deps, paymentId);
      } catch (error) {
        console.error("Payment confirmations failed:", describeError(error));
      }
    }
  });
}
