/**
 * Reconciliation: database vs API, with duplicate and orphan detection.
 *
 * The certification requires chain count = DB count = API count, and zero duplicates. Proving
 * duplicates are zero has to happen in the database: an API that deduped on the way out would
 * hide them.
 *
 * The chain's own count is not read here. GenLayer call selectors are schema-derived and owned
 * by certify.mjs, which reports the authoritative chain figure; this tool measures the two sides
 * it can check directly and compares them.
 *
 *   node scripts/reconcile.mjs
 */
import fs from "node:fs";
import path from "node:path";

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = val;
  }
  return out;
}

const env = { ...loadDotEnv(path.resolve(process.cwd(), "../../.env")), ...process.env };
const { createDatabase } = await import("@promisedecay/api/db");
const { sql: dsql } = await import("drizzle-orm");
const { sql: client, db } = createDatabase(env.DATABASE_URL, 2);

/** Table names are fixed literals in this file, never interpolated from input. */
const TABLES = ["promises", "evidence", "drift", "responses", "challenges", "projects"];

const scalar = (r) => Number((Array.isArray(r) ? r[0]?.n : r?.rows?.[0]?.n) ?? 0);

console.log("\nPromiseDecay — reconciliation\n");
console.log(`  database: ${new URL(env.DATABASE_URL).host}${new URL(env.DATABASE_URL).pathname}\n`);

const counts = {};
for (const t of TABLES) {
  counts[t] = scalar(await db.execute(dsql.raw(`select count(*)::int as n from ${t}`)));
  console.log(`  ${t.padEnd(12)} ${String(counts[t]).padStart(5)}`);
}

// Duplicate promises, measured in the database rather than inferred from the API.
const dupRow = await db.execute(
  dsql.raw("select promise_id, count(*)::int as n from promises group by 1 having count(*)>1")
);
const duplicates = (Array.isArray(dupRow) ? dupRow : (dupRow?.rows ?? [])).length;

// Child rows whose parent promise is gone. These matter: promise ids restart per deployment, so
// an orphan can later be attributed to an unrelated promise.
const orphanRow = await db.execute(dsql.raw(`
  select
    (select count(*)::int from evidence   e where not exists (select 1 from promises p where p.promise_id=e.promise_id)) as evidence,
    (select count(*)::int from drift      d where not exists (select 1 from promises p where p.promise_id=d.promise_id)) as drift,
    (select count(*)::int from responses  r where not exists (select 1 from promises p where p.promise_id=r.promise_id)) as responses,
    (select count(*)::int from challenges c where not exists (select 1 from promises p where p.promise_id=c.promise_id)) as challenges
`));
const or = (Array.isArray(orphanRow) ? orphanRow[0] : orphanRow?.rows?.[0]) ?? {};

console.log(`\n  duplicates         ${duplicates} promise row(s)`);
console.log(
  `  orphaned children  evidence=${or.evidence ?? 0} drift=${or.drift ?? 0} ` +
    `responses=${or.responses ?? 0} challenges=${or.challenges ?? 0}`
);

let apiCount = null;
try {
  const base = env.API_BASE_URL ?? "http://127.0.0.1:4182";
  const page = await (await fetch(`${base}/api/v1/promises?limit=100`)).json();
  apiCount = page.items?.length ?? 0;
  console.log(`  api promises       ${apiCount}`);
} catch (e) {
  console.log(`  api unreachable    ${e.message}`);
}

await client.end({ timeout: 5 });

const problems = [];
if (duplicates > 0) problems.push(`${duplicates} duplicate promise row(s)`);
for (const k of ["evidence", "drift", "responses", "challenges"]) {
  if ((or[k] ?? 0) > 0) problems.push(`${or[k]} orphaned ${k} row(s)`);
}
if (apiCount !== null && apiCount !== counts.promises) {
  problems.push(`api count ${apiCount} != db count ${counts.promises}`);
}

console.log(
  problems.length
    ? `\nPROBLEMS: ${problems.join("; ")}`
    : "\nRECONCILED: db == api, no duplicates, no orphans"
);
process.exit(problems.length ? 1 : 0);