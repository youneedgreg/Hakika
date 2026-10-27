// The database client: Neon's WebSocket pool, which supports the transactions that payment
// capture and state changes need. Created on first use, so importing this never needs DATABASE_URL.

import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

// Any Drizzle Postgres database with our schema: Neon in the app, PGlite in tests.
export type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

function createDb(url: string) {
  return drizzle({ connection: url, schema, casing: "snake_case" });
}

let db: Db | undefined;

export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    db = createDb(url);
  }
  return db;
}
