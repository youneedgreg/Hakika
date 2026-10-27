// The demo seed on an in-memory Postgres: it matches the mock IDs the UI already uses,
// and resetting twice, even after the story has created payments and proofs, starts clean.

import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO, resetDemo } from "@/server/db/demo";
import * as s from "@/server/db/schema";
import { projectDetails } from "@/server/mocks/demo";

const db = drizzle({ client: new PGlite(), schema: s, casing: "snake_case" });
const payees = { mlima: "mlima@sandbox.example", otieno: "otieno@sandbox.example" };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await resetDemo(db, payees);
}, 60_000);

describe("demo seed", () => {
  it("uses the same IDs and names as the mock data", async () => {
    const [project] = await db.select().from(s.projects).where(eq(s.projects.id, DEMO.projectId));
    expect(project.name).toBe(projectDetails.name);

    const milestones = await db.select().from(s.milestones).orderBy(asc(s.milestones.position));
    expect(milestones.map((m) => [m.id, m.name])).toEqual(projectDetails.milestones.map((m) => [m.id, m.name]));

    const contacts = await db.select().from(s.siteContacts);
    expect(contacts.map((c) => c.id).sort()).toEqual(projectDetails.contacts.map((c) => c.id).sort());

    const suppliers = await db.select().from(s.suppliers);
    expect(suppliers.map((x) => x.id).sort()).toEqual(projectDetails.suppliers.map((x) => x.id).sort());
  });

  it("starts the story with excavation done and the foundation under way", async () => {
    const milestones = await db.select().from(s.milestones).orderBy(asc(s.milestones.position));
    expect(milestones.map((m) => m.status)).toEqual(["paid", "in_progress", "planned", "planned", "planned"]);
    expect(milestones.map((m) => m.dependsOnId)).toEqual([null, "m1", "m2", "m3", "m4"]);
  });

  it("plans the foundation materials the cement story checks against", async () => {
    const lines = await db.select().from(s.materialPlanLines).where(eq(s.materialPlanLines.milestoneId, "m2"));
    expect(lines.find((l) => l.itemKey === "cement_50kg")?.qty).toBe(120);
  });

  it("prices cement so a verified supplier beats the quote", async () => {
    const [reference] = await db.select().from(s.priceReferences).where(eq(s.priceReferences.itemKey, "cement_50kg"));
    expect(reference.medianKesCents).toBe(78_000);
    const mlima = await db.select().from(s.supplierPrices).where(eq(s.supplierPrices.supplierId, DEMO.supplierIds.mlima));
    expect(mlima.find((p) => p.itemKey === "cement_50kg")?.unitPriceKesCents).toBe(79_000);
  });

  it("takes payee emails from the caller and leaves missing ones empty", async () => {
    const suppliers = await db.select().from(s.suppliers);
    expect(suppliers.find((x) => x.id === DEMO.supplierIds.mlima)?.paypalEmail).toBe(payees.mlima);
    expect(suppliers.find((x) => x.id === DEMO.supplierIds.kiawara)?.paypalEmail).toBeNull();
  });

  it("resets cleanly after the story has created requests, payments and proofs", async () => {
    await db.insert(s.requests).values({ id: "r-story", projectId: DEMO.projectId, milestoneId: "m2" });
    const [payment] = await db.insert(s.payments).values({
      projectId: DEMO.projectId, kind: "materials", requestId: "r-story", payeeSupplierId: DEMO.supplierIds.mlima,
      payeeEmail: payees.mlima, amountKesCents: 3_950_000, amountUsdCents: 30_573, kesPerUsd: "129.200000",
      paypalRequestId: "req-story-1", paypalOrderId: "ORDER1", paypalCaptureId: "CAPTURE1",
      status: "captured", capturedAt: new Date(),
    }).returning();
    await db.insert(s.proofs).values({
      projectId: DEMO.projectId, source: "capture_page", blobPath: "proofs/a.jpg",
      contentType: "image/jpeg", sizeBytes: 1, dhash: "0123456789abcdef",
    });
    await db.insert(s.auditEvents).values({
      projectId: DEMO.projectId, kind: "payment", action: "payment.captured", actor: "system",
      description: "Paid", paymentId: payment.id,
    });

    await resetDemo(db, payees);

    expect(await db.select().from(s.requests)).toHaveLength(0);
    expect(await db.select().from(s.payments)).toHaveLength(0);
    expect(await db.select().from(s.proofs)).toHaveLength(0);
    const events = await db.select().from(s.auditEvents);
    expect(events.map((e) => e.action)).toEqual(["milestone.imported"]);
    expect(await db.select().from(s.milestones)).toHaveLength(5);
    expect(await db.select().from(s.user)).toHaveLength(1);
  });
});
