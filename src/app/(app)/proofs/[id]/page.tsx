"use client";

import { use, useRef, useState } from "react";
import { AsyncView } from "@/components/async-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckList, type CheckItem } from "@/components/ui/check-list";
import { ProofPhoto } from "@/components/ui/proof-photo";
import { StatusPill } from "@/components/ui/status-pill";
import { ErrorState } from "@/components/ui/states";
import { postJson } from "@/lib/api-client";
import { distanceMeters } from "@/lib/geo";
import { formatDateTime, formatDistance } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { OverrideResult } from "@/shared/api";
import type { ProofCheck, ProofReview } from "@/shared/types";

const checkLabels: Record<ProofCheck["name"], string> = {
  code: "Proof code",
  freshness: "Taken today",
  duplicate: "New photo",
  location: "At the site",
  screen_or_print: "Real scene, not a screen",
  expected_items: "Expected items visible",
  consistency: "Matches the request",
};

export default function ProofReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { state, reload } = useApi<ProofReview>(`/api/proofs/${id}`);

  return (
    <AsyncView state={state} reload={reload}>
      {(proof) => <ProofReviewView proof={proof} onOverridden={reload} />}
    </AsyncView>
  );
}

function ProofReviewView({ proof, onOverridden }: { proof: ProofReview; onOverridden: () => void }) {
  const checks: CheckItem[] = proof.checks.map((check) => ({
    name: check.name,
    label: checkLabels[check.name],
    result: check.result,
    hard: check.hard,
    detail: check.detail,
  }));

  const distance = proof.capture ? distanceMeters(proof.capture, proof.site) : null;
  const insideSite = distance !== null && distance <= proof.site.radiusM;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Received {formatDateTime(proof.receivedAt)}</p>
          <h2 className="text-2xl font-semibold">Proof review</h2>
        </div>
        <StatusPill status={proof.outcome} />
      </header>

      <p className="text-sm leading-relaxed">{proof.explanation}</p>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card title="Photo">
          <ProofPhoto src={proof.imageUrl} alt="Proof photo submitted from the site" className="aspect-[4/3] w-full rounded-xl" />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">Distance from site</dt>
              <dd className={`font-semibold ${insideSite ? "text-brand-strong" : "text-danger"}`}>
                {distance === null ? "No location sent" : `${formatDistance(distance)} (limit ${formatDistance(proof.site.radiusM)})`}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Location accuracy</dt>
              <dd className="font-semibold">{proof.capture ? formatDistance(proof.capture.accuracyM) : "—"}</dd>
            </div>
          </dl>
        </Card>

        <div className="space-y-6">
          <Card title="Checks">
            <CheckList items={checks} />
          </Card>

          {proof.outcome !== "verified" && <OverrideDialog proofId={proof.proofId} onOverridden={onOverridden} />}
        </div>
      </div>
    </div>
  );
}

function OverrideDialog({ proofId, onOverridden }: { proofId: string; onOverridden: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title="Override">
      <p className="mb-4 text-sm text-muted">
        If you have checked this proof yourself, you can accept it. The reason is recorded in the money trail.
      </p>
      <Button variant="secondary" onClick={() => dialogRef.current?.showModal()}>
        Override this decision
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="override-title"
        className="w-[min(92vw,28rem)] rounded-2xl border border-line bg-surface p-6 text-ink backdrop:bg-ink/40"
      >
        <form
          method="dialog"
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            try {
              await postJson<OverrideResult>(`/api/proofs/${proofId}/override`, { reason: reason.trim() });
              dialogRef.current?.close();
              setReason("");
              onOverridden();
            } catch {
              setError("The override was not saved. Try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          <h3 id="override-title" className="text-lg font-semibold">
            Accept this proof?
          </h3>
          <label htmlFor="override-reason" className="block text-sm font-semibold">
            Reason (shown in the money trail)
          </label>
          <textarea
            id="override-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={500}
            rows={3}
            required
            className="w-full rounded-xl border border-line bg-surface p-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-brand"
          />
          {error && <ErrorState body={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || reason.trim().length < 3}>
              {pending ? "Saving…" : "Accept proof"}
            </Button>
          </div>
        </form>
      </dialog>
    </Card>
  );
}
