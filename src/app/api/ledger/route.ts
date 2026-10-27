// GET /api/ledger?projectId=…[&format=csv] — the money trail. Mock data for now.

import type { NextRequest } from "next/server";
import type { LedgerResult } from "@/shared/api";
import { ledgerToCsv } from "@/server/csv";
import { apiError, mockJson, notFound } from "@/server/http";
import { DEMO_PROJECT_ID, ledgerRows } from "@/server/mocks/demo";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError(400, "missing_project", "Pass projectId in the query string.");
  if (projectId !== DEMO_PROJECT_ID) return notFound("Project");

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new Response(ledgerToCsv(ledgerRows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="hakika-ledger-${projectId}.csv"`,
        "x-hakika-mock": "1",
      },
    });
  }
  const result: LedgerResult = { rows: ledgerRows };
  return mockJson(result);
}
