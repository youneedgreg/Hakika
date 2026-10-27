// Small helpers shared by the API route handlers.

import type { z } from "zod";
import type { ApiError } from "@/shared/api";

// Every response served from mock data carries this header, so nobody mistakes it for live data.
const MOCK_HEADERS = { "x-hakika-mock": "1" };

export function mockJson<T>(data: T, status = 200): Response {
  return Response.json(data, { status, headers: MOCK_HEADERS });
}

export function apiError(status: number, code: string, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

export const notFound = (what: string) => apiError(404, "not_found", `${what} not found.`);

export const notImplemented = (what: string) =>
  apiError(501, "not_implemented", `${what} is not built yet.`);

// Parses a JSON body against a schema. Returns the data, or a 400 response to send back as is.
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: apiError(400, "invalid_json", "The request body must be JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { response: apiError(400, "invalid_body", `${where}${issue?.message ?? "Invalid body."}`) };
  }
  return { data: parsed.data };
}
