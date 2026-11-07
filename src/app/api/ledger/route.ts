// GET /api/ledger?projectId=…[&format=csv] — the money trail, from the database.

import type { NextRequest } from "next/server";
import type { LedgerResult } from "@/shared/api";
import { ledgerToCsv } from "@/server/csv";
import { getDb } from "@/server/db/client";
import { apiError, notFound } from "@/server/http";
import { loadLedger } from "@/server/projects/ledger";

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return apiError(400, "missing_project", "Pass projectId in the query string.");
  const rows = await loadLedger(getDb(), projectId);
  if (!rows) return notFound("Project");

  if (request.nextUrl.searchParams.get("format") === "csv") {
    return new Response(ledgerToCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="hakika-ledger-${projectId.replace(/[^\w-]/g, "")}.csv"`,
      },
    });
  }
  const result: LedgerResult = { rows };
  return Response.json(result);
}
