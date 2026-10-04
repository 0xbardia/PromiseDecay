/**
 * PostgreSQL schema — the DERIVED projection of on-chain promise state.
 *
 * This database is a rebuildable cache/search layer. The GenLayer contract is
 * authoritative: dropping every table here and re-running the indexer must restore
 * identical derived state without a single user-facing write.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** A recorded public promise. The `quote`/`dna` columns mirror the immutable record. */
export const promises = pgTable(
  "promises",
  {
    id: serial("id").primaryKey(),
    promiseId: text("promise_id").notNull(),
    project: text("project").notNull(),
    projectSlug: text("project_slug").notNull(),
    actor: text("actor").notNull(),
    originalQuote: text("original_quote").notNull(),
    action: text("action").notNull(),
    object: text("object").notNull(),
    scope: text("scope").notNull(),
    deadlineTs: integer("deadline_ts").notNull(),
    conditions: text("conditions").notNull().default(""),
    sourceUrl: text("source_url").notNull(),
    creator: text("creator").notNull(),
    createdTs: integer("created_ts").notNull(),
    contractVersion: text("contract_version").notNull(),

    // Denormalised from the contract for feed rendering without extra joins.
    lifecycle: text("lifecycle").notNull().default("OPEN"),
    delivery: text("delivery"),
    integrity: text("integrity"),
    deadlineMet: boolean("deadline_met"),
    materialScopeChange: boolean("material_scope_change"),
    explanation: text("explanation"),
    decidedTs: integer("decided_ts"),

    isFinal: boolean("is_final").notNull().default(false),
    challengeCount: integer("challenge_count").notNull().default(0),
    evidenceCount: integer("evidence_count").notNull().default(0),
    driftCount: integer("drift_count").notNull().default(0),
    responseCount: integer("response_count").notNull().default(0),
    challengeClosesAt: integer("challenge_closes_at"),

    /** Full-text search surface, maintained by the indexer. */
    search: text("search"),

    indexedAt: timestamp("indexed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    promiseIdUnique: uniqueIndex("promises_promise_id_uq").on(t.promiseId),
    projectSlugIdx: index("promises_project_slug_idx").on(t.projectSlug),
    lifecycleIdx: index("promises_lifecycle_idx").on(t.lifecycle),
    // Feed ordering: newest first, tie-broken deterministically by id.
    feedIdx: index("promises_feed_idx").on(t.createdTs, t.promiseId),
    searchIdx: index("promises_search_idx").on(t.search),
  })
);

export const evidence = pgTable(
  "evidence",
  {
    id: serial("id").primaryKey(),
    promiseId: text("promise_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    submitter: text("submitter").notNull(),
    sourceUrl: text("source_url").notNull(),
    quote: text("quote").notNull(),
    kind: text("kind").notNull(),
    submittedTs: integer("submitted_ts").notNull(),
  },
  (t) => ({
    promiseOrdinalUnique: uniqueIndex("evidence_promise_ordinal_uq").on(
      t.promiseId,
      t.ordinal
    ),
    promiseIdx: index("evidence_promise_idx").on(t.promiseId),
  })
);

export const drift = pgTable(
  "drift",
  {
    id: serial("id").primaryKey(),
    promiseId: text("promise_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    submitter: text("submitter").notNull(),
    statement: text("statement").notNull(),
    sourceUrl: text("source_url").notNull(),
    submittedTs: integer("submitted_ts").notNull(),
    relationship: text("relationship").notNull(),
  },
  (t) => ({
    promiseOrdinalUnique: uniqueIndex("drift_promise_ordinal_uq").on(t.promiseId, t.ordinal),
    promiseIdx: index("drift_promise_idx").on(t.promiseId),
  })
);

export const responses = pgTable(
  "responses",
  {
    id: serial("id").primaryKey(),
    promiseId: text("promise_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    submitter: text("submitter").notNull(),
    statement: text("statement").notNull(),
    sourceUrl: text("source_url").notNull(),
    submittedTs: integer("submitted_ts").notNull(),
    /** Always false in V1 — ownership is not verified. */
    verified: boolean("verified").notNull().default(false),
  },
  (t) => ({
    promiseOrdinalUnique: uniqueIndex("responses_promise_ordinal_uq").on(
      t.promiseId,
      t.ordinal
    ),
    promiseIdx: index("responses_promise_idx").on(t.promiseId),
  })
);

export const challenges = pgTable(
  "challenges",
  {
    id: serial("id").primaryKey(),
    promiseId: text("promise_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    challenger: text("challenger").notNull(),
    reason: text("reason").notNull(),
    evidenceUrl: text("evidence_url").notNull(),
    submittedTs: integer("submitted_ts").notNull(),
  },
  (t) => ({
    promiseOrdinalUnique: uniqueIndex("challenges_promise_ordinal_uq").on(
      t.promiseId,
      t.ordinal
    ),
    promiseIdx: index("challenges_promise_idx").on(t.promiseId),
  })
);

/** Project-level aggregation, derived from promises. */
export const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    actor: text("actor").notNull(),
    promiseCount: integer("promise_count").notNull().default(0),
    finalCount: integer("final_count").notNull().default(0),
    resolvedCount: integer("resolved_count").notNull().default(0),
    openCount: integer("open_count").notNull().default(0),
    earliestDeadlineTs: integer("earliest_deadline_ts"),
    latestDeadlineTs: integer("latest_deadline_ts"),
    latestPromiseTs: integer("latest_promise_ts"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("projects_slug_uq").on(t.slug),
    activityIdx: index("projects_activity_idx").on(t.latestPromiseTs),
  })
);

/** Indexer bookkeeping: cursors and health, so a restart resumes where it left off. */
export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const schema = {
  promises,
  evidence,
  drift,
  responses,
  challenges,
  projects,
  indexerState,
};