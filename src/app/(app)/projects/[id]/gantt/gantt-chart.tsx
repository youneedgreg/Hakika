"use client";

import { useEffect, useMemo, useRef } from "react";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-light.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import { statusLabel, toBryntumProject } from "./gantt-data";
import type { GanttData } from "@/shared/api";
import type { MilestoneStatus } from "@/shared/types";

export function GanttChart({ data }: { data: GanttData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const project = useMemo(() => toBryntumProject(data), [data]);
  const statusById = useMemo(
    () => new Map<string, MilestoneStatus>(data.tasks.map((task) => [task.id, task.status])),
    [data],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let instance: { destroy: () => void } | null = null;

    // Bryntum touches the DOM and window on load, so it is imported only in the browser.
    void import("@bryntum/gantt").then(({ Gantt }) => {
      if (cancelled) return;
      instance = new Gantt({
        appendTo: container,
        readOnly: true,
        project,
        columns: [
          { type: "name", text: "Milestone", width: 260 },
          {
            text: "Status",
            width: 150,
            renderer: ({ record }: { record: { id: string | number } }) => {
              const status = statusById.get(String(record.id));
              return status ? statusLabel[status] : "";
            },
          },
        ],
      });
    });

    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [project, statusById]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Project timeline: milestones and payment gates"
      className="h-[560px] w-full overflow-hidden rounded-xl border border-line"
    />
  );
}
