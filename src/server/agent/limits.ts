// How many questions Ask Hakika takes, so the public demo (no login yet) can't run up the Bedrock
// bill. A question is counted before the model is called, whether or not it is answered.
//
// The count is taken and the question recorded under one lock, so parallel requests can't slip
// past the limit together. Only the time and a keyed hash of the IP address are kept, for 2 days.

import { createHmac } from "node:crypto";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";

export const QUESTIONS_PER_DAY = 100; // across everyone, in any 24 hours
export const QUESTIONS_PER_IP_HOUR = 10;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KEEP_MS = 2 * DAY_MS;
const LOCK_KEY = 4_247_001; // any fixed number: one advisory lock for the question count

export const LIMIT_MESSAGES = {
  daily: "Ask Hakika has answered all the questions it takes today. Try again tomorrow.",
  ip: "You've asked a lot of questions in the last hour. Try again later.",
} as const;

export type Claim = { ok: true } | { ok: false; limit: keyof typeof LIMIT_MESSAGES; retryAfterS: number };

// The client's IP on Vercel, which sets these headers itself (a caller can't spoof them there).
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-vercel-forwarded-for") ?? headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

// Keyed, so the stored value can't be turned back into an address by hashing every IPv4 address.
export function hashIp(ip: string, key = process.env.ASK_IP_HASH_KEY): string {
  if (!key && process.env.VERCEL_ENV === "production") console.warn("ASK_IP_HASH_KEY is not set: IP hashes are unkeyed.");
  return createHmac("sha256", key || "hakika-local-only").update(ip).digest("hex").slice(0, 32);
}

export async function claimQuestion(
  db: AnyDb,
  { projectId, ip, now = new Date() }: { projectId: string; ip: string; now?: Date },
): Promise<Claim> {
  const ipHash = hashIp(ip);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    await tx.delete(s.agentQuestions).where(lt(s.agentQuestions.askedAt, new Date(now.getTime() - KEEP_MS)));

    const dayAgo = new Date(now.getTime() - DAY_MS);
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    const [today] = await tx.select({ n: count() }).from(s.agentQuestions).where(gte(s.agentQuestions.askedAt, dayAgo));
    if (today.n >= QUESTIONS_PER_DAY) return { ok: false, limit: "daily", retryAfterS: 60 * 60 };
    const [fromIp] = await tx.select({ n: count() }).from(s.agentQuestions)
      .where(and(eq(s.agentQuestions.ipHash, ipHash), gte(s.agentQuestions.askedAt, hourAgo)));
    if (fromIp.n >= QUESTIONS_PER_IP_HOUR) return { ok: false, limit: "ip", retryAfterS: 15 * 60 };

    await tx.insert(s.agentQuestions).values({ projectId, ipHash, askedAt: now });
    return { ok: true };
  });
}
