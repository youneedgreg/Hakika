// The project details page, from the database: the owner, the site and its proof radius, the budget,
// the milestones with their planned materials, the people on site and the suppliers.

import { asc, eq, inArray } from "drizzle-orm";
import type { AnyDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { centsToAmount } from "@/server/pricing/money";
import type { ProjectDetails } from "@/shared/api";

export async function loadProjectDetails(db: AnyDb, projectId: string): Promise<ProjectDetails | null> {
  const [row] = await db.select({ project: s.projects, owner: { name: s.user.name, location: s.user.homeLocation } })
    .from(s.projects)
    .innerJoin(s.user, eq(s.projects.ownerId, s.user.id))
    .where(eq(s.projects.id, projectId));
  if (!row) return null;
  const { project, owner } = row;

  const milestones = await db.select().from(s.milestones)
    .where(eq(s.milestones.projectId, projectId)).orderBy(asc(s.milestones.position));
  const ids = milestones.map((m) => m.id);
  const plan = ids.length === 0 ? [] : await db.select().from(s.materialPlanLines)
    .where(inArray(s.materialPlanLines.milestoneId, ids)).orderBy(asc(s.materialPlanLines.itemKey));
  const contacts = await db.select({
    id: s.siteContacts.id, name: s.siteContacts.name, role: s.siteContacts.role, language: s.siteContacts.language,
  }).from(s.siteContacts).where(eq(s.siteContacts.projectId, projectId)).orderBy(asc(s.siteContacts.name));
  // Suppliers aren't tied to one project: the price check compares against every one on record.
  const suppliers = await db.select({
    id: s.suppliers.id, name: s.suppliers.name, area: s.suppliers.area, verified: s.suppliers.verified,
  }).from(s.suppliers).orderBy(asc(s.suppliers.name));

  return {
    id: project.id,
    name: project.name,
    owner: { name: owner.name, location: owner.location ?? "Not given" },
    site: { label: project.siteLabel, lat: project.siteLat, lng: project.siteLng, radiusM: project.siteRadiusM },
    budget: { amount: centsToAmount(project.budgetKesCents), currency: "KES" },
    milestones: milestones.map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      plannedStart: m.plannedStart,
      plannedEnd: m.plannedEnd,
      plannedMaterials: plan.filter((line) => line.milestoneId === m.id)
        .map((line) => ({ itemKey: line.itemKey, description: line.description, qty: line.qty, unit: line.unit })),
    })),
    contacts,
    suppliers,
  };
}
