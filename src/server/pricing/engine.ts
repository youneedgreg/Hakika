// The price and quantity check. Code decides every finding here: it takes numbers already read from
// a quote and the database, calls no model and touches no database, so each rule can be tested alone.

import type { Finding } from "@/shared/types";
import { centsToAmount, formatKes } from "./money";

const WARN_ABOVE_MEDIAN_PERCENT = 15;
const BLOCK_ABOVE_MEDIAN_PERCENT = 30;
const QTY_ABOVE_PLAN_PERCENT = 10;
const CHEAPER_ORDER_PERCENT = 5;
const STATED_TOTAL_TOLERANCE_CENTS = 100; // a handwritten quote may round to the nearest shilling
const QTY_SCALE = 1_000_000; // quantities are compared as integers: 1.1 * 100 is not 110 in floating point

export type QuotedLine = {
  itemKey: string | null; // null when the item isn't one Hakika has a reference for
  description: string;
  qty: number | null;
  unit: string;
  unitPriceKesCents: number | null;
};

export type PriceCheckInput = {
  lines: QuotedLine[];
  quotedSupplier: { id: string | null; name: string; verified: boolean };
  statedTotalKesCents: number | null; // the total written on the quote, if there is one
  references: { itemKey: string; unit: string; medianKesCents: number }[];
  planRemaining: { itemKey: string; qty: number; unit: string }[]; // what's left in the milestone's plan
  verifiedSuppliers: {
    id: string;
    name: string;
    prices: { itemKey: string; unit: string; unitPriceKesCents: number }[];
  }[];
};

export type CheckedLine = QuotedLine & { referenceUnitPriceKesCents: number | null };

export type PriceCheckResult = {
  lines: CheckedLine[];
  quotedTotalKesCents: number | null; // null until every line has a quantity and a price
  recommended: null | { supplierId: string; supplierName: string; totalKesCents: number };
  findings: Finding[];
};

type CompleteLine = QuotedLine & { qty: number; unitPriceKesCents: number };

// "Bags" and "bag" are one unit. Only a final s goes: "pcs" and "piece" stay different and aren't compared.
const singularUnit = (unit: string) => unit.trim().toLowerCase().replace(/([^s])s$/, "$1");
const sameUnit = (a: string, b: string) => singularUnit(a) === singularUnit(b);
const scaled = (qty: number) => Math.round(qty * QTY_SCALE);
const lineTotal = (unitPriceKesCents: number, qty: number) =>
  Math.round((unitPriceKesCents * scaled(qty)) / QTY_SCALE);
const isComplete = (line: QuotedLine): line is CompleteLine =>
  line.qty !== null && Number.isFinite(line.qty) && line.qty > 0
  && line.unitPriceKesCents !== null && Number.isInteger(line.unitPriceKesCents) && line.unitPriceKesCents > 0;

function priceFinding(line: CompleteLine, medianKesCents: number): Finding | null {
  const price = line.unitPriceKesCents;
  const above = (percent: number) => price * 100 > medianKesCents * (100 + percent);
  if (!above(WARN_ABOVE_MEDIAN_PERCENT)) return null;
  const percentAbove = Math.round(((price - medianKesCents) * 100) / medianKesCents);
  return {
    type: "price_above_market",
    severity: above(BLOCK_ABOVE_MEDIAN_PERCENT) ? "block" : "warn",
    // "Cement, 50 kg bag" reads as "Cement" here, because the sentence already gives the unit.
    message: `${line.description.split(",")[0]} is quoted at ${formatKes(price)} a ${singularUnit(line.unit)}, ${percentAbove}% above the verified median of ${formatKes(medianKesCents)}.`,
    data: { itemKey: line.itemKey, quoted: centsToAmount(price), median: centsToAmount(medianKesCents), percentAbove },
  };
}

function quantityFindings(lines: CompleteLine[], planRemaining: PriceCheckInput["planRemaining"]): Finding[] {
  const orders = new Map<string, { description: string; unit: string; qty: number }>();
  for (const line of lines) {
    if (!line.itemKey) continue;
    const order = orders.get(line.itemKey);
    if (order) order.qty = (scaled(order.qty) + scaled(line.qty)) / QTY_SCALE;
    else orders.set(line.itemKey, { description: line.description, unit: line.unit, qty: line.qty });
  }

  const findings: Finding[] = [];
  for (const [itemKey, order] of orders) {
    const plan = planRemaining.find((p) => p.itemKey === itemKey && sameUnit(p.unit, order.unit));
    const remaining = plan?.qty ?? 0;
    if (scaled(order.qty) * 100 <= scaled(remaining) * (100 + QTY_ABOVE_PLAN_PERCENT)) continue;
    findings.push({
      type: "qty_above_plan",
      severity: "warn",
      message: plan
        ? `The order is for ${order.qty} ${order.unit} of ${order.description}, but ${remaining} ${order.unit} remain in this milestone's plan.`
        : `${order.description} is not in this milestone's plan, in ${order.unit}.`,
      data: { itemKey, ordered: order.qty, remaining },
    });
  }
  return findings;
}

