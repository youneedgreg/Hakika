import type { GanttData } from "@/shared/api";
import type { GanttDependency, GanttTask, MilestoneStatus } from "@/shared/types";

// Plain records in the shape Bryntum reads from project.tasksData and project.dependenciesData.
export type GanttTaskRecord = {
  id: string;
  name: string;
  startDate: string;
  endDate?: string;
  duration?: number;
  durationUnit?: "d";
  percentDone: number;
  eventColor: string;
};

export type GanttDependencyRecord = { id: string; fromTask: string; toTask: string };

export type BryntumProject = {
  tasksData: GanttTaskRecord[];
  dependenciesData: GanttDependencyRecord[];
};

// Colours match the status pills in globals.css so the chart and the lists read the same.
const statusColour: Record<MilestoneStatus, string> = {
  planned: "#9ca3af",
  in_progress: "#1d5fa7",
  awaiting_proof: "#c77d0a",
  verified: "#0f6b4f",
  held: "#b42318",
  paid: "#0a5039",
};

// Plan dates are inclusive, but Bryntum treats an end date as the moment the task finishes.
function dayAfter(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function toBryntumProject({ tasks, dependencies }: GanttData): BryntumProject {
  return {
    tasksData: tasks.map((task) => toTaskRecord(task)),
    dependenciesData: dependencies.map((dependency: GanttDependency) => ({
      id: dependency.id,
      fromTask: dependency.fromTask,
      toTask: dependency.toTask,
    })),
  };
}

function toTaskRecord(task: GanttTask): GanttTaskRecord {
  const base = {
    id: task.id,
    name: task.name,
    startDate: task.startDate.slice(0, 10),
    percentDone: task.percentDone,
    eventColor: statusColour[task.status],
  };

  // Payment gates are zero-length milestones on the day the payment falls due.
  if (task.kind === "payment_gate") {
    return { ...base, duration: 0, durationUnit: "d" };
  }
  return { ...base, endDate: dayAfter(task.endDate.slice(0, 10)) };
}

export const statusLabel: Record<MilestoneStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  awaiting_proof: "Awaiting proof",
  verified: "Verified",
  held: "Held",
  paid: "Paid",
};
