"use client";

import { use } from "react";
import { AsyncView } from "@/components/async-view";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { ProjectDetails } from "@/shared/api";

export default function ProjectDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useApi<ProjectDetails>(`/api/projects/${id}`);

  return (
    <AsyncView state={state} reload={reload}>
      {(project) => (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Project">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted">Owner</dt>
              <dd>
                {project.owner.name}, {project.owner.location}
              </dd>
              <dt className="text-muted">Site</dt>
              <dd>{project.site.label}</dd>
              <dt className="text-muted">Site coordinates</dt>
              <dd className="tabular-nums">
                {project.site.lat.toFixed(4)}, {project.site.lng.toFixed(4)}
              </dd>
              <dt className="text-muted">Allowed proof radius</dt>
              <dd>{project.site.radiusM} m</dd>
              <dt className="text-muted">Budget</dt>
              <dd>
                <Money value={project.budget} />
              </dd>
            </dl>
          </Card>

          <Card title="Milestones">
            <ol className="space-y-4">
              {project.milestones.map((milestone) => (
                <li key={milestone.id} className="border-b border-line pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{milestone.name}</p>
                    <StatusPill status={milestone.status} />
                  </div>
                  <p className="text-xs text-muted">
                    {formatDate(milestone.plannedStart)} to {formatDate(milestone.plannedEnd)}
                  </p>
                  {milestone.plannedMaterials.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {milestone.plannedMaterials.map((material) => (
                        <li key={material.itemKey}>
                          {material.description}: {material.qty} {material.unit}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Contacts">
            {project.contacts.length === 0 ? (
              <EmptyState title="No contacts" body="People on site appear here." />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {project.contacts.map((contact) => (
                  <li key={contact.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-medium">{contact.name}</span>
                    <span className="text-muted">
                      {contact.role} · {contact.language === "sw" ? "Swahili" : "English"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Suppliers">
            {project.suppliers.length === 0 ? (
              <EmptyState title="No suppliers" body="Suppliers appear here once added." />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {project.suppliers.map((supplier) => (
                  <li key={supplier.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="font-medium">{supplier.name}</p>
                      <p className="text-muted">{supplier.area}</p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        supplier.verified ? "bg-brand-soft text-brand-strong" : "bg-line/60 text-muted"
                      }`}
                    >
                      {supplier.verified ? "Verified" : "Not verified"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </AsyncView>
  );
}
