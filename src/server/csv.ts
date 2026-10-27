// CSV export of the money trail.

import type { LedgerRow } from "@/shared/api";

const LEDGER_COLUMNS = [
  "at", "kind", "description", "amount", "currency", "amount_usd",
  "paypal_order_id", "paypal_capture_id", "request_id", "proof_id",
] as const;

export function ledgerToCsv(rows: LedgerRow[]): string {
  const lines = rows.map((r) =>
    [
      r.at, r.kind, r.description, r.amount?.amount, r.amount?.currency, r.amountUsd?.amount,
      r.paypalOrderId, r.paypalCaptureId, r.link.requestId, r.link.proofId,
    ].map(csvCell).join(","),
  );
  return [LEDGER_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
}

// Quotes cells that need it, and defuses spreadsheet formulas (cells starting with = + - @).
export function csvCell(value: string | undefined): string {
  if (value === undefined) return "";
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
