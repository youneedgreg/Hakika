"use client";

import { use, useEffect, useMemo, useState } from "react";
import { AsyncView } from "@/components/async-view";
import { Button } from "@/components/ui/button";
import { ProofPhoto } from "@/components/ui/proof-photo";
import { apiRequest, toApiClientError } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import type { ProofCapture, ProofUploadResult } from "@/shared/api";

const LOCATION_MESSAGE = "Location is off or blocked. Turn on location for this browser, then send the photo again.";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1600;

async function preparePhoto(file: File): Promise<Blob> {
  let source: Blob = file;
  if (/image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    try {
      const { default: convertHeic } = await import("heic2any");
      const converted = await convertHeic({ blob: file, toType: "image/jpeg", quality: 0.88 });
      source = Array.isArray(converted) ? converted[0] : converted;
    } catch {
      throw new Error("This photo could not be converted. Choose another photo or set your camera to JPEG.");
    }
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This photo format could not be opened. Choose a JPEG, PNG or WebP photo.");
  }

  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This photo could not be prepared. Choose another photo.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.88, 0.78, 0.68, 0.58, 0.48]) {
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (jpeg && jpeg.size <= MAX_IMAGE_BYTES) return jpeg;
    }
    throw new Error("This photo is still too large. Choose a smaller photo.");
  } finally {
    bitmap.close();
  }
}

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
  const [file, setFile] = useState<Blob | null>(null);
  const [preparing, setPreparing] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

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
          body.append("image", file, "proof.jpg");
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
          disabled={preparing}
          onChange={async (event) => {
            const selected = event.target.files?.[0];
            setFile(null);
            setError(null);
            if (!selected) return;
            setPreparing(true);
            try {
              setFile(await preparePhoto(selected));
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : "This photo could not be prepared. Choose another photo.");
            } finally {
              setPreparing(false);
            }
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

      <Button type="submit" disabled={!file || sending || preparing} className="h-14 w-full text-base">
        {preparing ? "Preparing photo…" : sending ? "Sending…" : "Send photo"}
      </Button>
    </form>
  );
}
