// The owner's summary. Code always writes one; the model's wording replaces it only if the number
// guard passes it. A failed model or a failed guard costs nothing but the nicer wording.

import type { ExplainFindings, SummaryFacts } from "@/server/ai/explain";
import type { PriceCheckResult } from "@/server/pricing/engine";
import { formatKes } from "@/server/pricing/money";
import { describeError } from "@/server/whatsapp/intake";

const MAX_LENGTH = 600;
// Nothing the model is given has a dollar amount or a link, so neither can be right here.
// Whether to approve is the owner's call, so the model's text can't bring it up.
const FORBIDDEN = /https?:|www\.|@|\$|\busd\b|dollar|\bapprov/i;
// A number in words would get past the digit check. "One" stays allowed: it's too common to mean a quantity.
const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\w+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|double|twice|triple)\b/i;

export type WrittenSummary = {
  summary: string;
  source: "model" | "template";
  rejected?: { reason: string; text?: string }; // kept in the audit trail for the eval
};

// Written by code, so every number in it is one the price check produced.
export function templateSummary(contactName: string, supplierName: string, result: PriceCheckResult): string {
  const { quotedTotalKesCents: total, recommended, findings } = result;
  const sentences = [
    total === null
      ? `${contactName} sent a quote from ${supplierName} with details missing.`
      : `${contactName} sent a quote from ${supplierName} for ${formatKes(total)}.`,
  ];
  if (recommended && recommended.supplierName !== supplierName) {
    sentences.push(`${recommended.supplierName}, a verified supplier, can supply the order for ${formatKes(recommended.totalKesCents)}.`);
  }
  if (findings.some((finding) => finding.severity === "block")) sentences.push("It needs your attention before any payment.");
  return sentences.join(" ");
}

function numbersIn(text: string): Set<number> {
  const found = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return new Set(found.map((number) => Number(number.replaceAll(",", ""))));
}

// Why the model's text can't be shown, or null if it can. This checks numbers, not meaning: a right
// number attached to the wrong supplier gets through, so the card's own figures stay the record.
export function summaryProblem(text: string, sources: string[]): string | null {
  if (!text) return "empty";
  if (text.length > MAX_LENGTH) return "too_long";
  if (FORBIDDEN.test(text)) return "forbidden_text";
  if (NUMBER_WORDS.test(text)) return "number_in_words";
  const allowed = numbersIn(sources.join(" "));
  return [...numbersIn(text)].every((number) => allowed.has(number)) ? null : "unknown_number";
}

// The numbers behind a finding, which the price check worked out. Item names and supplier names sit
// beside them in the data, but those were read from the photo, so they stay out.
function findingNumbers(data: Record<string, unknown>): Record<string, string | number> {
  const entries = Object.entries(data).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "number" || (typeof entry[1] === "string" && /^\d+(\.\d+)?$/.test(entry[1])),
  );
  return Object.fromEntries(entries);
}

export async function writeOwnerSummary(
  explain: ExplainFindings,
  contactName: string,
  supplier: { name: string; verified: boolean },
  result: PriceCheckResult,
): Promise<WrittenSummary> {
  const template = templateSummary(contactName, supplier.name, result);
  const { quotedTotalKesCents: total, recommended, findings } = result;
  if (total === null) return { summary: template, source: "template" }; // there's nothing to explain yet

  try {
    const facts: SummaryFacts = {
      sentBy: `${contactName}, the foreman on site`, // only a foreman's messages get here; without this, Nova took the sender for the supplier's staff
      quotedSupplier: supplier.verified ? supplier.name : "a supplier Hakika has not verified",
      quotedTotal: formatKes(total),
      recommended: recommended && { supplier: recommended.supplierName, total: formatKes(recommended.totalKesCents) },
      findings: findings.map(({ type, severity, data }) => ({ type, severity, numbers: findingNumbers(data) })),
    };
    const text = await explain(facts);
    // Only what the model was given can come back. Nothing from the photo's words is on this list.
    const reason = summaryProblem(text, [
      facts.quotedTotal,
      facts.recommended?.total ?? "",
      ...facts.findings.flatMap((finding) => Object.values(finding.numbers).map(String)),
    ]);
    return reason
      ? { summary: template, source: "template", rejected: { reason, text } }
      : { summary: text, source: "model" };
  } catch (error) {
    console.error("The owner summary fell back to the template:", describeError(error));
    return { summary: template, source: "template", rejected: { reason: "model_failed" } };
  }
}
