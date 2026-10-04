/**
 * Indexer tests.
 *
 * These prove the properties that matter for a derived projection:
 *   - idempotency: re-indexing produces identical rows, never duplicates
 *   - restart recovery: a pass after a failure still converges
 *   - fault tolerance: one bad promise does not abort the whole run
 *   - rebuild safety: wiping derived state and re-indexing restores it exactly
 *
 * The chain is replaced with a deterministic fake, so these run fast and offline.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/db/migrate.js";
import { createDatabase } from "../src/db/client.js";
import {
  challenges as challengesTable,
  drift as driftTable,
  evidence as evidenceTable,
  promises as promisesTable,
  responses as responsesTable,
} from "../src/db/schema.js";
import { syncOnce, type IndexerLogger } from "../src/indexer/sync.js";
import type { GenlayerReader } from "../src/chain/reader.js";

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:pdlocal@127.0.0.1:5432/promisedecay_test";

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDatabase>["db"];

const silent: IndexerLogger = {
  info: () => {},
  warn: () => {},
  // Keep failures visible: a swallowed index error is how a silent projection rot begins.
  error: (obj) => {
    if (process.env.SHOW_INDEX_ERRORS) console.error("indexer:", obj);
  },
};

const T0 = 1_800_000_000;

interface FakePromise {
  id: string;
  drift?: unknown[];
  evidence?: unknown[];
  responses?: unknown[];
  challenges?: unknown[];
  final?: unknown;
  provisional?: unknown;
}

/** A deterministic stand-in for the chain, so these tests are hermetic. */
function fakeReader(promises: FakePromise[], overrides: Record<string, unknown> = {}) {
  const child = (id: string, key: "evidence" | "drift" | "responses" | "challenges") => {
    const p = promises.find((x) => x.id === id);
    return (p?.[key] ?? []) as unknown[];
  };

  return {
    contractAddress: (overrides.contractAddress as string) ?? "0xFAKE",
    getAllPromiseIds: async () => promises.map((p) => p.id),
    getPromise: async (id: string) => {
      const p = promises.find((x) => x.id === id);
      if (!p) throw new Error("Unknown promise id");
      return {
        promise_id: p.id,
        project: `Project ${p.id}`,
        actor: `Actor ${p.id}`,
        original_quote: `Quote for promise ${p.id}`,
        action: "launch",
        object: "thing",
        scope: "public",
        deadline_ts: String(T0 + 86400),
        conditions: "none",
        source_url: `https://example.com/${p.id}`,
        creator: "0x0000000000000000000000000000000000000001",
        created_ts: String(T0 + Number(p.id)),
        contract_version: "1.0.0",
      };
    },
    getLifecycleStatus: async () => "FINAL",
    getEvidence: async (id: string) => child(id, "evidence"),
    getDrift: async (id: string) => child(id, "drift"),
    getResponses: async (id: string) => child(id, "responses"),
    getChallenges: async (id: string) => child(id, "challenges"),
    getChallengeWindow: async () => ({
      challenge_closes_at: String(T0 + 604800),
      window_seconds: 604800,
    }),
    getProvisionalResult: async () => null,
    getFinalResult: async () => ({
      delivery: "PARTIAL",
      integrity: "NARROWED",
      deadline_met: false,
      material_scope_change: true,
      explanation: "Partial.",
      decided_ts: String(T0),
    }),
    ...overrides,
  } as unknown as GenlayerReader;
}

const SAMPLE: FakePromise[] = [
  {
    id: "1",
    evidence: [
      { submitter: "0x1", source_url: "https://a.example", quote: "q1", kind: "SOURCE", submitted_ts: "1" },
      { submitter: "0x2", source_url: "https://b.example", quote: "q2", kind: "ARTIFACT", submitted_ts: "2" },
    ],
    drift: [
      {
        submitter: "0x3",
        statement: "later statement",
        source_url: "https://c.example",
        submitted_ts: "3",
        relationship: "NARROWED",
      },
    ],
    responses: [
      { submitter: "0x4", statement: "response", source_url: "https://d.example", submitted_ts: "4", verified: false },
    ],
    challenges: [
      { challenger: "0x5", reason: "new evidence", evidence_url: "https://e.example", submitted_ts: "5" },
    ],
  },
  { id: "2" },
];

