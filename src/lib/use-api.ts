"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, toApiClientError, type ApiClientError } from "./api-client";

export type ApiState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "ready"; data: T; mock: boolean };

export function useApi<T>(url: string) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ApiState<T>>({ status: "loading" });

  useEffect(() => {
    let active = true;
    apiRequest<T>(url).then(
      (result) => {
        if (active) setState({ status: "ready", data: result.data, mock: result.mock });
      },
      (error: unknown) => {
        if (active) setState({ status: "error", error: toApiClientError(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [url, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  return { state, reload };
}
