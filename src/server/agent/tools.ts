// Ask Hakika's tools. Every one only reads (the PayPal one through the Agent Toolkit, its method
// fixed as get_order: see paypal-order.ts), and each is bound to the project the server chose: the
// model can't name a project, and nothing here can create, change or pay for anything.
//
// The tools return text that Hakika's own code wrote (statuses, amounts, check results, the money
// trail) and never what anyone typed on WhatsApp. A few fields hold words read from a quote photo
// or typed by the owner (an item as written, a finding about it, a decline or override reason):
// those go through the same instruction filter the quote reader uses.
//
// Each record a tool returns has a `ref`. The tools register those refs with their links, so an
// answer can only cite records the tools actually returned, with labels and links code wrote.

import { tool, type ToolSet } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { looksLikeInstructions } from "@/server/ai/nova";
import { type OrderLookup, orderSummary, PAYPAL_ORDER_ID, toolkitOrderLookup } from "./paypal-order";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { centsToAmount, formatKes } from "@/server/pricing/money";
import { loadGantt } from "@/server/projects/gantt";
import { loadLedger } from "@/server/projects/ledger";
import { loadOverview } from "@/server/projects/overview";
import type { ChatResult } from "@/shared/api";
import type { MilestoneStatus } from "@/shared/types";

export type Citation = ChatResult["citations"][number];

// Most recent first, and few enough to keep each tool result small.
const RECENT = 20;
const TRAIL_ROWS = 40;

export const WITHHELD = "[withheld: this text looked like instructions]";

function safeText(text: string): string;
function safeText(text: string | null): string | null;
function safeText(text: string | null): string | null {
  if (text === null) return null;
  return looksLikeInstructions(text) ? WITHHELD : text;
}

const usd = (cents: number) => `USD ${centsToAmount(cents)}`;
const day = (at: Date | string) =>
  new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });

const noInput = z.object({});

export type ProjectTools = {
  tools: ToolSet;
  // ref → citation, for every record a tool has returned so far
  records: Map<string, Citation>;
};