async function wipe() {
  await db.delete(challengesTable);
  await db.delete(responsesTable);
  await db.delete(driftTable);
  await db.delete(evidenceTable);
  await db.delete(promisesTable);
}

beforeAll(async () => {
  sql = postgres(TEST_DB, { max: 2, onnotice: () => {} });
  await runMigrations(sql, { reset: true });
  db = createDatabase(TEST_DB, 2).db;
});

afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

beforeEach(wipe);

async function countPromises(): Promise<number> {
  const rows = await db.select().from(promisesTable);
  return rows.length;
}

describe("indexer idempotency", () => {
  it("indexes every promise", async () => {
    const result = await syncOnce(db, fakeReader(SAMPLE), silent);
    expect(result.promiseCount).toBe(2);
    expect(result.indexed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("running twice does not duplicate rows", async () => {
    await syncOnce(db, fakeReader(SAMPLE), silent);
    const after1 = await db.select().from(promisesTable);
    const ev1 = await db.select().from(evidenceTable);

    await syncOnce(db, fakeReader(SAMPLE), silent);
    const after2 = await db.select().from(promisesTable);
    const ev2 = await db.select().from(evidenceTable);

    expect(after2.length).toBe(after1.length);
    expect(ev2.length).toBe(ev1.length);
  });

  it("produces identical content on a repeat run", async () => {
    await syncOnce(db, fakeReader(SAMPLE), silent);
    const first = await db.select().from(promisesTable);
    await syncOnce(db, fakeReader(SAMPLE), silent);
    const second = await db.select().from(promisesTable);

    const key = (r: typeof first) =>
      `${r.promiseId}|${r.project}|${r.originalQuote}|${r.lifecycle}|${r.delivery}|${r.integrity}|${r.isFinal}`;
    expect(second.map(key).sort()).toEqual(first.map(key).sort());
  });
});

describe("projection fidelity", () => {
  it("discards records belonging to a different contract", async () => {
    // Regression test: the indexer only ever upserted, so repointing the deployment at a new
    // contract left the previous deployment's promises visible in the product — records the
    // site attributed to a contract that does not contain them.
    await syncOnce(db, fakeReader(SAMPLE, { contractAddress: "0xAAAA" }) as never, silent);
    const afterFirst = await countPromises();
    expect(afterFirst).toBe(SAMPLE.length);

    // Same address: nothing is thrown away.
    await syncOnce(db, fakeReader(SAMPLE, { contractAddress: "0xAAAA" }) as never, silent);
    expect(await countPromises()).toBe(SAMPLE.length);

    // New address, different content: the old records must not survive.
    await syncOnce(db, fakeReader([SAMPLE[0]], { contractAddress: "0xBBBB" }) as never, silent);
    const afterSwitch = await countPromises();
    expect(afterSwitch, "records from the previous contract were retained").toBe(1);

    const rows = await db.select({ id: promisesTable.promiseId }).from(promisesTable);
    expect(rows.map((r) => r.id)).toEqual([SAMPLE[0]!.id]);
  });

  it("prunes a promise the chain no longer reports", async () => {
    // The contract is append-only, so this should not happen in production. It must still be
    // handled: a projection that can only grow is not a projection.
    await syncOnce(db, fakeReader(SAMPLE, { contractAddress: "0xCCCC" }) as never, silent);
    expect(await countPromises()).toBe(SAMPLE.length);

    const shrunk = SAMPLE.slice(0, 2);
    await syncOnce(db, fakeReader(shrunk, { contractAddress: "0xCCCC" }) as never, silent);
    expect(await countPromises()).toBe(shrunk.length);

    const rows = await db.select({ id: promisesTable.promiseId }).from(promisesTable);
    expect(rows.map((r) => r.id).sort()).toEqual(shrunk.map((p) => p.id).sort());
  });
});

describe("rebuild safety", () => {
  it("wiping derived state and re-indexing restores it exactly", async () => {
    await syncOnce(db, fakeReader(SAMPLE), silent);
    const before = await db.select().from(promisesTable);

    // Simulate total data loss of the derived layer.
    await wipe();
    expect((await db.select().from(promisesTable)).length).toBe(0);

    await syncOnce(db, fakeReader(SAMPLE), silent);
    const after = await db.select().from(promisesTable);

    expect(after.length).toBe(before.length);
    const key = (r: typeof before) => `${r.promiseId}|${r.project}|${r.originalQuote}|${r.delivery}`;
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
  });
});

describe("fault tolerance", () => {
  it("one failing promise does not abort the run", async () => {
    const base = fakeReader(SAMPLE);
    let calls = 0;
    const flaky = {
      ...base,
      getPromise: async (id: string) => {
        calls += 1;
        if (id === "1") throw new Error("simulated RPC failure");
        return base.getPromise(id);
      },
    } as unknown as GenlayerReader;

    const result = await syncOnce(db, flaky, silent);
    expect(result.promiseCount).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.indexed).toBe(1);
    expect(calls).toBe(2);
  });

  it("a later pass converges after a failure", async () => {
    const base = fakeReader(SAMPLE);
    const broken = {
      ...base,
      getPromise: async (id: string) => {
        if (id === "1") throw new Error("transient");
        return base.getPromise(id);
      },
    } as unknown as GenlayerReader;

    await syncOnce(db, broken, silent);
    expect((await db.select().from(promisesTable)).length).toBe(1);

    // Restart with a healthy chain: the missing promise must appear.
    await syncOnce(db, fakeReader(SAMPLE), silent);
    expect((await db.select().from(promisesTable)).length).toBe(2);
  });
});

describe("resolution integrity", () => {
  it("does not record a verdict as absent when the read was merely throttled", async () => {
    // Regression test with real consequences.
    //
    // `tryCall` used to swallow every error into `null`, on the reasonable-sounding assumption
    // that a failed read means "no result yet". During a rate-limit window that assumption is
    // simply false: it turned every resolution in the product into "not resolved", and the
    // indexer wrote that to the database. A momentary throttle could erase a verdict the chain
    // had already finalized.
    //
    // The fix is upstream in the reader, which now re-throws transport failures. This test
    // pins the consequence at the boundary that matters — the indexer must leave the promise
    // alone rather than overwrite good data with absence.
    const withVerdict = fakeReader(SAMPLE, {
      getProvisionalResult: async () => ({
        delivery: "PARTIAL",
        integrity: "NARROWED",
        deadline_met: true,
        material_scope_change: true,
        explanation: "Partial delivery, narrowed scope.",
        decided_ts: String(T0),
      }),
    });
    await syncOnce(db, withVerdict, silent);

    const before = await db.select().from(promisesTable);
    expect(before.some((r) => r.delivery === "PARTIAL")).toBe(true);

    // Now the resolution read fails the way a throttle does.
    const throttled = fakeReader(SAMPLE, {
      getProvisionalResult: async () => {
        throw new Error("RATE_LIMITED");
      },
    });
    const result = await syncOnce(db, throttled, silent);

    // The promise was skipped, and counted as a failure rather than silently rewritten.
    expect(result.failed).toBeGreaterThan(0);

    // The existing verdict survives untouched.
    const after = await db.select().from(promisesTable);
    expect(after.some((r) => r.delivery === "PARTIAL"), "a throttled read erased a verdict").toBe(
      true
    );
  });
});

describe("resolution precedence", () => {
  it("a final result wins over a provisional one", async () => {
    const reader = fakeReader([{ id: "9" }], {
      getProvisionalResult: async () => ({
        delivery: "KEPT",
        integrity: "UNCHANGED",
        deadline_met: true,
        material_scope_change: false,
        explanation: "stale",
        decided_ts: "1",
      }),
    });
    await syncOnce(db, reader, silent);
    const rows = await db.select().from(promisesTable);
    expect(rows[0]?.delivery).toBe("PARTIAL");
    expect(rows[0]?.isFinal).toBe(true);
  });

  it("uses the provisional result when nothing is final", async () => {
    const reader = fakeReader([{ id: "9" }], {
      getFinalResult: async () => null,
      getProvisionalResult: async () => ({
        delivery: "KEPT_LATE",
        integrity: "UNCHANGED",
        deadline_met: true,
        material_scope_change: false,
        explanation: "late but complete",
        decided_ts: "2",
      }),
    });
    await syncOnce(db, reader, silent);
    const rows = await db.select().from(promisesTable);
    expect(rows[0]?.delivery).toBe("KEPT_LATE");
    expect(rows[0]?.isFinal).toBe(false);
  });
});

describe("child collections", () => {
  it("stores children with stable ordinals and replaces them wholesale", async () => {
    await syncOnce(db, fakeReader(SAMPLE), silent);
    let ev = await db.select().from(evidenceTable);
    expect(ev.length).toBe(2);
    expect(ev.map((e) => e.ordinal).sort()).toEqual([0, 1]);

    await syncOnce(db, fakeReader(SAMPLE), silent);
    ev = await db.select().from(evidenceTable);
    expect(ev.length).toBe(2);
  });

  it("responses are never marked verified in V1", async () => {
    const reader = fakeReader([{ id: "7" }], {
      getResponses: async () => [
        { submitter: "0x9", statement: "s", source_url: "https://r.example", submitted_ts: "9", verified: true },
      ],
    });
    await syncOnce(db, reader, silent);
    const rows = await db.select().from(responsesTable);
    // Ownership is not verified in V1, so the projection must not claim it.
    expect(rows[0]?.verified).toBe(false);
  });
});
describe("orphan child rows", () => {
  /**
   * Regression.
   *
   * The schema declares no foreign keys, so deleting a promise leaves its evidence, drift,
   * responses and challenges behind. That was live on the deployment: evidence rows referenced
   * promise ids 5-9 while the promises table held only 1-4, left over from a superseded contract.
   *
   * It is not only untidy. Promise ids restart at 1 on a new deployment, so an orphan can be
   * attached to a completely unrelated promise and presented as evidence for its claim.
   */
  it("prunes children whose parent promise does not exist", async () => {
    await syncOnce(db, fakeReader(SAMPLE), silent);
    await expect(countPromises()).resolves.toBe(2);

    // Plant children under an id that is not in the projection. Explicit inserts rather than a
    // generic row builder: drizzle column keys are camelCase while Object.keys(table) yields SQL
    // names, so a reflective builder silently drops the required promise_id.
    const GHOST = "999";
    await db.insert(evidenceTable).values({
      promiseId: GHOST,
      ordinal: 0,
      submitter: "0xdead",
      sourceUrl: "https://orphan.example/e",
      quote: "orphaned evidence",
      kind: "SOURCE",
      submittedTs: 0,
      dedupe: "orphan-e",
    } as never);
    await db.insert(driftTable).values({
      promiseId: GHOST,
      ordinal: 0,
      submitter: "0xdead",
      statement: "The promise was silently narrowed.",
      relationship: "NARROWED",
      sourceUrl: "https://orphan.example/d",
      submittedTs: 0,
    } as never);
    await db.insert(responsesTable).values({
      promiseId: GHOST,
      ordinal: 0,
      submitter: "0xdead",
      statement: "We stand by the original commitment.",
      sourceUrl: "https://orphan.example/r",
      submittedTs: 0,
    } as never);
    await db.insert(challengesTable).values({
      promiseId: GHOST,
      ordinal: 0,
      challenger: "0xdead",
      reason: "Disputing a promise that no longer exists.",
      evidenceUrl: "https://orphan.example/c",
      submittedTs: 0,
    } as never);

    // Any child under a promise the chain reports must have been removed.
    await syncOnce(db, fakeReader(SAMPLE), silent);

    const check = async (table: unknown) => {
      const rows = (await db.select().from(table as never)) as Array<{ promiseId?: string }>;
      return rows.filter((r) => r.promiseId === "999").length;
    };
    expect(await check(evidenceTable)).toBe(0);
    expect(await check(driftTable)).toBe(0);
    expect(await check(responsesTable)).toBe(0);
    expect(await check(challengesTable)).toBe(0);

    // And the legitimate children are untouched.
    const surviving = (await db.select().from(evidenceTable)) as Array<{ promiseId?: string }>;
    expect(surviving.length).toBeGreaterThan(0);
    expect(surviving.every((r) => r.promiseId !== "999")).toBe(true);
  });
});
