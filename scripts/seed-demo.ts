// Rebuilds the demo project in the database that DATABASE_URL points at.
// Run with `npm run db:seed`. Env files load as `next dev` loads them.

import { loadEnvConfig } from "@next/env";
import { getDb } from "../src/server/db/client";
import { DEMO, resetDemo } from "../src/server/db/demo";

async function main() {
  loadEnvConfig(process.cwd(), true);
  const payees = {
    mlima: process.env.PAYPAL_SANDBOX_SUPPLIER_MLIMA,
    kiawara: process.env.PAYPAL_SANDBOX_SUPPLIER_KIAWARA,
    otieno: process.env.PAYPAL_SANDBOX_FUNDI_OTIENO,
  };
  const db = getDb();
  try {
    await resetDemo(db, payees);
    console.log(`Demo project ${DEMO.projectId} reset.`);
    for (const [name, email] of Object.entries(payees)) {
      if (!email) console.warn(`No PayPal sandbox email for ${name}: payments to them will be refused.`);
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
