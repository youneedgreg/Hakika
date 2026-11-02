"use client";

import Link from "next/link";
import { useState } from "react";
import { buildSimulateBody, scenarios, type Scenario } from "@/components/judge/scenarios";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { postJson, toApiClientError } from "@/lib/api-client";
import { DEMO_PROJECT_ID } from "@/lib/demo-ids";
import type { ResetResult, SimulateResult } from "@/shared/api";

type RunState =
  | { status: "idle" }
  | { status: "running"; sent: number; total: number }
  | { status: "done" }
  | { status: "error"; message: string };

export default function JudgePage() {
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  function setRun(id: string, state: RunState) {
    setRuns((previous) => ({ ...previous, [id]: state }));
  }

  async function runScenario(scenario: Scenario) {
    setRun(scenario.id, { status: "running", sent: 0, total: scenario.steps.length });
    try {
      for (const [index, step] of scenario.steps.entries()) {
        await postJson<SimulateResult>(
          "/api/judge/simulate",
          buildSimulateBody(DEMO_PROJECT_ID, step, window.location.origin),
        );
        setRun(scenario.id, { status: "running", sent: index + 1, total: scenario.steps.length });
      }
      setRun(scenario.id, { status: "done" });
    } catch (error) {
      setRun(scenario.id, { status: "error", message: toApiClientError(error).message });
    }
  }

  async function resetDemo() {
    setResetting(true);
    setResetMessage(null);
    setResetError(null);
    try {
      await postJson<ResetResult>("/api/judge/reset", { projectId: DEMO_PROJECT_ID });
      setRuns({});
      setResetMessage("Demo reset. All three scenarios can run again from the start.");
    } catch (error) {
      setResetError(toApiClientError(error).message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">Judge Mode</h2>
        <p className="max-w-2xl text-sm text-muted">
          Each scenario sends simulated messages through the same pipeline as WhatsApp. Nothing reaches a real phone, and
          no money moves outside PayPal sandbox.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={resetDemo} disabled={resetting}>
          {resetting ? "Resetting…" : "Reset demo"}
        </Button>
        {resetMessage && (
          <p role="status" className="text-sm text-brand-strong">
            {resetMessage}
          </p>
        )}
      </div>
      {resetError && <ErrorState body={resetError} />}

      <div className="grid gap-6 lg:grid-cols-3">
        {scenarios.map((scenario) => {
          const run = runs[scenario.id] ?? { status: "idle" };
          return (
            <Card key={scenario.id} title={scenario.title}>
              <p className="text-sm text-muted">{scenario.summary}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={() => runScenario(scenario)} disabled={run.status === "running"}>
                  {run.status === "running" ? "Running…" : "Run scenario"}
                </Button>
                <RunStatus run={run} />
              </div>
              {run.status === "done" && (
                <Link href={scenario.result.href} className="mt-4 inline-block text-sm font-semibold text-brand underline">
                  {scenario.result.label}
                </Link>
              )}
              {run.status === "error" && (
                <div className="mt-4">
                  <ErrorState body={run.message} />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function RunStatus({ run }: { run: RunState }) {
  if (run.status === "running") {
    return (
      <span role="status" className="text-sm text-muted">
        Sent {run.sent} of {run.total}
      </span>
    );
  }
  if (run.status === "done") {
    return <span role="status" className="text-sm font-semibold text-brand-strong">Sent</span>;
  }
  return null;
}
