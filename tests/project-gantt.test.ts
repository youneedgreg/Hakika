// The Gantt from the database, on an in-memory Postgres: statuses, payment gates and holds.

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { loadGantt } from "@/server/projects/gantt";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const gantt = async () => (await loadGantt(db, DEMO.projectId))!;
const task = async (id: string) => (await gantt()).tasks.find((t) => t.id === id)!;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

beforeEach(async () => {
  await db.delete(s.requests);
  await resetDemo(db);
});

describe("the Gantt", () => {
  it("is null for an unknown project", async () => {
    expect(await loadGantt(db, "nope")).toBeNull();
  });

  it("puts each milestone's labour payment gate after it, and chains the milestones through the gates", async () => {
    const { tasks, dependencies } = await gantt();
    expect(tasks.map((t) => t.id)).toEqual(["m1", "g1", "m2", "g2", "m3", "g3", "m4", "g4", "m5", "g5"]);
    expect(tasks.slice(0, 4)).toEqual([
      { id: "m1", name: "Setting out and excavation", startDate: "2026-09-21", endDate: "2026-10-03", percentDone: 100, status: "paid", kind: "work" },
      { id: "g1", name: "Labour payment: Setting out and excavation", startDate: "2026-10-03", endDate: "2026-10-03", percentDone: 100, status: "paid", kind: "payment_gate" },
      { id: "m2", name: "Foundation", startDate: "2026-10-05", endDate: "2026-10-31", percentDone: 50, status: "in_progress", kind: "work" },
      { id: "g2", name: "Labour payment: Foundation", startDate: "2026-10-31", endDate: "2026-10-31", percentDone: 0, status: "in_progress", kind: "payment_gate" },
    ]);
    expect(dependencies.slice(0, 4)).toEqual([
      { id: "d1", fromTask: "m1", toTask: "g1" },
      { id: "d2", fromTask: "g1", toTask: "m2" },
      { id: "d3", fromTask: "m2", toTask: "g2" },
      { id: "d4", fromTask: "g2", toTask: "m3" },
    ]);
    const ids = new Set(tasks.map((t) => t.id));
    expect(dependencies.every((d) => ids.has(d.fromTask) && ids.has(d.toTask))).toBe(true);
  });

  it("shows a milestone and its gate as held while a request on it is held", async () => {
    await db.insert(s.requests).values({ projectId: DEMO.projectId, milestoneId: "m2", contactId: DEMO.contactIds.peter, status: "held" });
    expect(await task("m2")).toMatchObject({ status: "held", percentDone: 90 });
    expect(await task("g2")).toMatchObject({ status: "held", percentDone: 0 });
    expect(await task("m3")).toMatchObject({ status: "planned" });
  });

  it("shows a held milestone as held, and a verified one with its gate open", async () => {
    await db.update(s.milestones).set({ status: "held" }).where(eq(s.milestones.id, "m2"));
    expect((await task("g2")).status).toBe("held");
    await db.update(s.milestones).set({ status: "verified" }).where(eq(s.milestones.id, "m2"));
    expect(await task("g2")).toMatchObject({ status: "verified", percentDone: 0 });
  });

  it("has no gate for a milestone with no labour payment", async () => {
    await db.update(s.milestones).set({ labourKesCents: null }).where(eq(s.milestones.id, "m3"));
    const { tasks, dependencies } = await gantt();
    expect(tasks.some((t) => t.id === "g3")).toBe(false);
    expect(dependencies).toContainEqual(expect.objectContaining({ fromTask: "m3", toTask: "m4" }));
  });
});
