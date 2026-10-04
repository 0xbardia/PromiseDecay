/**
 * Migration runner.
 *
 * Applies the SQL migration list inside a transaction per migration and records it in
 * `schema_migrations`. Re-running against an already-migrated database is a no-op, which
 * is what makes deploys and restarts safe.
 *
 *   tsx src/db/migrate.ts           apply pending migrations
 *   tsx src/db/migrate.ts --reset   drop the derived schema, then apply
 *
 * `--reset` is safe by design: everything in this database is derived from the chain.
 */
import postgres from "postgres";
import { loadEnv } from "@promisedecay/config";
import { migrations } from "./migrations.js";

const DERIVED_TABLES = [
  "promises",
  "evidence",
  "drift",
  "responses",
  "challenges",
  "projects",
  "indexer_state",
];

export async function runMigrations(
  sql: postgres.Sql,
  opts: { reset?: boolean; log?: (msg: string) => void } = {}
): Promise<{ applied: string[]; skipped: string[] }> {
  const log = opts.log ?? (() => {});
  const applied: string[] = [];
  const skipped: string[] = [];

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  if (opts.reset) {
    log("--reset: dropping derived schema (chain state is untouched)");
    for (const table of DERIVED_TABLES) {
      await sql`DROP TABLE IF EXISTS ${sql(table)} CASCADE`;
    }
    await sql`DELETE FROM schema_migrations`;
  }

  const rows = await sql<{ name: string }[]>`SELECT name FROM schema_migrations`;
  const done = new Set(rows.map((r) => r.name));

  for (const migration of migrations) {
    if (done.has(migration.name)) {
      skipped.push(migration.name);
      continue;
    }
    await sql.begin(async (tx) => {
      // Raw schema first, then record it. Both inside one transaction, so a failure
      // leaves neither a half-applied schema nor a spurious "already applied" record.
      await tx.unsafe(migration.sql);
      // The name comes from this repo's own migration list, never from input, so a
      // quoted literal is safe here and avoids depending on a helper this
      // postgres.js version does not expose.
      await tx.unsafe(
        `INSERT INTO schema_migrations (name) VALUES ('${migration.name.replace(/'/g, "''")}')`
      );
    });
    applied.push(migration.name);
    log(`applied ${migration.name}`);
  }

  return { applied, skipped };
}

// ---------------------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------------------
const isMain = process.argv[1]?.includes("migrate");
if (isMain) {
  const env = loadEnv();
  const reset = process.argv.includes("--reset");
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    const { applied, skipped } = await runMigrations(sql, {
      reset,
      log: (m) => console.log(m),
    });
    console.log(`migrations applied: ${applied.length}, already present: ${skipped.length}`);
    if (applied.length === 0) console.log("database is already up to date");
    process.exit(0);
  } catch (err) {
    console.error("migration failed:", (err as Error).message);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}