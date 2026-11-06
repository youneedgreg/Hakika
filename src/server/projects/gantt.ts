// The Gantt timeline from the database: each milestone, then the labour payment its verification
// unlocks, as a payment gate between it and the next milestone.
//
// A milestone shows as "held" when its own status is held or a request on it is held: the same
// rule that stops payments (src/server/proofs/holds.ts). Its gate is open ("verified") only once
// the milestone is verified, and done ("paid") once the labour is paid.

import { and, asc, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { GanttData } from "@/shared/api";
import type { GanttTask, MilestoneStatus } from "@/shared/types";

// There's no measured progress, so the bar shows how far along the milestone's states it is.
const PERCENT_DONE: Record<MilestoneStatus, number> = {
  planned: 0, in_progress: 50, awaiting_proof: 90, held: 90, verified: 100, paid: 100,
};

export async function loadGantt(db: AnyDb, projectId: string): Promise<GanttData | null> {
  const [project] = await db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, projectId));
  if (!project) return null;

  const milestones = await db.select().from(s.milestones)
    .where(eq(s.milestones.projectId, projectId)).orderBy(asc(s.milestones.position));
  const heldRequests = await db.select({ milestoneId: s.requests.milestoneId }).from(s.requests)
    .where(and(eq(s.requests.projectId, projectId), eq(s.requests.status, "held")));
  const heldByRequest = new Set(heldRequests.map((r) => r.milestoneId));

  const tasks: GanttTask[] = [];
  const links: { fromTask: string; toTask: string }[] = [];
  const gateOf = new Map<string, string>();
  const link = (fromTask: string, toTask: string) => links.push({ fromTask, toTask });

  for (const m of milestones) {
    const status: MilestoneStatus = heldByRequest.has(m.id) && m.status !== "paid" ? "held" : m.status;
    tasks.push({
      id: m.id, name: m.name, startDate: m.plannedStart, endDate: m.plannedEnd,
      percentDone: PERCENT_DONE[status], status, kind: "work",
    });
    if (m.labourKesCents !== null) {
      const gateId = `g${m.position}`;
      gateOf.set(m.id, gateId);
      tasks.push({
        id: gateId, name: `Labour payment: ${m.name}`, startDate: m.plannedEnd, endDate: m.plannedEnd,
        percentDone: status === "paid" ? 100 : 0, status, kind: "payment_gate",
      });
      link(m.id, gateId);
    }
  }
  // Each milestone waits for the one before it, through that one's payment gate when it has one.
  for (const m of milestones) {
    if (m.dependsOnId) link(gateOf.get(m.dependsOnId) ?? m.dependsOnId, m.id);
  }
  // In timeline order, numbered d1, d2, …
  const position = new Map(tasks.map((t, i) => [t.id, i]));
  links.sort((a, b) => position.get(a.fromTask)! - position.get(b.fromTask)!);
  return { tasks, dependencies: links.map((l, i) => ({ id: `d${i + 1}`, ...l })) };
}
