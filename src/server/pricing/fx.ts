// The day's USD/KES rate: fetched once a day and kept in fx_rates, so every price that day uses the
// same rate. The provider's free endpoint needs no key but requires attribution on the site.

import { desc, eq, lte } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import { fxRates } from "@/server/db/schema";

const PROVIDER_URL = "https://open.er-api.com/v6/latest/USD";
const PROVIDER_SOURCE = "open.er-api.com";
const MIN_KES_PER_USD = 50; // outside these limits the provider's answer is wrong, not the market
const MAX_KES_PER_USD = 500;
const MAX_STALE_DAYS = 3; // an older rate would misstate what a payment costs, so it's refused
const DAY_MS = 86_400_000;

export class FxRateUnavailable extends Error {}

export type DailyRate = { day: string; kesPerUsd: string; source: string; stale: boolean };

export function nairobiDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(now);
}

// Six decimals, as fx_rates stores it. Throws on anything but a successful, believable answer.
export function parseProviderRate(body: unknown): string {
  const { result, rates } = (body ?? {}) as { result?: unknown; rates?: { KES?: unknown } };
  const rate = rates?.KES;
  if (result !== "success" || typeof rate !== "number" || !(rate >= MIN_KES_PER_USD && rate <= MAX_KES_PER_USD)) {
    throw new FxRateUnavailable("The exchange rate provider gave no usable USD/KES rate.");
  }
  return rate.toFixed(6);
}

export async function fetchProviderRate(): Promise<string> {
  const response = await fetch(PROVIDER_URL, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new FxRateUnavailable(`The exchange rate provider answered HTTP ${response.status}.`);
  return parseProviderRate(await response.json());
}

export async function getDailyRate(
  db: AnyDb,
  { now = new Date(), fetchRate = fetchProviderRate }: { now?: Date; fetchRate?: () => Promise<string> } = {},
): Promise<DailyRate> {
  const day = nairobiDay(now);
  const fresh = (row: typeof fxRates.$inferSelect): DailyRate =>
    ({ day: row.day, kesPerUsd: row.kesPerUsd, source: row.source, stale: false });

  const [today] = await db.select().from(fxRates).where(eq(fxRates.day, day));
  if (today) return fresh(today);

  try {
    const kesPerUsd = await fetchRate();
    // Two requests can race on a new day; the first rate stored is the day's rate for both.
    await db.insert(fxRates).values({ day, kesPerUsd, source: PROVIDER_SOURCE }).onConflictDoNothing();
    const [stored] = await db.select().from(fxRates).where(eq(fxRates.day, day));
    return fresh(stored);
  } catch (error) {
    const [latest] = await db.select().from(fxRates).where(lte(fxRates.day, day)).orderBy(desc(fxRates.day)).limit(1);
    const ageDays = latest ? (Date.parse(day) - Date.parse(latest.day)) / DAY_MS : Infinity;
    if (ageDays > MAX_STALE_DAYS) {
      throw new FxRateUnavailable("No exchange rate from the last three days is available.", { cause: error });
    }
    return { ...fresh(latest), stale: true };
  }
}