export function projectTools(
  db: AnyDb,
  projectId: string,
  { lookupOrder = toolkitOrderLookup() }: { lookupOrder?: OrderLookup } = {},
): ProjectTools {
  const records = new Map<string, Citation>();
  const cite = (ref: string, citation: Citation) => {
    records.set(ref, citation);
    return ref;
  };
  const project = encodeURIComponent(projectId);
  const milestoneRef = (id: string, name: string) =>
    cite(`milestone:${id}`, { label: `Timeline: ${name}`, href: `/projects/${project}/gantt?milestone=${encodeURIComponent(id)}` });
  const requestRef = (request: { id: string; createdAt: Date }, milestone: string | null) =>
    cite(`request:${request.id}`, {
      label: `Request: ${milestone ? `${milestone} materials` : "materials"}, ${day(request.createdAt)}`,
      href: `/requests/${encodeURIComponent(request.id)}`,
    });
  const proofRef = (proof: { id: string; receivedAt: Date }, milestone: string | null, purpose: string | null) =>
    cite(`proof:${proof.id}`, {
      label: `Proof review: ${[milestone, purpose].filter(Boolean).join(" ") || "photo"}, ${day(proof.receivedAt)}`,
      href: `/proofs/${encodeURIComponent(proof.id)}`,
    });
  const trailRef = () => cite("money-trail", { label: "Money trail", href: `/projects/${project}/money` });

  // Refs for records another tool points at (an alert, a payment, a money trail row), registered
  // with the same labels the record's own tool would give it. Unknown or other projects' IDs get none.
  async function requestRefs(ids: (string | undefined | null)[], milestones: Map<string, string>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await db.select({ id: s.requests.id, projectId: s.requests.projectId, milestoneId: s.requests.milestoneId, createdAt: s.requests.createdAt })
      .from(s.requests).where(inArray(s.requests.id, wanted));
    return new Map(rows.filter((row) => row.projectId === projectId).map((row) =>
      [row.id, requestRef(row, row.milestoneId ? milestones.get(row.milestoneId) ?? null : null)]));
  }

  async function proofRefs(ids: (string | undefined | null)[], milestones: Map<string, string>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await db
      .select({ id: s.proofs.id, projectId: s.proofs.projectId, receivedAt: s.proofs.receivedAt, milestoneId: s.proofRequests.milestoneId, purpose: s.proofRequests.purpose })
      .from(s.proofs).leftJoin(s.proofRequests, eq(s.proofRequests.id, s.proofs.proofRequestId))
      .where(inArray(s.proofs.id, wanted));
    return new Map(rows.filter((row) => row.projectId === projectId).map((row) =>
      [row.id, proofRef(row, row.milestoneId ? milestones.get(row.milestoneId) ?? null : null, row.purpose)]));
  }

  async function milestoneNames(): Promise<Map<string, string>> {
    const rows = await db.select({ id: s.milestones.id, name: s.milestones.name })
      .from(s.milestones).where(eq(s.milestones.projectId, projectId));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async function contactNames(): Promise<Map<string, string>> {
    const rows = await db.select({ id: s.siteContacts.id, name: s.siteContacts.name })
      .from(s.siteContacts).where(eq(s.siteContacts.projectId, projectId));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async function supplierNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await db.select({ id: s.suppliers.id, name: s.suppliers.name })
      .from(s.suppliers).where(inArray(s.suppliers.id, wanted));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  const tools = {
    project_status: tool({
      description:
        "The project's budget, what has been spent, each milestone with its status and labour payment, " +
        "and the alerts waiting for the owner. Start here for questions about progress, spending or what is next.",
      inputSchema: noInput,
      execute: async () => {
        const [overview, gantt] = await Promise.all([loadOverview(db, projectId), loadGantt(db, projectId)]);
        if (!overview || !gantt) return { found: false };
        const status = new Map<string, MilestoneStatus>(
          gantt.tasks.filter((task) => task.kind === "work").map((task) => [task.id, task.status]),
        );
        const [contacts, names, milestones] = await Promise.all([
          contactNames(),
          milestoneNames(),
          db.select().from(s.milestones).where(eq(s.milestones.projectId, projectId)).orderBy(asc(s.milestones.position)),
        ]);
        const [alertRequests, alertProofs] = await Promise.all([
          requestRefs(overview.alerts.map((alert) => alert.link.requestId), names),
          proofRefs(overview.alerts.map((alert) => alert.link.proofId), names),
        ]);
        return {
          found: true,
          project: { name: overview.project.name, site: overview.project.siteLabel, owner: overview.project.ownerName },
          budget: formatKes(Math.round(Number(overview.ledger.budget.amount) * 100)),
          spent: formatKes(Math.round(Number(overview.ledger.spent.amount) * 100)),
          spentUsd: `USD ${overview.ledger.spentUsd.amount}`,
          paymentsCaptured: overview.ledger.paymentsCount,
          currentMilestone: overview.currentMilestone.name,
          milestones: milestones.map((m) => ({
            ref: milestoneRef(m.id, m.name),
            name: m.name,
            status: status.get(m.id) ?? m.status,
            plannedStart: m.plannedStart,
            plannedEnd: m.plannedEnd,
            labour: m.labourKesCents === null ? null : formatKes(m.labourKesCents),
            labourPaidTo: m.labourContactId ? contacts.get(m.labourContactId) ?? null : null,
          })),
          alerts: overview.alerts.map((alert) => ({
            kind: alert.kind,
            severity: alert.severity,
            message: safeText(alert.message),
            request: alertRequests.get(alert.link.requestId ?? "") ?? null,
            proof: alertProofs.get(alert.link.proofId ?? "") ?? null,
          })),
        };
      },
    }),

    list_requests: tool({
      description:
        "Materials requests from the site, newest first: who asked, the quoted supplier and total, the items, " +
        "what the price check found, the recommended verified supplier, and the request's status.",
      inputSchema: noInput,
      execute: async () => {
        const rows = await db.select().from(s.requests)
          .where(eq(s.requests.projectId, projectId)).orderBy(desc(s.requests.createdAt)).limit(RECENT);
        if (rows.length === 0) return { requests: [] };
        const ids = rows.map((row) => row.id);
        const [milestones, contacts, suppliers, lines, findings, references] = await Promise.all([
          milestoneNames(),
          contactNames(),
          supplierNames(rows.flatMap((row) => [row.quotedSupplierId, row.recommendedSupplierId])),
          db.select().from(s.requestLines).where(inArray(s.requestLines.requestId, ids)).orderBy(asc(s.requestLines.position)),
          db.select().from(s.findings).where(inArray(s.findings.requestId, ids)).orderBy(asc(s.findings.position)),
          db.select({ itemKey: s.priceReferences.itemKey, description: s.priceReferences.description }).from(s.priceReferences),
        ]);
        const catalog = new Map(references.map((ref) => [ref.itemKey, ref.description]));
        return {
          requests: rows.map((row) => {
            const milestone = row.milestoneId ? milestones.get(row.milestoneId) ?? null : null;
            return {
              ref: requestRef(row, milestone),
              status: row.status,
              receivedAt: row.createdAt.toISOString(),
              milestone,
              sentBy: row.contactId ? contacts.get(row.contactId) ?? null : null,
              // A verified supplier's name is Hakika's own; any other is as written on the quote, filtered.
              quotedSupplier: row.quotedSupplierId
                ? suppliers.get(row.quotedSupplierId) ?? null
                : `${safeText(row.quotedSupplierName) ?? "a supplier"} (not a verified supplier)`,
              quotedTotal: row.quotedTotalKesCents === null ? null : formatKes(row.quotedTotalKesCents),
              recommended: row.recommendedSupplierId && row.recommendedTotalKesCents !== null
                ? { supplier: suppliers.get(row.recommendedSupplierId) ?? null, total: formatKes(row.recommendedTotalKesCents) }
                : null,
              items: lines.filter((line) => line.requestId === row.id).map((line) => ({
                item: catalog.get(line.itemKey) ?? safeText(line.description),
                qty: line.qty,
                unit: line.unit,
                unitPrice: formatKes(line.unitPriceKesCents),
                marketMedian: line.referenceUnitPriceKesCents === null ? null : formatKes(line.referenceUnitPriceKesCents),
              })),
              findings: findings.filter((finding) => finding.requestId === row.id).map((finding) => ({
                type: finding.type,
                severity: finding.severity,
                message: safeText(finding.message),
              })),
              declineReason: safeText(row.declineReason),
            };
          }),
        };
      },
    }),

    list_payments: tool({
      description:
        "PayPal payments, newest first: materials paid to suppliers and labour paid to fundis, with amounts in " +
        "KES and USD, status, and PayPal order and capture IDs.",
      inputSchema: noInput,
      execute: async () => {
        const rows = await db.select().from(s.payments)
          .where(eq(s.payments.projectId, projectId)).orderBy(desc(s.payments.createdAt)).limit(RECENT);
        if (rows.length === 0) return { payments: [] };
        const [milestones, contacts, suppliers] = await Promise.all([
          milestoneNames(), contactNames(), supplierNames(rows.map((row) => row.payeeSupplierId)),
        ]);
        const requests = await requestRefs(rows.map((row) => row.requestId), milestones);
        return {
          payments: rows.map((row) => {
            const forRecord = row.requestId
              ? requests.get(row.requestId) ?? null
              : row.milestoneId && milestones.has(row.milestoneId) ? milestoneRef(row.milestoneId, milestones.get(row.milestoneId)!) : null;
            return {
              kind: row.kind,
              for: forRecord,
              paidTo: row.payeeSupplierId
                ? suppliers.get(row.payeeSupplierId) ?? null
                : row.payeeContactId ? contacts.get(row.payeeContactId) ?? null : null,
              amount: formatKes(row.amountKesCents),
              amountUsd: usd(row.amountUsdCents),
              status: row.status,
              createdAt: row.createdAt.toISOString(),
              capturedAt: row.capturedAt?.toISOString() ?? null,
              paypalOrderId: row.paypalOrderId,
              paypalCaptureId: row.paypalCaptureId,
            };
          }),
        };
      },
    }),

    list_proofs: tool({
      description:
        "Proof photos, newest first, with the verdict (verified, needs fresh proof or suspicious), every check " +
        "and its result, and any override the owner saved. Use this to explain why a payment is held.",
      inputSchema: noInput,
      execute: async () => {
        const rows = await db
          .select({ proof: s.proofs, request: s.proofRequests, verdict: s.verdicts })
          .from(s.proofs)
          .leftJoin(s.proofRequests, eq(s.proofRequests.id, s.proofs.proofRequestId))
          .leftJoin(s.verdicts, eq(s.verdicts.proofId, s.proofs.id))
          .where(eq(s.proofs.projectId, projectId))
          .orderBy(desc(s.proofs.receivedAt))
          .limit(RECENT);
        if (rows.length === 0) return { proofs: [] };
        const milestones = await milestoneNames();
        return {
          proofs: rows.map(({ proof, request, verdict }) => {
            const milestone = request ? milestones.get(request.milestoneId) ?? null : null;
            return {
              ref: proofRef(proof, milestone, request?.purpose ?? null),
              milestone: request && milestone ? milestoneRef(request.milestoneId, milestone) : null,
              purpose: request?.purpose ?? null,
              receivedAt: proof.receivedAt.toISOString(),
              outcome: verdict?.outcome ?? "not checked yet",
              checks: (verdict?.checks ?? []).map((check) => ({
                name: check.name, result: check.result, hard: check.hard, detail: check.detail,
              })),
              explanation: verdict?.explanation ?? null,
              override: verdict?.overriddenAt
                ? { reason: safeText(verdict.overrideReason), at: verdict.overriddenAt.toISOString() }
                : null,
            };
          }),
        };
      },
    }),

    money_trail: tool({
      description:
        "The money trail: every request, payment, proof, verdict, override and milestone event, newest first, " +
        "with amounts and PayPal IDs. Use it for 'when' and 'what happened' questions.",
      inputSchema: noInput,
      execute: async () => {
        const all = await loadLedger(db, projectId);
        if (!all) return { found: false };
        const rows = all.slice(-TRAIL_ROWS).reverse();
        const milestones = await milestoneNames();
        const [requests, proofs] = await Promise.all([
          requestRefs(rows.map((row) => row.link.requestId), milestones),
          proofRefs(rows.map((row) => row.link.proofId), milestones),
        ]);
        const milestoneOf = (id: string | undefined) =>
          id && milestones.has(id) ? milestoneRef(id, milestones.get(id)!) : undefined;
        return {
          found: true,
          ref: trailRef(),
          events: rows.map((row) => ({
            at: row.at,
            kind: row.kind,
            description: safeText(row.description),
            ...(row.amount ? { amount: formatKes(Math.round(Number(row.amount.amount) * 100)) } : {}),
            ...(row.amountUsd ? { amountUsd: `USD ${row.amountUsd.amount}` } : {}),
            ...(row.paypalOrderId ? { paypalOrderId: row.paypalOrderId } : {}),
            ...(row.paypalCaptureId ? { paypalCaptureId: row.paypalCaptureId } : {}),
            ...(requests.has(row.link.requestId ?? "") ? { request: requests.get(row.link.requestId!) } : {}),
            ...(proofs.has(row.link.proofId ?? "") ? { proof: proofs.get(row.link.proofId!) } : {}),
            ...(milestoneOf(row.link.milestoneId) ? { milestone: milestoneOf(row.link.milestoneId) } : {}),
          })),
        };
      },
    }),
    get_paypal_order: tool({
      description:
        "What PayPal itself says about one of this project's payments: the order's status, amount and captures. " +
        "Takes a PayPal order ID from list_payments. Use it to confirm a payment with PayPal.",
      inputSchema: z.object({
        orderId: z.string().regex(PAYPAL_ORDER_ID).describe("A PayPal order ID from list_payments"),
      }),
      execute: async ({ orderId }) => {
        // Only an order this project's own payments recorded: never an ID the model made up.
        const [payment] = await db.select().from(s.payments)
          .where(and(eq(s.payments.projectId, projectId), eq(s.payments.paypalOrderId, orderId)));
        if (!payment) return { found: false, orderId };
        const milestones = await milestoneNames();
        const forRecord = payment.requestId
          ? (await requestRefs([payment.requestId], milestones)).get(payment.requestId) ?? null
          : payment.milestoneId && milestones.has(payment.milestoneId)
            ? milestoneRef(payment.milestoneId, milestones.get(payment.milestoneId)!) : null;
        const recorded = { status: payment.status, amountUsd: usd(payment.amountUsdCents), paypalCaptureId: payment.paypalCaptureId };
        try {
          return { found: true, orderId, for: forRecord, recorded, paypal: orderSummary(await lookupOrder(orderId)) };
        } catch {
          return { found: true, orderId, for: forRecord, recorded, paypal: "PayPal could not be reached for this order." };
        }
      },
    }),
  } satisfies ToolSet;

  return { tools, records };
}

