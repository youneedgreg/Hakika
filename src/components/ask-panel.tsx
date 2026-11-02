"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { postJson, toApiClientError } from "@/lib/api-client";
import type { ChatResult } from "@/shared/api";

const suggestions = [
  "Why is the foundation payment held?",
  "What have we spent so far?",
  "What is the next payment?",
];

export function AskPanel({ projectId }: { projectId: string }) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ChatResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQuestion(trimmed);
    setPending(true);
    setError(null);
    try {
      const response = await postJson<ChatResult>("/api/agent/chat", { projectId, question: trimmed });
      setResult(response.data);
    } catch (caught) {
      setResult(null);
      setError(toApiClientError(caught).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card title="Ask Hakika" action={<span className="text-xs text-muted">Answers from this project&apos;s records</span>}>
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label className="sr-only" htmlFor="ask-question">
          Ask a question about this project
        </label>
        <input
          id="ask-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={1000}
          placeholder="Ask about payments, proofs or the budget"
          className="h-11 flex-1 rounded-full border border-line bg-surface px-4 text-sm outline-none focus-visible:outline-2 focus-visible:outline-brand"
        />
        <Button type="submit" disabled={pending || !question.trim()}>
          {pending ? "Asking…" : "Ask"}
        </Button>
      </form>

      <ul className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((text) => (
          <li key={text}>
            <button
              type="button"
              onClick={() => void ask(text)}
              disabled={pending}
              className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-brand hover:text-brand-strong disabled:opacity-50"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>

      <div aria-live="polite" className="mt-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && (
          <div className="space-y-3 rounded-xl bg-paper p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{question}</p>
            <p className="text-sm leading-relaxed">{result.answer}</p>
            {result.citations.length > 0 && (
              <ul className="flex flex-wrap gap-2 text-sm">
                {result.citations.map((citation) => (
                  <li key={citation.href}>
                    <a href={citation.href} className="font-medium text-brand underline underline-offset-2">
                      {citation.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
