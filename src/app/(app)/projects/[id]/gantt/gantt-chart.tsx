"use client";

import { useEffect, useMemo, useRef } from "react";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/stockholm-light.css";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import { statusLabel, timelineRange, toBryntumProject } from "./gantt-data";
import type { GanttData } from "@/shared/api";
import type { MilestoneStatus } from "@/shared/types";

type GanttConstructor = typeof import("@bryntum/gantt").Gantt;

const GANTT_MODULE_URL: string = "/vendor/bryntum-gantt.module.js";

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
    let instance: InstanceType<GanttConstructor> | null = null;

    // Loaded from public/vendor at runtime (copied by the prebuild script) so the bundler never compiles it.
    void (import(
      /* turbopackIgnore: true */ /* webpackIgnore: true */ GANTT_MODULE_URL
    ) as Promise<{ Gantt: GanttConstructor }>).then(({ Gantt }) => {
      if (cancelled) return;
      instance = new Gantt({
        appendTo: container,
        readOnly: true,
        ...(data.tasks.length > 0 ? timelineRange(data.tasks) : {}),
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
      void instance.project.commitAsync().then(() => {
        if (!cancelled) instance?.zoomToFit({ leftMargin: 20, rightMargin: 20 });
      });
    });

    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [project, statusById, data.tasks]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Project timeline: milestones and payment gates"
      className="h-[560px] w-full overflow-hidden rounded-xl border border-line"
    />
  );
}
