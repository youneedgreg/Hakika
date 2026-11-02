"use client";

import { use } from "react";
import { AsyncView } from "@/components/async-view";
import { Card } from "@/components/ui/card";
import { useApi } from "@/lib/use-api";
import type { GanttData } from "@/shared/api";
import { GanttChart } from "./gantt-chart";
import { statusLabel } from "./gantt-data";

const legend = Object.entries(statusLabel);

export default function GanttPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useApi<GanttData>(`/api/projects/${id}/gantt`);

  return (
    <AsyncView state={state} reload={reload}>
      {(data) => (
        <Card title="Milestones and payment gates">
          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Colour key">
            {legend.map(([status, label]) => (
              <li key={status}>{label}</li>
            ))}
          </ul>
          <GanttChart data={data} />
        </Card>
      )}
    </AsyncView>
  );
}
