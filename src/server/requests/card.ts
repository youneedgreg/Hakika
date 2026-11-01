// The approval card for one request, from the database. The USD amount uses the day's rate; the
// browser never sends or changes a total.

import { asc, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { centsToAmount, kesCentsToUsdCents } from "@/server/pricing/money";
import { getDailyRate } from "@/server/pricing/fx";
import type { ApprovalCard, Money } from "@/shared/types";

const kes = (cents: number): Money => ({ amount: centsToAmount(cents), currency: "KES" });
const usd = (cents: number): Money => ({ amount: centsToAmount(cents), currency: "USD" });
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export async function loadApprovalCard(
  db: AnyDb,
  requestId: string,
  { rate = () => getDailyRate(db) }: { rate?: () => Promise<{ kesPerUsd: string }> } = {},
): Promise<ApprovalCard | null> {
  const [request] = await db.select().from(s.requests).where(eq(s.requests.id, requestId));
  if (!request) return null;

  const [milestone] = request.milestoneId
    ? await db.select().from(s.milestones).where(eq(s.milestones.id, request.milestoneId))
    : [];
  const [contact] = request.contactId
    ? await db.select().from(s.siteContacts).where(eq(s.siteContacts.id, request.contactId))
    : [];
  const [supplier] = request.recommendedSupplierId
    ? await db.select().from(s.suppliers).where(eq(s.suppliers.id, request.recommendedSupplierId))
    : [];
  const lines = await db.select().from(s.requestLines)
    .where(eq(s.requestLines.requestId, requestId)).orderBy(asc(s.requestLines.position));
  const findings = await db.select().from(s.findings)
    .where(eq(s.findings.requestId, requestId)).orderBy(asc(s.findings.position));

  let recommended: ApprovalCard["recommended"] = null;
  if (supplier && request.recommendedTotalKesCents !== null) {
    const { kesPerUsd } = await rate();
    recommended = {
      supplierId: supplier.id,
      supplierName: supplier.name,
      total: kes(request.recommendedTotalKesCents),
      totalUsd: usd(kesCentsToUsdCents(request.recommendedTotalKesCents, kesPerUsd)),
      fxRate: Number(kesPerUsd),
    };
  }

  return {
    requestId: request.id,
    status: request.status,
    milestone: milestone ? { id: milestone.id, name: milestone.name } : { id: "", name: "Not set" },
    requestedBy: contact ? { name: contact.name, role: capitalised(contact.role) } : { name: "Unknown", role: "" },
    lines: lines.map((line) => ({
      itemKey: line.itemKey,
      description: line.description,
      qty: line.qty,
      unit: line.unit,
      unitPrice: kes(line.unitPriceKesCents),
      ...(line.referenceUnitPriceKesCents !== null ? { referenceUnitPrice: kes(line.referenceUnitPriceKesCents) } : {}),
    })),
    quotedTotal: kes(request.quotedTotalKesCents ?? 0),
    recommended,
    findings: findings.map(({ type, severity, message, data }) => ({ type, severity, message, data })),
    summary: request.summary ?? "",
  };
}
