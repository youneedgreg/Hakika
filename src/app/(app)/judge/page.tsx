"use client";

import Link from "next/link";
import { useState } from "react";
import { AsyncView } from "@/components/async-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { postJson, toApiClientError } from "@/lib/api-client";
import { DEMO_PROJECT_ID } from "@/lib/demo-ids";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { ProofPhoto } from "@/components/ui/proof-photo";
import type { JudgeChatMessage, JudgeChatResult, ResetResult, ScenarioId, ScenarioResult } from "@/shared/api";

const scenarios: { id: ScenarioId; title: string; summary: string }[] = [
  { id: "inflated-quote", title: "Inflated quote", summary: "A quote photo is read, checked against prices and sent for owner approval." },
  { id: "valid-delivery", title: "Valid delivery", summary: "A paid delivery is proved with a fresh photo, code and site location." },
  { id: "recycled-photo", title: "Recycled photo", summary: "A reused photo from far away fails verification and holds the milestone." },
];

export default function JudgePage() {
  const [runs, setRuns] = useState<Partial<Record<ScenarioId, ScenarioResult>>>({});
  const [runErrors, setRunErrors] = useState<Partial<Record<ScenarioId, string>>>({});
  const [activeScenario, setActiveScenario] = useState<ScenarioId | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const chat = useApi<JudgeChatResult>(`/api/judge/chat?projectId=${encodeURIComponent(DEMO_PROJECT_ID)}`);

  async function runScenario(id: ScenarioId) {
    setActiveScenario(id);
    setRunErrors((previous) => ({ ...previous, [id]: undefined }));
    try {
      const response = await postJson<ScenarioResult>(`/api/judge/scenarios/${id}`, { projectId: DEMO_PROJECT_ID });
      setRuns((previous) => ({ ...previous, [id]: response.data }));
      chat.reload();
    } catch (error) {
      setRunErrors((previous) => ({ ...previous, [id]: toApiClientError(error).message }));
    } finally {
      setActiveScenario(null);
    }
  }

  async function resetDemo() {
    setResetting(true);
    setResetMessage(null);
    setResetError(null);
    try {
      await postJson<ResetResult>("/api/judge/reset", { projectId: DEMO_PROJECT_ID });
      setRuns({});
      setRunErrors({});
      chat.reload();
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
          const result = runs[scenario.id];
          return (
            <Card key={scenario.id} title={scenario.title}>
              <p className="text-sm text-muted">{scenario.summary}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button onClick={() => runScenario(scenario.id)} disabled={activeScenario !== null || resetting}>
                  {activeScenario === scenario.id ? "Running…" : "Run scenario"}
                </Button>
                {result && <span role="status" className="text-sm font-semibold text-brand-strong">Complete</span>}
              </div>
              {runErrors[scenario.id] && <div className="mt-4"><ErrorState body={runErrors[scenario.id]!} /></div>}
              {result && <ScenarioDetails result={result} />}
            </Card>
          );
        })}
      </div>

      <Card title="Simulator conversation">
        <AsyncView state={chat.state} reload={chat.reload}>
          {(conversation) => conversation.messages.length === 0 ? (
            <EmptyState title="No messages yet" body="Run a scenario to see its simulated WhatsApp conversation here." />
          ) : (
            <ol className="divide-y divide-line">
              {conversation.messages.map((message) => <ChatMessage key={message.id} message={message} />)}
            </ol>
          )}
        </AsyncView>
      </Card>
    </div>
  );
}

function ScenarioDetails({ result }: { result: ScenarioResult }) {
  return (
    <div className="mt-5 space-y-4 border-t border-line pt-4">
      <p className="text-sm leading-relaxed">{result.outcome}</p>
      {result.setup.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted">Setup</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted">
            {result.setup.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}
      <div>
        <h3 className="text-xs font-semibold uppercase text-muted">Model output</h3>
        <ul className="mt-1 space-y-2 text-sm">
          {result.models.map((model) => (
            <li key={model.task}>
              <span className="font-medium">{model.task.replaceAll("_", " ")}</span>
              <span className="text-muted"> · {model.source === "recorded" ? `Recorded${model.modelId ? ` (${model.modelId})` : ""}` : "No recording"}</span>
              <p className="text-muted">{model.detail}</p>
            </li>
          ))}
        </ul>
      </div>
      {result.links.length > 0 && (
        <ul className="space-y-1 text-sm">
          {result.links.map((link) => (
            <li key={link.href}><Link href={link.href} className="font-semibold text-brand underline">{link.label}</Link></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChatMessage({ message }: { message: JudgeChatMessage }) {
  const sender = message.contact?.name ?? (message.direction === "outbound" ? "Hakika" : "Unknown contact");
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
        <span className="font-semibold text-ink">{sender}</span>
        <span>{message.direction}</span>
        <span>{formatDateTime(message.at)}</span>
      </div>
      {message.text && <p className="mt-1 whitespace-pre-wrap text-sm">{message.text}</p>}
      {message.imageUrl && <ProofPhoto src={message.imageUrl} alt={`Photo sent by ${sender}`} className="mt-2 aspect-[4/3] w-full max-w-sm rounded-md" />}
      {message.location && <p className="mt-1 text-sm text-muted">Location: {message.location.lat}, {message.location.lng}</p>}
      {!message.text && !message.imageUrl && !message.location && message.templateKey && (
        <p className="mt-1 text-sm text-muted">Template: {message.templateKey}</p>
      )}
    </li>
  );
}
