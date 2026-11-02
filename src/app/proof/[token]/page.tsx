"use client";

import { use, useMemo, useState } from "react";
import { AsyncView } from "@/components/async-view";
import { Button } from "@/components/ui/button";
import { ProofPhoto } from "@/components/ui/proof-photo";
import { apiRequest, toApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { ProofCapture, ProofUploadResult } from "@/shared/api";

const LOCATION_MESSAGE = "Location is off or blocked. Turn on location for this browser, then send the photo again.";

// Called straight from the tap, so the browser treats it as a user request.
function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error(LOCATION_MESSAGE));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error(LOCATION_MESSAGE)), {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });
}

export default function PhoneProofPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { state, reload } = useApi<ProofCapture>(`/api/proof/${token}`);

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 py-6">
      <AsyncView state={state} reload={reload}>
        {(capture) => <ProofForm token={token} capture={capture} />}
      </AsyncView>
    </main>
  );
}

function ProofForm({ token, capture }: { token: string; capture: ProofCapture }) {
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) {
    return (
      <section role="status" className="space-y-3 pt-12 text-center">
        <p className="text-2xl font-semibold">Thank you</p>
        <p className="text-base text-muted">Your photo is with Hakika. The owner will see it shortly.</p>
        <p className="text-base text-muted">Asante. Picha yako imepokelewa.</p>
      </section>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!file) return;
        setError(null);
        setSending(true);
        // Start the location request before any await, so it stays inside the tap.
        const positionRequest = currentPosition();
        try {
          const position = await positionRequest;
          const body = new FormData();
          body.append("image", file);
          body.append("latitude", String(position.coords.latitude));
          body.append("longitude", String(position.coords.longitude));
          body.append("accuracy", String(position.coords.accuracy));
          body.append("clientTime", new Date().toISOString());
          await apiRequest<ProofUploadResult>(`/api/proof/${token}`, { method: "POST", body });
          setSent(true);
        } catch (caught) {
          const message = caught instanceof Error && caught.message === LOCATION_MESSAGE
            ? LOCATION_MESSAGE
            : toApiClientError(caught).message;
          setError(message);
        } finally {
          setSending(false);
        }
      }}
    >
      <header className="space-y-1">
        <p className="text-sm text-muted">{capture.milestoneName}</p>
        <p className="text-sm text-muted">Code</p>
        <p className="font-mono text-4xl font-bold tracking-widest" aria-label={`Proof code ${capture.code}`}>
          {capture.code}
        </p>
        <p className="text-xs text-muted">Expires {formatDateTime(capture.expiresAt)}</p>
      </header>

      <section className="space-y-2 rounded-xl border border-line bg-surface p-4 text-base leading-relaxed">
        <p>{capture.instructions.en}</p>
        <p className="text-muted">{capture.instructions.sw}</p>
      </section>

      <label className="block">
        <span className="sr-only">Take or choose a photo</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
          className="block w-full text-base file:mr-4 file:rounded-full file:border-0 file:bg-brand-soft file:px-5 file:py-3 file:font-semibold file:text-brand-strong"
        />
      </label>

      {preview && (
        <ProofPhoto src={preview} alt="Preview of the photo you chose" className="aspect-[4/3] w-full rounded-xl" />
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-base text-danger">
          {error}
        </p>
      )}

      <Button type="submit" disabled={!file || sending} className="h-14 w-full text-base">
        {sending ? "Sending…" : "Send photo"}
      </Button>
    </form>
  );
}
