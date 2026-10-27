// drizzle-kit: generates SQL migrations from the schema and applies them.
// Migrations use the direct (unpooled) connection. Env files load as `next dev` loads them,
// which includes .env.development.local, where `vercel env pull` puts the database URLs.

import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd(), true);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
  strict: true,
  verbose: true,
});
