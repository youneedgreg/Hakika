import type { ReactNode } from "react";
import type { ApiClientError } from "@/lib/api-client";
import type { ApiState } from "@/lib/use-api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { SampleDataBadge } from "@/components/ui/sample-badge";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      <div className="h-6 w-1/3 animate-pulse rounded bg-line/70" />
      <div className="h-24 animate-pulse rounded-xl bg-line/50" />
      <div className="h-24 animate-pulse rounded-xl bg-line/50" />
    </div>
  );
}

// Renders the loading, error and not-found states, then the page once data has arrived.
export function AsyncView<T>({
  state,
  reload,
  children,
}: {
  state: ApiState<T>;
  reload: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <AsyncError error={state.error} reload={reload} />;
  return (
    <>
      {state.mock && <SampleDataBadge />}
      {children(state.data)}
    </>
  );
}

function AsyncError({ error, reload }: { error: ApiClientError; reload: () => void }) {
  if (error.status === 404) {
    return <EmptyState title="Not found" body={error.message} />;
  }
  return (
    <ErrorState
      body={error.message}
      action={
        <Button variant="secondary" onClick={reload}>
          Try again
        </Button>
      }
    />
  );
}
