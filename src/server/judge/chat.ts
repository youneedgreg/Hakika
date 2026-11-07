// The simulator's conversation for Judge Mode's phone frame, and the reset with its cooldown.

import { and, asc, eq, gt } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import { DEMO, type DemoPayees, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import type { JudgeChatMessage } from "@/shared/api";

export const CHAT_LIMIT = 200;

// Messages on the simulator channel only: real WhatsApp messages from test phones never show here.
export async function loadJudgeChat(db: AnyDb, projectId: string, after?: Date): Promise<JudgeChatMessage[]> {
  const rows = await db.select({
    message: s.messages,
    contact: { id: s.siteContacts.id, name: s.siteContacts.name, role: s.siteContacts.role },
  }).from(s.messages)
    .leftJoin(s.siteContacts, eq(s.siteContacts.id, s.messages.contactId))
    .where(and(
      eq(s.messages.projectId, projectId),
      eq(s.messages.channel, "simulator"),
      after ? gt(s.messages.createdAt, after) : undefined,
    ))
    .orderBy(asc(s.messages.createdAt), asc(s.messages.id))
    .limit(CHAT_LIMIT);

  return rows.map(({ message: m, contact }) => ({
    id: m.id,
    at: m.createdAt.toISOString(),
    direction: m.direction,
    contact: contact?.id ? contact : null,
    kind: m.kind,
    text: m.body,
    ...(m.mediaPath && m.mediaContentType?.startsWith("image/") ? { imageUrl: judgeMessageImageUrl(m.id) } : {}),
    ...(m.latitude != null && m.longitude != null ? { location: { lat: m.latitude, lng: m.longitude } } : {}),
    ...(m.templateKey ? { templateKey: m.templateKey } : {}),
  }));
}

export function judgeMessageImageUrl(messageId: string): string {
  return `/api/judge/messages/${messageId}/image`;
}

// The stored photo of a simulated message, or null when it isn't one.
export async function judgeMessageMedia(db: AnyDb, messageId: string): Promise<{ path: string; contentType: string } | null> {
  const [m] = await db.select({ path: s.messages.mediaPath, contentType: s.messages.mediaContentType, channel: s.messages.channel })
    .from(s.messages).where(eq(s.messages.id, messageId));
  if (!m?.path || m.channel !== "simulator" || !m.contentType?.startsWith("image/")) return null;
  return { path: m.path, contentType: m.contentType };
}

// Every judge shares one demo project, so a reset is refused for a short while after the last one:
// two judges clicking at once can't keep wiping each other's runs.
export const RESET_COOLDOWN_S = 30;

export async function resetJudgeDemo(
  db: AnyDb,
  payees: DemoPayees,
  now = new Date(),
): Promise<{ reset: true } | { reset: false; retryAfterS: number }> {
  const [project] = await db.select({ createdAt: s.projects.createdAt }).from(s.projects).where(eq(s.projects.id, DEMO.projectId));
  const sinceS = project ? (now.getTime() - project.createdAt.getTime()) / 1000 : Infinity;
  if (sinceS < RESET_COOLDOWN_S) return { reset: false, retryAfterS: Math.ceil(RESET_COOLDOWN_S - sinceS) };
  await resetDemo(db, payees);
  return { reset: true };
}
