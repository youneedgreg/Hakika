// The owner's dashboard, from the database. Approvals and alerts here are the in-app notification:
// a request reaching awaiting_approval shows up on them. Held payments and overdue proofs join the
// alerts when proofs are built. Alert text is written by code or by the price check, never by a model.

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { centsToAmount } from "@/server/pricing/money";
import type { ProjectOverview } from "@/shared/api";
import type { Money } from "@/shared/types";

type Alert = ProjectOverview["alerts"][number];

const kes = (cents: number): Money => ({ amount: centsToAmount(cents), currency: "KES" });
const usd = (cents: number): Money => ({ amount: centsToAmount(cents), currency: "USD" });
const SEVERITY_ORDER = { block: 0, warn: 1, info: 2 };

export async function loadOverview(db: AnyDb, projectId: string): Promise<ProjectOverview | null> {
  const [row] = await db.select({ project: s.projects, ownerName: s.user.name }).from(s.projects)
    .innerJoin(s.user, eq(s.projects.ownerId, s.user.id))
    .where(eq(s.projects.id, projectId));
  if (!row) return null;

  const milestones = await db.select().from(s.milestones)
    .where(eq(s.milestones.projectId, projectId)).orderBy(asc(s.milestones.position));
  const current = milestones.find((m) => m.status !== "paid") ?? milestones.at(-1);

  const requests = await db.select().from(s.requests)
    .where(eq(s.requests.projectId, projectId)).orderBy(desc(s.requests.createdAt));
  const waiting = requests.filter((request) => request.status === "awaiting_approval");
  const ids = waiting.map((request) => request.id);
  const lines = ids.length === 0 ? [] : await db.select().from(s.requestLines)
    .where(inArray(s.requestLines.requestId, ids)).orderBy(asc(s.requestLines.position));
  const supplierIds = [...new Set(waiting.flatMap((request) => request.recommendedSupplierId ?? []))];
  const supplierNames = new Map((supplierIds.length === 0 ? [] : await db.select({ id: s.suppliers.id, name: s.suppliers.name })
    .from(s.suppliers).where(inArray(s.suppliers.id, supplierIds))).map((supplier) => [supplier.id, supplier.name]));

  const captured = await db.select().from(s.payments)
    .where(and(eq(s.payments.projectId, projectId), eq(s.payments.status, "captured")));

  return {
    project: { id: row.project.id, name: row.project.name, ownerName: row.ownerName, siteLabel: row.project.siteLabel },
    currentMilestone: current
      ? { id: current.id, name: current.name, status: current.status }
      : { id: "", name: "Not set", status: "planned" },
    approvals: waiting.map((request) => {
      // What the owner would pay: the recommended supplier's total when there is one, so the title
      // names that supplier, not the one on the quote.
      const recommended = request.recommendedTotalKesCents !== null;
      const supplier = recommended
        ? (request.recommendedSupplierId ? supplierNames.get(request.recommendedSupplierId) ?? null : null)
        : request.quotedSupplierName;
      return {
        requestId: request.id,
        title: approvalTitle(lines.filter((line) => line.requestId === request.id).map((line) => line.description), supplier),
        status: request.status,
        total: kes(request.recommendedTotalKesCents ?? request.quotedTotalKesCents ?? 0),
        createdAt: request.createdAt.toISOString(),
      };
    }),
    alerts: await loadAlerts(db, projectId, requests),
    ledger: {
      spent: kes(captured.reduce((sum, payment) => sum + payment.amountKesCents, 0)),
      spentUsd: usd(captured.reduce((sum, payment) => sum + payment.amountUsdCents, 0)),
      budget: kes(row.project.budgetKesCents),
      paymentsCount: captured.length,
    },
  };
}

function approvalTitle(descriptions: string[], supplierName: string | null): string {
  const [first = "Materials", ...others] = descriptions;
  const more = others.length === 0 ? "" : ` and ${others.length} more`;
  return `${first}${more}${supplierName ? ` from ${supplierName}` : ""}`;
}

async function loadAlerts(
  db: AnyDb,
  projectId: string,
  requests: (typeof s.requests.$inferSelect)[],
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  // A request waiting on the owner: its most serious finding.
  const waitingIds = requests.filter((request) => request.status === "awaiting_approval").map((request) => request.id);
  const findings = waitingIds.length === 0 ? [] : await db.select().from(s.findings)
    .where(inArray(s.findings.requestId, waitingIds)).orderBy(asc(s.findings.position));
  for (const requestId of waitingIds) {
    const [worst] = findings
      .filter((finding) => finding.requestId === requestId && finding.severity !== "info")
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    if (worst) {
      alerts.push({
        id: `finding-${worst.id}`, kind: "price_warning", severity: worst.severity, message: worst.message, link: { requestId },
      });
    }
  }

  // A quote that can't be approved. It closes itself once the same person sends a newer one.
  const contacts = await db.select({ id: s.siteContacts.id, name: s.siteContacts.name }).from(s.siteContacts)
    .where(eq(s.siteContacts.projectId, projectId));
  const seen = new Set<string | null>();
  for (const request of requests) { // newest first
    const isLatest = !seen.has(request.contactId);
    seen.add(request.contactId);
    if (request.status === "checked" && isLatest) {
      const name = contacts.find((contact) => contact.id === request.contactId)?.name ?? "the site";
      alerts.push({
        id: `incomplete-${request.id}`, kind: "quote_problem", severity: "block",
        message: `The latest quote from ${name} has details missing, so it can't be approved. They have been asked to send it again.`,
        link: { requestId: request.id },
      });
    }
  }

  // A photo that tried to instruct the reading model. A clean quote later doesn't explain this one
  // away, so it stays until the demo is reset; there is no way to dismiss an alert yet.
  const suspicious = await db.select().from(s.auditEvents)
    .where(and(eq(s.auditEvents.projectId, projectId), eq(s.auditEvents.action, "request.suspicious_quote")))
    .orderBy(desc(s.auditEvents.at));
  for (const event of suspicious) {
    alerts.push({
      id: `suspicious-${event.id}`, kind: "quote_problem", severity: "block",
      message: "A quote photo contained text aimed at Hakika's reading model, so nothing from it was used. Please check it with your foreman.",
      link: event.requestId ? { requestId: event.requestId } : {},
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
