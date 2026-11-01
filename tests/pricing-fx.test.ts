// The daily rate on an in-memory Postgres, and the provider's answer as its documentation shows it.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { FxRateUnavailable, getDailyRate, nairobiDay, parseProviderRate } from "@/server/pricing/fx";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" }) as unknown as AnyDb;
const NOW = new Date("2026-11-01T07:00:00Z");

beforeAll(async () => {
  await migrate(db as never, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  await db.delete(s.fxRates);
});

describe("the provider's answer", () => {
  // The shape at https://www.exchangerate-api.com/docs/free
  const answer = (rates: Record<string, unknown>, result = "success") => ({
    result,
    provider: "https://www.exchangerate-api.com",
    time_last_update_utc: "Sun, 01 Nov 2026 00:02:31 +0000",
    base_code: "USD",
    rates: { USD: 1, ...rates },
  });

  it("reads the KES rate to six decimals", () => {
    expect(parseProviderRate(answer({ KES: 129.901648 }))).toBe("129.901648");
  });

  it.each([
    ["a failed result", answer({ KES: 129.9 }, "error")],
    ["no KES rate", answer({})],
    ["a rate as text", answer({ KES: "129.9" })],
    ["an unbelievably low rate", answer({ KES: 1 })],
    ["an unbelievably high rate", answer({ KES: 100_000 })],
    ["no body", null],
  ])("refuses %s", (_name, body) => {
    expect(() => parseProviderRate(body)).toThrow(FxRateUnavailable);
  });
});

describe("the day", () => {
  it("changes at midnight in Nairobi, not in UTC", () => {
    expect(nairobiDay(new Date("2026-11-01T20:59:00Z"))).toBe("2026-11-01");
    expect(nairobiDay(new Date("2026-11-01T21:00:00Z"))).toBe("2026-11-02");
  });
});

describe("the daily rate", () => {
  it("fetches once and reuses the stored rate for the rest of the day", async () => {
    const fetchRate = vi.fn().mockResolvedValue("129.901648");

    const first = await getDailyRate(db, { now: NOW, fetchRate });
    const second = await getDailyRate(db, { now: new Date("2026-11-01T20:00:00Z"), fetchRate });

    expect(first).toEqual({ day: "2026-11-01", kesPerUsd: "129.901648", source: "open.er-api.com", stale: false });
    expect(second).toEqual(first);
    expect(fetchRate).toHaveBeenCalledTimes(1);
  });

  it("fetches again on a new day", async () => {
    await getDailyRate(db, { now: NOW, fetchRate: async () => "129.000000" });
    const next = await getDailyRate(db, { now: new Date("2026-11-02T07:00:00Z"), fetchRate: async () => "130.000000" });
    expect(next).toMatchObject({ day: "2026-11-02", kesPerUsd: "130.000000", stale: false });
  });

  it("keeps the first rate when two requests race", async () => {
    const [a, b] = await Promise.all([
      getDailyRate(db, { now: NOW, fetchRate: async () => "129.000000" }),
      getDailyRate(db, { now: NOW, fetchRate: async () => "131.000000" }),
    ]);
    expect(a.kesPerUsd).toBe(b.kesPerUsd);
    expect(await db.select().from(s.fxRates)).toHaveLength(1);
  });

  it("falls back to a recent rate, marked stale, when the provider fails", async () => {
    await getDailyRate(db, { now: new Date("2026-10-29T07:00:00Z"), fetchRate: async () => "129.000000" });
    const rate = await getDailyRate(db, { now: NOW, fetchRate: () => Promise.reject(new Error("down")) });
    expect(rate).toMatchObject({ day: "2026-10-29", kesPerUsd: "129.000000", stale: true });
  });

  it("refuses a rate more than three days old", async () => {
    await getDailyRate(db, { now: new Date("2026-10-28T07:00:00Z"), fetchRate: async () => "129.000000" });
    await expect(getDailyRate(db, { now: NOW, fetchRate: () => Promise.reject(new Error("down")) }))
      .rejects.toThrow(FxRateUnavailable);
  });

  it("refuses when the provider fails and no rate is stored", async () => {
    await expect(getDailyRate(db, { now: NOW, fetchRate: () => Promise.reject(new Error("down")) }))
      .rejects.toThrow(FxRateUnavailable);
  });
});
