/**
 * Promise repository: all SQL lives here so route handlers stay declarative.
 *
 * Every function returns plain data and is safe to call concurrently with the indexer.
 */
import { and, asc, desc, eq, isNull, lt, or, sql as dsql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { slugifyProject } from "@promisedecay/domain";
import type { Database } from "../db/client.js";
import {
  challenges,
  drift,
  evidence,
  indexerState,
  promises,
  projects,
  responses,
} from "../db/schema.js";
import {
  buildSearchText,
  encodeCursor,
  encodeProjectCursor,
  toPlainTsQuery,
  type Cursor,
  type ProjectCursor,
} from "../lib/http.js";

export interface PromiseRow {
  promiseId: string;
  project: string;
  projectSlug: string;
  actor: string;
  originalQuote: string;
  action: string;
  object: string;
  scope: string;
  deadlineTs: number;
  conditions: string;
  sourceUrl: string;
  creator: string;
  createdTs: number;
  contractVersion: string;
  lifecycle: string;
  delivery: string | null;
  integrity: string | null;
  deadlineMet: boolean | null;
  materialScopeChange: boolean | null;
  explanation: string | null;
  decidedTs: number | null;
  isFinal: boolean;
  challengeCount: number;
  evidenceCount: number;
  driftCount: number;
  responseCount: number;
  challengeClosesAt: number | null;
  indexedAt: Date;
}

export interface PromiseDetail extends PromiseRow {
  evidence: EvidenceItem[];
  drift: DriftItem[];
  responses: ResponseItem[];
  challenges: ChallengeItem[];
}

export interface EvidenceItem {
  submitter: string;
  sourceUrl: string;
  quote: string;
  kind: string;
  submittedTs: number;
}

export interface DriftItem {
  submitter: string;
  statement: string;
  sourceUrl: string;
  submittedTs: number;
  relationship: string;
}

export interface ResponseItem {
  submitter: string;
  statement: string;
  sourceUrl: string;
  submittedTs: number;
  verified: boolean;
}

export interface ChallengeItem {
  challenger: string;
  reason: string;
  evidenceUrl: string;
  submittedTs: number;
}

/** Convert BIGINT columns (returned as strings by postgres.js) to numbers. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapPromise(row: Record<string, unknown>): PromiseRow {
  return {
    promiseId: String(row.promiseId),
    project: String(row.project),
    projectSlug: String(row.projectSlug),
    actor: String(row.actor),
    originalQuote: String(row.originalQuote),
    action: String(row.action),
    object: String(row.object),
    scope: String(row.scope),
    deadlineTs: toNumber(row.deadlineTs),
    conditions: String(row.conditions ?? ""),
    sourceUrl: String(row.sourceUrl),
    creator: String(row.creator),
    createdTs: toNumber(row.createdTs),
    contractVersion: String(row.contractVersion),
    lifecycle: String(row.lifecycle),
    delivery: row.delivery === null || row.delivery === undefined ? null : String(row.delivery),
    integrity:
      row.integrity === null || row.integrity === undefined ? null : String(row.integrity),
    deadlineMet:
      row.deadlineMet === null || row.deadlineMet === undefined ? null : Boolean(row.deadlineMet),
    materialScopeChange:
      row.materialScopeChange === null || row.materialScopeChange === undefined
        ? null
        : Boolean(row.materialScopeChange),
    explanation:
      row.explanation === null || row.explanation === undefined ? null : String(row.explanation),
    decidedTs: row.decidedTs === null || row.decidedTs === undefined ? null : toNumber(row.decidedTs),
    isFinal: Boolean(row.isFinal),
    challengeCount: toNumber(row.challengeCount),
    evidenceCount: toNumber(row.evidenceCount),
    driftCount: toNumber(row.driftCount),
    responseCount: toNumber(row.responseCount),
    challengeClosesAt:
      row.challengeClosesAt === null || row.challengeClosesAt === undefined
        ? null
        : toNumber(row.challengeClosesAt),
    indexedAt: row.indexedAt instanceof Date ? row.indexedAt : new Date(String(row.indexedAt)),
  };
}

// ---------------------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------------------

export interface FeedFilters {
  lifecycle?: string[];
  delivery?: string[];
  integrity?: string[];
  projectSlug?: string;
  cursor?: Cursor;
  limit: number;
}

export async function listPromises(db: Database, filters: FeedFilters) {
  const where: SQL[] = [];

  if (filters.lifecycle?.length) {
    where.push(inArray(promises.lifecycle, filters.lifecycle));
  }
  if (filters.delivery?.length) {
    where.push(inArray(promises.delivery, filters.delivery));
  }
  if (filters.integrity?.length) {
    where.push(inArray(promises.integrity, filters.integrity));
  }
  if (filters.projectSlug) {
    where.push(eq(promises.projectSlug, filters.projectSlug));
  }
  if (filters.cursor) {
    // Keyset: strictly older than the cursor position in (created_ts, promise_id) order.
    where.push(
      or(
        lt(promises.createdTs, filters.cursor.createdTs),
        and(
          eq(promises.createdTs, filters.cursor.createdTs),
          lt(promises.promiseId, filters.cursor.promiseId)
        )
      )!
    );
  }

  const rows = await db
    .select()
    .from(promises)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(promises.createdTs), desc(promises.promiseId))
    .limit(filters.limit + 1);

  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((r) => mapPromise(r as Record<string, unknown>)),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            createdTs: toNumber((last as Record<string, unknown>).createdTs),
            promiseId: String((last as Record<string, unknown>).promiseId),
          })
        : null,
  };
}

/** OR-chain membership test. Generic over any text column so filters stay typed. */
function inArray<TColumn extends PgColumn>(column: TColumn, values: string[]) {
  return or(...values.map((v) => eq(column, v)))!;
}

// ---------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------

export async function getPromiseDetail(
  db: Database,
  promiseId: string
): Promise<PromiseDetail | null> {
  const rows = await db.select().from(promises).where(eq(promises.promiseId, promiseId)).limit(1);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const base = mapPromise(row);

  const [ev, dr, rs, ch] = await Promise.all([
    db.select().from(evidence).where(eq(evidence.promiseId, promiseId)).orderBy(asc(evidence.ordinal)),
    db.select().from(drift).where(eq(drift.promiseId, promiseId)).orderBy(asc(drift.ordinal)),
    db
      .select()
      .from(responses)
      .where(eq(responses.promiseId, promiseId))
      .orderBy(asc(responses.ordinal)),
    db
      .select()
      .from(challenges)
      .where(eq(challenges.promiseId, promiseId))
      .orderBy(asc(challenges.ordinal)),
  ]);

  return {
    ...base,
    evidence: ev.map((e) => ({
      submitter: e.submitter,
      sourceUrl: e.sourceUrl,
      quote: e.quote,
      kind: e.kind,
      submittedTs: toNumber(e.submittedTs),
    })),
    drift: dr.map((d) => ({
      submitter: d.submitter,
      statement: d.statement,
      sourceUrl: d.sourceUrl,
      submittedTs: toNumber(d.submittedTs),
      relationship: d.relationship,
    })),
    responses: rs.map((r) => ({
      submitter: r.submitter,
      statement: r.statement,
      sourceUrl: r.sourceUrl,
      submittedTs: toNumber(r.submittedTs),
      verified: r.verified,
    })),
    challenges: ch.map((c) => ({
      challenger: c.challenger,
      reason: c.reason,
      evidenceUrl: c.evidenceUrl,
      submittedTs: toNumber(c.submittedTs),
    })),
  };
}

// ---------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------

/**
 * Projects, newest activity first, with keyset pagination.
 *
 * The cursor is applied rather than merely accepted. An earlier version took a `cursor`
 * argument, ignored it, and still returned a `nextCursor` — so a client that followed the
 * cursor would have been handed page one forever, with no error to signal the problem. A
 * cursor that does not paginate is worse than no cursor, so it is implemented here.
 */
export async function listProjects(db: Database, limit: number, cursor?: ProjectCursor) {
  const where: SQL[] = [];

  if (cursor) {
    // Strictly "after" the cursor in (latest_promise_ts DESC, slug DESC) order. NULLs sort
    // last under DESC in PostgreSQL, so a project with no promises is never skipped: it is
    // only ever reached on a cursor whose timestamp is already NULL.
    const ts = cursor.latestPromiseTs === null ? null : Number(cursor.latestPromiseTs);
    where.push(
      ts === null
        ? isNull(projects.latestPromiseTs)
        : or(
            lt(projects.latestPromiseTs, ts),
            and(eq(projects.latestPromiseTs, ts), lt(projects.slug, cursor.slug))
          )!
    );
  }

  const rows = await db
    .select()
    .from(projects)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(projects.latestPromiseTs), desc(projects.slug))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    items: page.map((p) => ({
      slug: p.slug,
      name: p.name,
      actor: p.actor,
      promiseCount: p.promiseCount,
      finalCount: p.finalCount,
      resolvedCount: p.resolvedCount,
      openCount: p.openCount,
      latestPromiseTs: p.latestPromiseTs === null ? null : toNumber(p.latestPromiseTs),
    })),
    nextCursor:
      hasMore && last
        ? encodeProjectCursor({
            latestPromiseTs: last.latestPromiseTs === null ? null : toNumber(last.latestPromiseTs),
            slug: last.slug,
          })
        : null,
  };
}

