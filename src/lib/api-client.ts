import type { ApiError } from "@/shared/api";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export type ApiResult<T> = { data: T; mock: boolean };

// The API marks mock responses with x-hakika-mock; the UI shows a "sample data" badge for them.
export async function apiRequest<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiClientError(0, "network", "Could not reach the server. Check your connection and try again.");
  }

  const mock = response.headers.get("x-hakika-mock") === "1";
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new ApiClientError(
      response.status,
      body?.error.code ?? "request_failed",
      body?.error.message ?? `The request failed (${response.status}). Try again.`,
    );
  }
  return { data: (await response.json()) as T, mock };
}

export function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return apiRequest<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) return error;
  return new ApiClientError(0, "unknown", "Something went wrong. Try again.");
}
