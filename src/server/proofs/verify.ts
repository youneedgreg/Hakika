// The verification engine's fixed checks and outcome rule. Pure functions: no database, no model.
//
// Hard checks (a fail means Suspicious): the code, freshness, duplicate photo and location.
// Soft checks (a fail or unknown means Needs fresh proof): what the vision model sees. Until the
// model reads proofs, the code and the soft checks are "unknown", so no proof is Verified yet.
// The outcome is decided here, in code; a model's output is only ever one input to a check.

import type { ProofCheck, ProofReview } from "@/shared/types";
import { PROOF_LINK_TTL_MS } from "./codes";
import { hammingDistance } from "./dhash";

export type Outcome = ProofReview["outcome"];
export type LatLng = { lat: number; lng: number };
export type Site = LatLng & { radiusM: number };

// Two photos whose dHashes differ by this many bits or fewer are treated as the same photo.
export const DUPLICATE_MAX_BITS = 8;
// GPS accuracy counted towards the site radius, at most. A WhatsApp pin has no accuracy, so it
// must fall inside the radius itself.
export const MAX_ACCURACY_CREDIT_M = 100;
export const FRESHNESS_MS = PROOF_LINK_TTL_MS;

// The code check. `read` is what the vision model read from the photo: undefined while nothing
// has read it, null when it found no code.
export function codeCheck(issued: string, read: string | null | undefined): ProofCheck {
  const base = { name: "code", hard: true } as const;
  if (read === undefined) return { ...base, result: "unknown", detail: "The code hasn't been read from the photo yet." };
  if (read === null || normaliseCode(read) === "") return { ...base, result: "fail", detail: "No code is visible in the photo." };
  if (normaliseCode(read) === normaliseCode(issued)) {
    return { ...base, result: "pass", detail: `Code ${normaliseCode(issued)} matches the issued code.` };
  }
  return { ...base, result: "fail", detail: `The photo shows ${normaliseCode(read)}, but the issued code is ${normaliseCode(issued)}.` };
}

// Ignoring case and spaces, as the roadmap says. Nothing else is forgiven.
export function normaliseCode(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

export function freshnessCheck(issuedAt: Date, receivedAt: Date): ProofCheck {
  const base = { name: "freshness", hard: true } as const;
  const ms = receivedAt.getTime() - issuedAt.getTime();
  if (ms < 0) return { ...base, result: "fail", detail: "The photo arrived before the code was issued." };
  const minutes = Math.round(ms / 60_000);
  if (ms > FRESHNESS_MS) {
    return { ...base, result: "fail", detail: `Uploaded ${minutes} minutes after the code was issued, more than the ${FRESHNESS_MS / 60_000} allowed.` };
  }
  return { ...base, result: "pass", detail: `Uploaded ${plural(minutes, "minute")} after the code was issued.` };
}

export type EarlierProof = { proofId: string; dhash: string; receivedAt: Date; imageUrl: string };

// Compares the photo with every earlier proof in the project and reports the closest one.
export function duplicateCheck(dhash: string, earlier: EarlierProof[]): ProofCheck {
  const base = { name: "duplicate", hard: true } as const;
  let closest: { proof: EarlierProof; bits: number } | undefined;
  for (const proof of earlier) {
    const bits = hammingDistance(dhash, proof.dhash);
    if (!closest || bits < closest.bits) closest = { proof, bits };
  }
  if (!closest) return { ...base, result: "pass", detail: "This is the project's first proof photo." };
  if (closest.bits <= DUPLICATE_MAX_BITS) {
    return {
      ...base, result: "fail",
      detail: `Matches a proof sent on ${dayMonth(closest.proof.receivedAt)} (${plural(closest.bits, "bit")} apart).`,
      evidence: { matchImageUrl: closest.proof.imageUrl, hamming: closest.bits },
    };
  }
  return { ...base, result: "pass", detail: "No earlier proof looks like this photo.", evidence: { hamming: closest.bits } };
}

// Within the site radius plus the reported GPS accuracy (counted up to 100 m). No location at all
// is "unknown": not proof of fraud, but not proof of place either, so fresh proof is asked for.
export function locationCheck(site: Site, capture: (LatLng & { accuracyM: number | null }) | null): ProofCheck {
  const base = { name: "location", hard: true } as const;
  if (!capture) return { ...base, result: "unknown", detail: "No location was shared with the photo." };
  const distanceM = Math.round(distanceMetres(site, capture));
  const credit = accuracyCredit(capture.accuracyM);
  const allowed = site.radiusM + credit;
  const allowance = credit > 0 ? `the ${site.radiusM} m site radius plus ${credit} m GPS accuracy` : `the ${site.radiusM} m site radius`;
  if (distanceM <= allowed) {
    return { ...base, result: "pass", detail: `Taken ${metres(distanceM)} from the site pin, within ${allowance}.`, evidence: { distanceM } };
  }
  return { ...base, result: "fail", detail: `Taken ${metres(distanceM)} from the site pin, outside ${allowance}.`, evidence: { distanceM } };
}

export function accuracyCredit(accuracyM: number | null): number {
  if (accuracyM == null || !Number.isFinite(accuracyM) || accuracyM <= 0) return 0;
  return Math.round(Math.min(accuracyM, MAX_ACCURACY_CREDIT_M));
}

// The vision checks, before the model has looked at the photo.
export function notInspectedChecks(): ProofCheck[] {
  const detail = "Not inspected yet.";
  return [
    { name: "screen_or_print", result: "unknown", hard: false, detail },
    { name: "expected_items", result: "unknown", hard: false, detail },
    { name: "consistency", result: "unknown", hard: false, detail },
  ];
}

// The outcome rule: any hard fail is Suspicious; otherwise any fail or unknown needs fresh proof;
// all passing is Verified. An empty list is never Verified.
export function decideOutcome(checks: ProofCheck[]): Outcome {
  if (checks.some((c) => c.hard && c.result === "fail")) return "suspicious";
  if (checks.length === 0 || checks.some((c) => c.result !== "pass")) return "needs_fresh_proof";
  return "verified";
}

// A fixed-template explanation built from the checks, so every sentence traces to a check.
export function explainOutcome(outcome: Outcome, checks: ProofCheck[]): string {
  if (outcome === "verified") return "Every check passed.";
  if (outcome === "suspicious") {
    const failed = checks.filter((c) => c.hard && c.result === "fail").map((c) => c.detail);
    return `Suspicious. ${failed.join(" ")}`;
  }
  const open = checks.filter((c) => c.result !== "pass");
  const failed = open.filter((c) => c.result === "fail").map((c) => c.detail);
  const unknown = open.filter((c) => c.result === "unknown").map((c) => CHECK_LABELS[c.name]);
  const parts = [...failed];
  if (unknown.length) parts.push(`Not yet confirmed: ${list(unknown)}.`);
  return `Fresh proof needed. ${parts.join(" ")}`.trim();
}

const CHECK_LABELS: Record<ProofCheck["name"], string> = {
  code: "the code",
  freshness: "the time",
  duplicate: "that the photo is new",
  location: "the location",
  screen_or_print: "that it isn't a photo of a screen or print",
  expected_items: "the items delivered",
  consistency: "that it matches the site",
};

// Great-circle distance in metres (haversine, mean Earth radius).
export function distanceMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function metres(m: number): string {
  if (m < 1000) return `${m} m`;
  const km = Math.round(m / 100) / 10;
  return `${km} km`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function dayMonth(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Nairobi" });
}
