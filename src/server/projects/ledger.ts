// The money trail, from the database: every audit event for the project, oldest first, with its
// amounts and PayPal IDs. Audit rows are only ever inserted, so this is the record as it happened.

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import type { AUDIT_KINDS } from "@/server/db/enums";
import * as s from "@/server/db/schema";
import { centsToAmount } from "@/server/pricing/money";
import type { LedgerRow } from "@/shared/api";

// Compile-time check: the audit kinds are exactly the ledger kinds.
type LedgerKind = (typeof AUDIT_KINDS)[number];
const kindsMatch: [LedgerKind] extends [LedgerRow["kind"]] ? ([LedgerRow["kind"]] extends [LedgerKind] ? true : false) : false = true;
void kindsMatch;

export async function loadLedger(db: AnyDb, projectId: string): Promise<LedgerRow[] | null> {
  const [project] = await db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId));
  if (!project) return null;

  const events = await db.select().from(s.auditEvents)
    .where(eq(s.auditEvents.projectId, projectId))
    .orderBy(asc(s.auditEvents.at), asc(s.auditEvents.id));

  return events.map((event) => {
    const row: LedgerRow = {
      at: event.at.toISOString(),
      kind: event.kind,
      description: event.description,
      link: {},
    };
    if (event.amountKesCents !== null) row.amount = { amount: centsToAmount(event.amountKesCents), currency: "KES" };
    if (event.amountUsdCents !== null) row.amountUsd = { amount: centsToAmount(event.amountUsdCents), currency: "USD" };
    if (event.paypalOrderId) row.paypalOrderId = event.paypalOrderId;
    if (event.paypalCaptureId) row.paypalCaptureId = event.paypalCaptureId;
    if (event.requestId) row.link.requestId = event.requestId;
    if (event.proofId) row.link.proofId = event.proofId;
    if (event.milestoneId) row.link.milestoneId = event.milestoneId;
    return row;
  });
}
