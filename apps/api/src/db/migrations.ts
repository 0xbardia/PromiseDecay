/**
 * Raw SQL migrations.
 *
 * Plain SQL rather than generated diffs: the statements stay reviewable, and drizzle-kit
 * is used only to regenerate this file. Applied in filename order and recorded in
 * `schema_migrations`, so re-running is a no-op.
 */

export interface Migration {
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    name: "0001_init",
    sql: `
CREATE TABLE IF NOT EXISTS promises (
  id                    SERIAL PRIMARY KEY,
  promise_id            TEXT NOT NULL,
  project               TEXT NOT NULL,
  project_slug          TEXT NOT NULL,
  actor                 TEXT NOT NULL,
  original_quote        TEXT NOT NULL,
  action                TEXT NOT NULL,
  object                TEXT NOT NULL,
  scope                 TEXT NOT NULL,
  deadline_ts           BIGINT NOT NULL,
  conditions            TEXT NOT NULL DEFAULT '',
  source_url            TEXT NOT NULL,
  creator               TEXT NOT NULL,
  created_ts            BIGINT NOT NULL,
  contract_version      TEXT NOT NULL,
  lifecycle             TEXT NOT NULL DEFAULT 'OPEN',
  delivery              TEXT,
  integrity             TEXT,
  deadline_met          BOOLEAN,
  material_scope_change BOOLEAN,
  explanation           TEXT,
  decided_ts            BIGINT,
  is_final              BOOLEAN NOT NULL DEFAULT FALSE,
  challenge_count       INTEGER NOT NULL DEFAULT 0,
  evidence_count        INTEGER NOT NULL DEFAULT 0,
  drift_count           INTEGER NOT NULL DEFAULT 0,
  response_count        INTEGER NOT NULL DEFAULT 0,
  challenge_closes_at   BIGINT,
  search                TEXT,
  indexed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS promises_promise_id_uq ON promises (promise_id);
CREATE INDEX IF NOT EXISTS promises_project_slug_idx ON promises (project_slug);
CREATE INDEX IF NOT EXISTS promises_lifecycle_idx ON promises (lifecycle);
CREATE INDEX IF NOT EXISTS promises_feed_idx ON promises (created_ts DESC, promise_id DESC);
CREATE INDEX IF NOT EXISTS promises_search_idx ON promises USING GIN (to_tsvector('english', coalesce(search, '')));

CREATE TABLE IF NOT EXISTS evidence (
  id            SERIAL PRIMARY KEY,
  promise_id    TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  submitter     TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  quote         TEXT NOT NULL,
  kind          TEXT NOT NULL,
  submitted_ts  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_promise_ordinal_uq ON evidence (promise_id, ordinal);
CREATE INDEX IF NOT EXISTS evidence_promise_idx ON evidence (promise_id);

CREATE TABLE IF NOT EXISTS drift (
  id            SERIAL PRIMARY KEY,
  promise_id    TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  submitter     TEXT NOT NULL,
  statement     TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  submitted_ts  BIGINT NOT NULL,
  relationship  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS drift_promise_ordinal_uq ON drift (promise_id, ordinal);
CREATE INDEX IF NOT EXISTS drift_promise_idx ON drift (promise_id);

CREATE TABLE IF NOT EXISTS responses (
  id            SERIAL PRIMARY KEY,
  promise_id    TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  submitter     TEXT NOT NULL,
  statement     TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  submitted_ts  BIGINT NOT NULL,
  verified      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS responses_promise_ordinal_uq ON responses (promise_id, ordinal);
CREATE INDEX IF NOT EXISTS responses_promise_idx ON responses (promise_id);

CREATE TABLE IF NOT EXISTS challenges (
  id            SERIAL PRIMARY KEY,
  promise_id    TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  challenger    TEXT NOT NULL,
  reason        TEXT NOT NULL,
  evidence_url  TEXT NOT NULL,
  submitted_ts  BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS challenges_promise_ordinal_uq ON challenges (promise_id, ordinal);
CREATE INDEX IF NOT EXISTS challenges_promise_idx ON challenges (promise_id);

CREATE TABLE IF NOT EXISTS projects (
  id                    SERIAL PRIMARY KEY,
  slug                  TEXT NOT NULL,
  name                  TEXT NOT NULL,
  actor                 TEXT NOT NULL,
  promise_count         INTEGER NOT NULL DEFAULT 0,
  final_count           INTEGER NOT NULL DEFAULT 0,
  resolved_count        INTEGER NOT NULL DEFAULT 0,
  open_count            INTEGER NOT NULL DEFAULT 0,
  earliest_deadline_ts  BIGINT,
  latest_deadline_ts    BIGINT,
  latest_promise_ts     BIGINT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_uq ON projects (slug);
CREATE INDEX IF NOT EXISTS projects_activity_idx ON projects (latest_promise_ts DESC);

CREATE TABLE IF NOT EXISTS indexer_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`,
  },
];