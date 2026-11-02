import { describe, expect, it } from "vitest";
import { toBryntumProject } from "./gantt-data";
import type { GanttData } from "@/shared/api";

const data: GanttData = {
  tasks: [
    { id: "m1", name: "Excavation", startDate: "2026-09-21", endDate: "2026-10-03", percentDone: 100, status: "paid", kind: "work" },
    { id: "g1", name: "Pay excavation labour", startDate: "2026-10-03", endDate: "2026-10-03", percentDone: 100, status: "paid", kind: "payment_gate" },
  ],
  dependencies: [{ id: "d1", fromTask: "m1", toTask: "g1" }],
};

describe("toBryntumProject", () => {
  it("makes work end dates exclusive so the last plan day is drawn", () => {
    const project = toBryntumProject(data);
    const work = project.tasksData.find((task) => task.id === "m1");
    expect(work?.startDate).toBe("2026-09-21");
    expect(work?.endDate).toBe("2026-10-04");
  });

  it("turns payment gates into zero-length milestones", () => {
    const project = toBryntumProject(data);
    const gate = project.tasksData.find((task) => task.id === "g1");
    expect(gate?.duration).toBe(0);
    expect(gate?.endDate).toBeUndefined();
  });

  it("keeps dependencies in Bryntum's fromTask and toTask shape", () => {
    expect(toBryntumProject(data).dependenciesData).toEqual([{ id: "d1", fromTask: "m1", toTask: "g1" }]);
  });

  it("rolls a month end over correctly", () => {
    const project = toBryntumProject({
      tasks: [{ id: "x", name: "Roofing", startDate: "2026-12-07", endDate: "2026-12-31", percentDone: 0, status: "planned", kind: "work" }],
      dependencies: [],
    });
    expect(project.tasksData[0]?.endDate).toBe("2027-01-01");
  });
});
