// The demo project: Wanjiru's house in Nyeri, at the start of the story (the foundation is under way).
// resetDemo() rebuilds it from scratch; Judge Mode's reset and `npm run db:seed` both call it.
// IDs match src/server/mocks/demo.ts, so the UI keeps working as each route switches from mocks.
// Everyone and every business here is fictional. Prices are placeholders until Juliet's price sheet.

import { eq, inArray } from "drizzle-orm";
import type { AnyDb } from "./client";
import * as s from "./schema";

export const DEMO = {
  projectId: "demo-nyeri",
  ownerId: "demo-owner-wanjiru",
  milestoneIds: ["m1", "m2", "m3", "m4", "m5"],
  contactIds: { peter: "c-peter", otieno: "c-otieno", grace: "c-grace" },
  supplierIds: { mlima: "s-mlima", kiawara: "s-kiawara" },
} as const;

// PayPal sandbox emails come from the environment, never from the repo.
export type DemoPayees = { mlima?: string; kiawara?: string; otieno?: string };

const PLACEHOLDER = "placeholder until Juliet's price sheet";
const PRICED_ON = "2026-10-20";
const kes = (shillings: number) => Math.round(shillings * 100);

const priceReferences = [
  { itemKey: "cement_50kg", description: "Cement, 50 kg bag", unit: "bag", median: 780 },
  { itemKey: "steel_y12", description: "Y12 steel bar", unit: "bar", median: 1150 },
  { itemKey: "ballast", description: "Ballast", unit: "tonne", median: 2000 },
  { itemKey: "stone_machine_cut", description: "Machine-cut stone", unit: "piece", median: 58 },
  { itemKey: "roofing_sheet", description: "Roofing sheet", unit: "sheet", median: 1050 },
];

// Unit prices in KES. Mlima is the cheaper cement supplier, which the story relies on (KES 790 a bag).
const supplierPrices: Record<string, Record<string, number>> = {
  [DEMO.supplierIds.mlima]: {
    cement_50kg: 790, steel_y12: 1180, ballast: 2100, stone_machine_cut: 60, roofing_sheet: 1040,
  },
  [DEMO.supplierIds.kiawara]: {
    cement_50kg: 820, steel_y12: 1150, ballast: 1950, stone_machine_cut: 57, roofing_sheet: 1100,
  },
};

const milestones = [
  { id: "m1", name: "Setting out and excavation", start: "2026-09-21", end: "2026-10-03", labour: 60_000, status: "paid" as const },
  { id: "m2", name: "Foundation", start: "2026-10-05", end: "2026-10-31", labour: 85_000, status: "in_progress" as const },
  { id: "m3", name: "Walling up to ring beam", start: "2026-11-02", end: "2026-12-05", labour: 120_000, status: "planned" as const },
  { id: "m4", name: "Roofing", start: "2026-12-07", end: "2027-01-09", labour: 70_000, status: "planned" as const },
  { id: "m5", name: "Plaster and finishes", start: "2027-01-11", end: "2027-02-27", labour: 90_000, status: "planned" as const },
];

const materialPlan: Record<string, { itemKey: string; qty: number }[]> = {
  m2: [{ itemKey: "cement_50kg", qty: 120 }, { itemKey: "steel_y12", qty: 60 }, { itemKey: "ballast", qty: 14 }],
  m3: [{ itemKey: "stone_machine_cut", qty: 2400 }],
  m4: [{ itemKey: "roofing_sheet", qty: 90 }],
};