export async function getProject(db: Database, slug: string) {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  const project = rows[0];
  if (!project) return null;

  const history = await db
    .select()
    .from(promises)
    .where(eq(promises.projectSlug, slug))
    .orderBy(desc(promises.createdTs), desc(promises.promiseId))
    .limit(200);

  return {
    slug: project.slug,
    name: project.name,
    actor: project.actor,
    promiseCount: project.promiseCount,
    finalCount: project.finalCount,
    resolvedCount: project.resolvedCount,
    openCount: project.openCount,
    promises: history.map((h) => mapPromise(h as Record<string, unknown>)),
  };
}

// ---------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------

/**
 * Full-text search over indexed promise text only.
 *
 * Untrusted evidence/drift/response text is intentionally NOT indexed: a submitter must
 * not be able to plant search results in someone else's promise.
 */
export async function searchPromises(
  db: Database,
  query: string,
  limit: number,
  cursor?: Cursor
): Promise<{ items: PromiseRow[]; nextCursor: string | null }> {
  // Use the shared sanitiser: letters and digits only, so a caller can never supply
  // tsquery syntax. An empty result means "no results", not "match everything".
  const plain = toPlainTsQuery(query);
  if (plain.length === 0) return { items: [], nextCursor: null };

  const rows = await db.execute(dsql`
    SELECT * FROM promises
    WHERE search @@ to_tsquery('english', ${plain})
      AND (
        ${cursor ? cursor.createdTs : -1} = -1
        OR created_ts < ${cursor ? cursor.createdTs : -1}
        OR (created_ts = ${cursor ? cursor.createdTs : -1} AND promise_id < ${cursor ? cursor.promiseId : ""})
      )
    ORDER BY created_ts DESC, promise_id DESC
    LIMIT ${limit + 1}
  `);

  const list = (rows as unknown as { rows?: Record<string, unknown>[] }).rows ?? (rows as unknown as Record<string, unknown>[]);
  const arr = Array.isArray(list) ? list : [];
  const hasMore = arr.length > limit;
  const page = hasMore ? arr.slice(0, limit) : arr;
  const last = page[page.length - 1];

  return {
    items: page.map((r) => mapPromise(r)),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            createdTs: toNumber(last.created_ts ?? last.createdTs),
            promiseId: String(last.promise_id ?? last.promiseId),
          })
        : null,
  };
}

// ---------------------------------------------------------------------------------------
// Indexer bookkeeping
// ---------------------------------------------------------------------------------------

export async function setIndexerState(
  db: Database,
  key: string,
  value: string
): Promise<void> {
  await db
    .insert(indexerState)
    .values({ key, value })
    .onConflictDoUpdate({ target: indexerState.key, set: { value, updatedAt: new Date() } });
}

export async function getIndexerState(db: Database, key: string): Promise<string | null> {
  const rows = await db.select().from(indexerState).where(eq(indexerState.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export { buildSearchText, slugifyProject };