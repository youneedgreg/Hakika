// The cap on Ask Hakika's questions: per day across everyone, per hour from one IP address, counted
// before the model is called. Only a keyed hash of the address is stored.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimQuestion, clientIp, hashIp, QUESTIONS_PER_DAY, QUESTIONS_PER_IP_HOUR } from "@/server/agent/limits";
import * as s from "@/server/db/schema";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const now = new Date("2026-11-08T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const claim = (ip = "203.0.113.7", at = now) => claimQuestion(db, { projectId: "prj_demo", ip, now: at });
const asked = (count: number, ip: string, at: Date) =>
  db.insert(s.agentQuestions).values(Array.from({ length: count }, () => ({ projectId: "prj_demo", ipHash: hashIp(ip), askedAt: at })));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  await db.delete(s.agentQuestions);
});

describe("claimQuestion", () => {
  it("records each question it allows, with a hash of the IP and never the address", async () => {
    expect(await claim()).toEqual({ ok: true });
    const rows = await db.select().from(s.agentQuestions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId: "prj_demo", ipHash: hashIp("203.0.113.7"), askedAt: now });
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });

  it(`refuses an IP's ${QUESTIONS_PER_IP_HOUR + 1}th question in an hour, but not another IP's`, async () => {
    await asked(QUESTIONS_PER_IP_HOUR, "203.0.113.7", minutesAgo(30));
    expect(await claim()).toEqual({ ok: false, limit: "ip", retryAfterS: 900 });
    expect(await claim("198.51.100.2")).toEqual({ ok: true });
  });

  it("lets an IP ask again once its questions are over an hour old", async () => {
    await asked(QUESTIONS_PER_IP_HOUR, "203.0.113.7", minutesAgo(61));
    expect(await claim()).toEqual({ ok: true });
  });

  it(`refuses everyone after ${QUESTIONS_PER_DAY} questions in 24 hours`, async () => {
    for (let i = 0; i < QUESTIONS_PER_DAY / QUESTIONS_PER_IP_HOUR; i += 1) {
      await asked(QUESTIONS_PER_IP_HOUR, `198.51.100.${i}`, minutesAgo(60 * (i + 1)));
    }
    expect(await claim()).toEqual({ ok: false, limit: "daily", retryAfterS: 3600 });
    expect(await db.$count(s.agentQuestions)).toBe(QUESTIONS_PER_DAY); // a refused question isn't recorded
  });

  it("deletes questions older than 2 days", async () => {
    await asked(3, "203.0.113.7", minutesAgo(49 * 60));
    await asked(2, "203.0.113.7", minutesAgo(47 * 60));
    await claim("198.51.100.2");
    expect(await db.$count(s.agentQuestions)).toBe(3);
  });

  it("counts parallel questions without letting extra ones through", async () => {
    await asked(QUESTIONS_PER_IP_HOUR - 2, "203.0.113.7", minutesAgo(5));
    const results = await Promise.all(Array.from({ length: 5 }, () => claim()));
    expect(results.filter((result) => result.ok)).toHaveLength(2);
  });
});

describe("clientIp and hashIp", () => {
  it("reads Vercel's header first, then the first forwarded address", () => {
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("hashes with the key, so the same address gives a different hash under another key", () => {
    expect(hashIp("203.0.113.7", "key-a")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp("203.0.113.7", "key-a")).toBe(hashIp("203.0.113.7", "key-a"));
    expect(hashIp("203.0.113.7", "key-a")).not.toBe(hashIp("203.0.113.7", "key-b"));
    expect(hashIp("203.0.113.7", "key-a")).not.toBe(hashIp("203.0.113.8", "key-a"));
  });
});