export async function resetDemo(db: AnyDb, payees: DemoPayees = {}): Promise<void> {
  const references = new Map(priceReferences.map((r) => [r.itemKey, r]));

  await db.transaction(async (tx) => {
    // Shared rows: upserted, so other projects that use them are never affected.
    await tx.insert(s.user)
      .values({ id: DEMO.ownerId, name: "Wanjiru Kamau", email: "wanjiru@demo.hakika.example", homeLocation: "Dallas, Texas" })
      .onConflictDoUpdate({ target: s.user.id, set: { name: "Wanjiru Kamau", homeLocation: "Dallas, Texas" } });

    for (const supplier of [
      { id: DEMO.supplierIds.mlima, name: "Mlima Hardware", area: "Nyeri town", paypalEmail: payees.mlima ?? null },
      { id: DEMO.supplierIds.kiawara, name: "Kiawara Builders Supplies", area: "Kiawara", paypalEmail: payees.kiawara ?? null },
    ]) {
      const values = { ...supplier, verified: true };
      await tx.insert(s.suppliers).values(values).onConflictDoUpdate({ target: s.suppliers.id, set: values });
    }

    await tx.delete(s.supplierPrices).where(inArray(s.supplierPrices.supplierId, Object.values(DEMO.supplierIds)));
    await tx.insert(s.supplierPrices).values(Object.entries(supplierPrices).flatMap(([supplierId, prices]) =>
      Object.entries(prices).map(([itemKey, price]) => ({
        supplierId, itemKey, unit: references.get(itemKey)!.unit,
        unitPriceKesCents: kes(price), observedOn: PRICED_ON,
      }))));

    for (const r of priceReferences) {
      const values = {
        itemKey: r.itemKey, description: r.description, unit: r.unit,
        medianKesCents: kes(r.median), source: PLACEHOLDER, observedOn: PRICED_ON,
      };
      await tx.insert(s.priceReferences).values(values)
        .onConflictDoUpdate({ target: s.priceReferences.itemKey, set: values });
    }

    // The project: payments first (they restrict deletes), then the project cascades to the rest.
    await tx.delete(s.payments).where(eq(s.payments.projectId, DEMO.projectId));
    await tx.delete(s.projects).where(eq(s.projects.id, DEMO.projectId));

    await tx.insert(s.projects).values({
      id: DEMO.projectId, ownerId: DEMO.ownerId, name: "Three-bedroom house, Nyeri",
      siteLabel: "Family land, Nyeri", siteLat: -0.4201, siteLng: 36.9476, siteRadiusM: 150,
      budgetKesCents: kes(4_500_000),
    });

    // Fictional numbers; Judge Mode and the WhatsApp sandbox map real test phones onto these contacts.
    await tx.insert(s.siteContacts).values([
      { id: DEMO.contactIds.peter, projectId: DEMO.projectId, name: "Peter Mwangi", role: "foreman", whatsappNumber: "+254700000101", language: "sw" },
      { id: DEMO.contactIds.otieno, projectId: DEMO.projectId, name: "Otieno", role: "fundi", whatsappNumber: "+254700000102", language: "sw", paypalEmail: payees.otieno ?? null },
      { id: DEMO.contactIds.grace, projectId: DEMO.projectId, name: "Grace Wambui", role: "supplier", whatsappNumber: "+254700000103", language: "en", supplierId: DEMO.supplierIds.mlima },
    ]);

    // One at a time, so each milestone's dependency already exists.
    for (const [i, m] of milestones.entries()) {
      await tx.insert(s.milestones).values({
        id: m.id, projectId: DEMO.projectId, position: i + 1, name: m.name, status: m.status,
        plannedStart: m.start, plannedEnd: m.end, dependsOnId: i > 0 ? milestones[i - 1].id : null,
        labourKesCents: kes(m.labour), labourContactId: DEMO.contactIds.otieno,
      });
    }

    await tx.insert(s.materialPlanLines).values(Object.entries(materialPlan).flatMap(([milestoneId, lines]) =>
      lines.map(({ itemKey, qty }) => {
        const r = references.get(itemKey)!;
        return { milestoneId, itemKey, description: r.description, qty, unit: r.unit };
      })));

    // Excavation was finished and paid before Hakika was used, so there is no payment record for it.
    await tx.insert(s.auditEvents).values({
      projectId: DEMO.projectId, kind: "milestone", action: "milestone.imported", actor: "system",
      milestoneId: "m1",
      description: "Setting out and excavation was finished and paid before this project used Hakika.",
    });
  });
}
