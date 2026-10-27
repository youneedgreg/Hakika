// Text primary keys: a short prefix that says what the row is, then 96 random bits.
// The demo seed uses fixed, readable IDs instead (demo-nyeri, m2, ...), matching the mock data.

import { randomBytes } from "node:crypto";

export const ID_PREFIXES = {
  project: "prj",
  milestone: "ms",
  materialPlanLine: "mpl",
  siteContact: "ct",
  supplier: "sup",
  supplierPrice: "sp",
  priceReference: "pref",
  request: "req",
  requestLine: "rl",
  finding: "fnd",
  payment: "pay",
  proofRequest: "prq",
  proof: "prf",
  verdict: "vrd",
  message: "msg",
  auditEvent: "aud",
  webhookEvent: "whe",
} as const;

export function newId(prefix: (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES]): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}
