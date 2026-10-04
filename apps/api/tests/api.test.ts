/**
 * API integration tests.
 *
 * Run against a real PostgreSQL test database. The app is exercised through Fastify's
 * inject, so these cover routing, validation, pagination, filters, search and the typed
 * error surface without opening a socket.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
import { runMigrations } from "../src/db/migrate.js";
import { createDatabase } from "../src/db/client.js";
import { promises as promisesTable, projects as projectsTable } from "../src/db/schema.js";
import { sql as dsql } from "drizzle-orm";

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:pdlocal@127.0.0.1:5432/promisedecay_test";

const env = {
  NODE_ENV: "test" as const,
  DATABASE_URL: TEST_DB,
  DATABASE_POOL_MAX: 2,
  GENLAYER_RPC_URL: "https://studio.genlayer.com/api",
  GENLAYER_CHAIN_ID: "61999",
  GENLAYER_NETWORK: "studionet",
  GENLAYER_CONTRACT_ADDRESS: "0x74f3E1E6c90b4Ff156FC01D564eB7DbBc865cC93",
  INDEXER_INTERVAL_MS: "15000",
  INDEXER_ENABLED: "true",
  API_PORT: "4181",
  API_HOST: "127.0.0.1",
  WEB_ORIGIN: "http://localhost:4180",
  LOG_LEVEL: "fatal" as const,
  RATE_LIMIT_WINDOW_MS: "60000",
  RATE_LIMIT_MAX: "1000",
  DEFAULT_PAGE_SIZE: "25",
  MAX_PAGE_SIZE: "50",
};

let sql: ReturnType<typeof postgres>;
let app: Awaited<ReturnType<typeof buildApp>>;
let db: ReturnType<typeof createDatabase>["db"];

const NOW = 1_800_000_000;

async function seed(rows: Array<Partial<typeof promisesTable.$inferInsert>> = []) {
  await db.delete(promisesTable);
  const defaults = rows.length ? rows : makeRows();
  for (const row of defaults) {
    await db.insert(promisesTable).values(row);
  }
}

function makeRows() {
  const base = {
    actor: "Acme Foundation",
    action: "launch",
    object: "public mainnet",
    scope: "public",
    conditions: "",
    sourceUrl: "https://acme.example/blog/mainnet",
    creator: "0xabc0000000000000000000000000000000000001",
    contractVersion: "1.0.0",
    lifecycle: "OPEN",
    search: "acme protocol public mainnet launch",
  };
  return [
    {
      ...base,
      promiseId: "1",
      project: "Acme Protocol",
      projectSlug: "acme-protocol",
      originalQuote: "Public mainnet will launch before September 30.",
      deadlineTs: NOW + 86400,
      createdTs: NOW,
      delivery: "PARTIAL",
      integrity: "NARROWED",
      isFinal: true,
      lifecycle: "FINAL",
      evidenceCount: 2,
      driftCount: 1,
      responseCount: 1,
      challengeCount: 0,
    },
    {
      ...base,
      promiseId: "2",
      project: "Northwind Labs",
      projectSlug: "northwind-labs",
      originalQuote: "The full protocol will be released under a public licence.",
      deadlineTs: NOW + 172800,
      createdTs: NOW + 100,
      delivery: "KEPT",
      integrity: "UNCHANGED",
      isFinal: false,
      lifecycle: "CHALLENGE_WINDOW",
      evidenceCount: 1,
    },
    {
      ...base,
      promiseId: "3",
      project: "Orbital Labs",
      projectSlug: "orbital-labs",
      originalQuote: "A public testnet will ship to all registered developers.",
      deadlineTs: NOW + 259200,
      createdTs: NOW + 200,
      delivery: null,
      integrity: null,
      lifecycle: "OPEN",
      search: "orbital labs public testnet ship registered developers",
    },
  ];
}

beforeAll(async () => {
  sql = postgres(TEST_DB, { max: 2, onnotice: () => {} });
  await runMigrations(sql, { reset: true });
  const conn = createDatabase(TEST_DB, 2);
  db = conn.db;
  // buildApp is given the existing pool so tests do not open a second one.
  app = await buildApp({ env, db });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await sql?.end({ timeout: 5 });
});

beforeEach(async () => {
  await seed();
  await db.delete(projectsTable);
});

describe("health", () => {
  it("reports liveness without touching dependencies", async () => {
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("readiness requires both database and chain", async () => {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json();
    expect(body.checks).toHaveProperty("database");
    expect(body.checks).toHaveProperty("chain");
    if (res.statusCode === 503) expect(body.status).toBe("not-ready");
  });
});

describe("GET /api/v1/promises", () => {
  it("returns the feed newest-first with a limit", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises?limit=2" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(2);
    expect(body.limit).toBe(2);
    expect(Number(body.items[0].promiseId)).toBeGreaterThan(Number(body.items[1].promiseId));
  });

  it("filters by lifecycle", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises?lifecycle=FINAL" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].promiseId).toBe("1");
  });

  it("filters by delivery", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises?delivery=KEPT" });
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].promiseId).toBe("2");
  });

  it("rejects an unknown cursor with a typed error", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises?cursor=not-a-cursor" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_CURSOR");
  });

  it("paginates without repeating or skipping rows", async () => {
    const first = await app.inject({ method: "GET", url: "/api/v1/promises?limit=2" });
    const cursor = first.json().nextCursor;
    expect(cursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/promises?limit=2&cursor=${encodeURIComponent(cursor)}`,
    });
    const ids = [...first.json().items, ...second.json().items].map((p: { promiseId: string }) => p.promiseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("3");
  });

  it("caps the page size", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises?limit=5000" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });
});

describe("GET /api/v1/promises/:id", () => {
  it("returns the full record", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises/1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.promiseId).toBe("1");
    expect(body.originalQuote).toContain("Public mainnet");
    expect(Array.isArray(body.evidence)).toBe(true);
    expect(Array.isArray(body.drift)).toBe(true);
  });

  it("404s for an unknown promise", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises/9999" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a non-numeric id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises/abc" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("includes a request id in errors", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/promises/abc" });
    expect(res.json().error.requestId).toBeTruthy();
  });
});

describe("projects", () => {
  it("aggregates projects from promises", async () => {
    // Rebuild aggregates the way the indexer does.
    await db.execute(dsql`
      INSERT INTO projects (slug, name, actor, promise_count, final_count, resolved_count, open_count,
                            earliest_deadline_ts, latest_deadline_ts, latest_promise_ts)
      SELECT project_slug, MIN(project), MIN(actor), COUNT(*),
             COUNT(*) FILTER (WHERE is_final),
             COUNT(*) FILTER (WHERE delivery IS NOT NULL),
             COUNT(*) FILTER (WHERE lifecycle = 'OPEN'),
             MIN(deadline_ts), MAX(deadline_ts), MAX(created_ts)
      FROM promises GROUP BY project_slug
    `);
    const res = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(3);
  });

  it("paginates projects with a working cursor", async () => {
    // Regression test: `/api/v1/projects` used to accept a cursor, ignore it, and still hand
    // back a `nextCursor`. Following that cursor returned page one forever, with nothing to
    // signal the fault. A cursor that does not paginate is worse than no cursor.
    await db.delete(projectsTable);
    // Five projects with staggered activity, so the (latest_promise_ts DESC, slug DESC)
    // ordering is unambiguous and keyset pagination is actually exercised.
    for (let i = 0; i < 5; i++) {
      await db.insert(projectsTable).values({
        slug: `proj-${i}`,
        name: `Project ${i}`,
        actor: `Actor ${i}`,
        promiseCount: 1,
        finalCount: 0,
        resolvedCount: 0,
        openCount: 1,
        latestPromiseTs: NOW - i * 1000,
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url: string = `/api/v1/projects?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      seen.push(...body.items.map((p: { slug: string }) => p.slug));
      cursor = body.nextCursor ?? undefined;
      if (!cursor) break;
    }

    // Every project appears exactly once, and in the documented order.
    expect(seen).toEqual(["proj-0", "proj-1", "proj-2", "proj-3", "proj-4"]);
    expect(new Set(seen).size).toBe(5);
  });

  it("rejects a malformed project cursor", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/projects?cursor=not-a-cursor" });
    expect(res.statusCode).toBe(400);
  });

  it("returns a project with its history", async () => {
    await db.insert(projectsTable).values({
      slug: "acme-protocol",
      name: "Acme Protocol",
      actor: "Acme Foundation",
      promiseCount: 1,
      finalCount: 1,
      resolvedCount: 1,
      openCount: 0,
      latestPromiseTs: NOW,
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/projects/acme-protocol" });
    expect(res.statusCode).toBe(200);
    expect(res.json().promises).toHaveLength(1);
  });

  it("404s for an unknown project", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/projects/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/search", () => {
  it("finds promises by term", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=mainnet" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeGreaterThan(0);
  });

  it("returns nothing for a term with no match", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/search?q=zzzznotpresent" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(0);
  });

  it("requires a query", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/search" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
  });

  it("does not let punctuation inject query syntax", async () => {
    // A tsquery injection attempt must simply return nothing, not error or match all.
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/search?q=" + encodeURIComponent("'; DROP TABLE promises; --"),
    });
    expect(res.statusCode).toBe(200);
    // The table must still exist.
    const after = await app.inject({ method: "GET", url: "/api/v1/promises" });
    expect(after.statusCode).toBe(200);
  });
});

describe("unknown routes", () => {
  it("404s with a typed error", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("rejects a write method on a read-only API", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/promises" });
    expect(res.statusCode).toBe(404);
  });
});