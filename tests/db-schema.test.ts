// Applies the real migrations to an in-memory Postgres (PGlite) and checks the constraints
// that keep money and proof records honest. No network, no secrets: runs the same in CI.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { newId } from "@/server/db/ids";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle({ client, schema, casing: "snake_case" });

// Drizzle wraps driver errors; the constraint name is in the cause.
async function expectViolation(query: Promise<unknown>, constraint: string) {
  const error = await query.then(() => null, (e: unknown) => e);
  expect(error, `expected ${constraint} to be violated`).not.toBeNull();
  const cause = (error as { cause?: { constraint?: string; message?: string } }).cause;
  expect(cause?.constraint ?? cause?.message).toContain(constraint);
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await db.insert(schema.user).values({ id: "u-wanjiru", name: "Wanjiru Kamau", email: "wanjiru@example.test" });
  await db.insert(schema.projects).values({
    id: "p1", ownerId: "u-wanjiru", name: "Test house", siteLabel: "Nyeri",
    siteLat: -0.42, siteLng: 36.95, siteRadiusM: 150, budgetKesCents: 450_000_000,
  });
  await db.insert(schema.suppliers).values({ id: "s1", name: "Mlima Hardware", area: "Nyeri", verified: true });
  await db.insert(schema.siteContacts).values({
    id: "c1", projectId: "p1", name: "Otieno", role: "fundi", whatsappNumber: "+254700000001", language: "sw",
  });
  await db.insert(schema.milestones).values({
    id: "m1", projectId: "p1", position: 1, name: "Foundation", plannedStart: "2026-10-05", plannedEnd: "2026-10-31",
  });
  await db.insert(schema.requests).values({ id: "r1", projectId: "p1", milestoneId: "m1" });
});

const materials = (over: Partial<typeof schema.payments.$inferInsert> = {}) => ({
  projectId: "p1", kind: "materials" as const, requestId: "r1", payeeSupplierId: "s1",
  payeeEmail: "mlima@example.test", amountKesCents: 3_500_000, amountUsdCents: 27_100,
  kesPerUsd: "129.150000", paypalRequestId: newId("pay"), ...over,
});

describe("database schema", () => {
  it("applies the migrations and uses the default statuses", async () => {
    const [request] = await db.select().from(schema.requests);
    expect(request.status).toBe("received");
    const [milestone] = await db.select().from(schema.milestones);
    expect(milestone.status).toBe("planned");
  });

  it("gives new rows prefixed random IDs", async () => {
    const [row] = await db.insert(schema.suppliers)
      .values({ name: "Kiawara Builders Supplies", area: "Kiawara" }).returning();
    expect(row.id).toMatch(/^sup_[\w-]{16}$/);
  });

  it("accepts a materials payment to a supplier", async () => {
    const [row] = await db.insert(schema.payments).values(materials()).returning();
    expect(row.status).toBe("created");
  });

  it("rejects a materials payment addressed to a site contact", async () => {
    await expectViolation(
      db.insert(schema.payments).values(materials({ payeeContactId: "c1" })),
      "payments_kind_matches_payee",
    );
  });

  it("rejects a labour payment without a milestone", async () => {
    await expectViolation(
      db.insert(schema.payments).values(materials({
        kind: "labour", requestId: null, payeeSupplierId: null, payeeContactId: "c1",
      })),
      "payments_kind_matches_payee",
    );
  });

  it("rejects zero or negative amounts", async () => {
    await expectViolation(
      db.insert(schema.payments).values(materials({ amountUsdCents: 0 })),
      "payments_amounts_positive",
    );
  });

  it("rejects a reused PayPal-Request-Id", async () => {
    const paypalRequestId = newId("pay");
    await db.insert(schema.payments).values(materials({ paypalRequestId }));
    await expectViolation(
      db.insert(schema.payments).values(materials({ paypalRequestId })),
      "payments_paypal_request_id_unique",
    );
  });

  it("rejects a captured payment with no capture ID", async () => {
    await expectViolation(
      db.insert(schema.payments).values(materials({ status: "captured" })),
      "payments_captured_has_capture_id",
    );
  });

  it("rejects a dHash that is not 16 hex characters", async () => {
    await expectViolation(
      db.insert(schema.proofs).values({
        projectId: "p1", source: "capture_page", blobPath: "proofs/x.jpg",
        contentType: "image/jpeg", sizeBytes: 1000, dhash: "not-a-hash",
      }),
      "proofs_dhash_hex",
    );
  });

  it("rejects an override without a reason", async () => {
    const [proof] = await db.insert(schema.proofs).values({
      projectId: "p1", source: "capture_page", blobPath: "proofs/y.jpg",
      contentType: "image/jpeg", sizeBytes: 1000, dhash: "0f0f0f0f0f0f0f0f",
    }).returning();
    await expectViolation(
      db.insert(schema.verdicts).values({
        proofId: proof.id, outcome: "suspicious", checks: [], explanation: "Held.",
        overriddenAt: new Date(), overriddenBy: "u-wanjiru",
      }),
      "verdicts_override_has_reason",
    );
  });

  it("ignores nothing silently: a repeated webhook event ID is rejected", async () => {
    const event = { provider: "paypal" as const, eventId: "WH-1", type: "PAYMENT.CAPTURE.COMPLETED", payload: {} };
    await db.insert(schema.webhookEvents).values(event);
    await expectViolation(
      db.insert(schema.webhookEvents).values(event),
      "webhook_events_provider_event_id_unique",
    );
  });

  it("rejects a proof request that expires before it is issued", async () => {
    await expectViolation(
      db.insert(schema.proofRequests).values({
        projectId: "p1", milestoneId: "m1", purpose: "progress", code: "K7P3",
        tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() - 60_000),
      }),
      "proof_requests_expiry_after_issue",
    );
  });
});
