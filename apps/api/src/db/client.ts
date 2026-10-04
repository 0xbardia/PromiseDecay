/**
 * Database access.
 *
 * A single pooled postgres client per process. Everything in here is derived state —
 * wiping it and re-indexing must reproduce the same rows, which is what
 * `tests/indexer/idempotency.test.ts` proves.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema } from "./schema.js";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(connectionString: string, max: number) {
  const sql = postgres(connectionString, {
    max,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    // Never interpolate user input; the few dynamic identifiers used are allow-listed.
    transform: { undefined: null },
  });
  return { sql, db: drizzle(sql, { schema }) };
}

export type { postgres };