// What each verified supplier would charge for the whole order. A supplier missing an item, or
// selling it in a different unit, can't be compared, so it isn't offered. Lowest first.
function verifiedOffers(lines: CompleteLine[], suppliers: PriceCheckInput["verifiedSuppliers"]) {
  const offers: { supplierId: string; supplierName: string; totalKesCents: number }[] = [];
  for (const supplier of suppliers) {
    let total = 0;
    const stocksEverything = lines.every((line) => {
      const price = supplier.prices.find((p) => p.itemKey === line.itemKey && sameUnit(p.unit, line.unit));
      if (price) total += lineTotal(price.unitPriceKesCents, line.qty);
      return Boolean(price);
    });
    if (stocksEverything) offers.push({ supplierId: supplier.id, supplierName: supplier.name, totalKesCents: total });
  }
  return offers.sort((a, b) => a.totalKesCents - b.totalKesCents || a.supplierId.localeCompare(b.supplierId));
}

export function checkPrices(input: PriceCheckInput): PriceCheckResult {
  const { quotedSupplier } = input;
  const findings: Finding[] = [];

  const lines: CheckedLine[] = input.lines.map((line) => {
    const reference = input.references.find((r) => r.itemKey === line.itemKey && sameUnit(r.unit, line.unit));
    return { ...line, referenceUnitPriceKesCents: reference?.medianKesCents ?? null };
  });

  const incomplete = lines.filter((line) => !isComplete(line));
  if (lines.length === 0 || incomplete.length > 0) {
    findings.push({
      type: "missing_info",
      severity: "block",
      message: lines.length === 0
        ? "The quote has no items that could be read."
        : `The quantity or price is missing for ${incomplete.map((line) => line.description).join(", ")}.`,
      data: { items: incomplete.map((line) => line.description) },
    });
    return { lines, quotedTotalKesCents: null, recommended: null, findings };
  }

  const complete = lines as (CheckedLine & CompleteLine)[];
  const quotedTotal = complete.reduce((sum, line) => sum + lineTotal(line.unitPriceKesCents, line.qty), 0);

  const stated = input.statedTotalKesCents;
  if (stated !== null && Math.abs(stated - quotedTotal) > STATED_TOTAL_TOLERANCE_CENTS) {
    findings.push({
      type: "missing_info",
      severity: "block",
      message: `The total written on the quote, ${formatKes(stated)}, does not match its lines, which add up to ${formatKes(quotedTotal)}.`,
      data: { stated: centsToAmount(stated), linesTotal: centsToAmount(quotedTotal) },
    });
  }

  const unchecked = complete.filter((line) => line.referenceUnitPriceKesCents === null);
  if (unchecked.length > 0) {
    findings.push({
      type: "missing_info",
      severity: "warn",
      message: `There is no reference price to check ${unchecked.map((line) => line.description).join(", ")} against.`,
      data: { items: unchecked.map((line) => line.description) },
    });
  }

  for (const line of complete) {
    const finding = line.referenceUnitPriceKesCents !== null && priceFinding(line, line.referenceUnitPriceKesCents);
    if (finding) findings.push(finding);
  }

  findings.push(...quantityFindings(complete, input.planRemaining));

  const offers = verifiedOffers(complete, input.verifiedSuppliers);
  const cheapestOther = offers.find((offer) => offer.supplierId !== quotedSupplier.id) ?? null;

  if (!quotedSupplier.verified) {
    findings.push({
      type: "unverified_supplier",
      severity: "warn",
      message: cheapestOther
        ? `${quotedSupplier.name}, on the quote, is not a verified supplier; the cheapest verified alternative is ${cheapestOther.supplierName} at ${formatKes(cheapestOther.totalKesCents)}.`
        : `${quotedSupplier.name}, on the quote, is not a verified supplier, and no verified supplier has prices for this whole order.`,
      data: { supplierName: quotedSupplier.name, alternativeSupplierId: cheapestOther?.supplierId ?? null },
    });
  }

  if (cheapestOther && cheapestOther.totalKesCents * 100 <= quotedTotal * (100 - CHEAPER_ORDER_PERCENT)) {
    const saving = quotedTotal - cheapestOther.totalKesCents;
    findings.push({
      type: "cheaper_verified_supplier",
      severity: "info",
      message: `${cheapestOther.supplierName}, a verified supplier, sells the same order for ${formatKes(cheapestOther.totalKesCents)}, ${formatKes(saving)} less.`,
      data: { supplierId: cheapestOther.supplierId, total: centsToAmount(cheapestOther.totalKesCents), saving: centsToAmount(saving) },
    });
    return { lines, quotedTotalKesCents: quotedTotal, recommended: cheapestOther, findings };
  }

  // Money only goes to a verified supplier: the quoted one when it's verified, otherwise the cheapest alternative.
  const recommended = quotedSupplier.verified && quotedSupplier.id
    ? { supplierId: quotedSupplier.id, supplierName: quotedSupplier.name, totalKesCents: quotedTotal }
    : cheapestOther;
  return { lines, quotedTotalKesCents: quotedTotal, recommended, findings };
}
