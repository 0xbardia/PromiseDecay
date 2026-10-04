/**
 * Indexer: a restart-safe, idempotent projection of on-chain state into PostgreSQL.
 *
 * Design rules that matter:
 *  - Idempotent. Re-running produces identical rows; the unique keys are (promise_id,
 *    ordinal) and (slug), so a repeat run upserts rather than duplicating.
 *  - Restart-safe. Progress is checkpointed in `indexer_state`, and a run always starts
 *    by reconciling the full promise list, so a crash mid-run self-heals.
 *  - Never decides anything. It only mirrors what the contract already decided.
 *  - Fault-tolerant. One bad promise is recorded as an error and the run continues; a
 *    transient RPC failure is retried with backoff rather than crashing the worker.
 */
import { eq, sql as dsql } from "drizzle-orm";
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
import { buildSearchText } from "../lib/http.js";
import {
  GenlayerReader,
  type ChallengeRaw,
  type DriftRaw,
  type EvidenceRaw,
  type PromiseDnaRaw,
  type ResponseRaw,
  type ResolutionRaw,
} from "../chain/reader.js";

export interface IndexerLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface SyncResult {
  promiseCount: number;
  indexed: number;
  failed: number;
  projects: number;
  durationMs: number;
}

const CHECKPOINT_KEY = "last_sync_at";

/**
 * Which contract this projection was built from.
 *
 * Recorded so a change of `GENLAYER_CONTRACT_ADDRESS` is noticed rather than silently
 * ignored. Without it the indexer only ever upserts, so pointing the deployment at a new
 * contract leaves the previous deployment's records visible in the product forever — the
 * site would show promises that do not exist on the chain it claims to be reading.
 */
const SOURCE_KEY = "source_contract";

/**
 * Replace a promise's child collections wholesale.
 *
 * The contract's child arrays are append-only, so a full replace is both correct and
 * simpler than diffing: ordinals are stable, and the unique (promise_id, ordinal) key
 * makes a repeated write idempotent.
 */
async function syncChildren(
  db: Database,
  promiseId: string,
  data: {
    evidence: EvidenceRaw[];
    drift: DriftRaw[];
    responses: ResponseRaw[];
    challenges: ChallengeRaw[];
  }
): Promise<void> {
  await db.delete(evidence).where(eq(evidence.promiseId, promiseId));
  await db.delete(drift).where(eq(drift.promiseId, promiseId));
  await db.delete(responses).where(eq(responses.promiseId, promiseId));
  await db.delete(challenges).where(eq(challenges.promiseId, promiseId));

  if (data.evidence.length) {
    await db
      .insert(evidence)
      .values(
        data.evidence.map((e, i) => ({
          promiseId,
          ordinal: i,
          submitter: e.submitter,
          sourceUrl: e.source_url,
          quote: e.quote,
          kind: e.kind,
          submittedTs: Number(e.submitted_ts),
        }))
      )
      .onConflictDoNothing();
  }

  if (data.drift.length) {
    await db
      .insert(drift)
      .values(
        data.drift.map((d, i) => ({
          promiseId,
          ordinal: i,
          submitter: d.submitter,
          statement: d.statement,
          sourceUrl: d.source_url,
          submittedTs: Number(d.submitted_ts),
          relationship: d.relationship,
        }))
      )
      .onConflictDoNothing();
  }

  if (data.responses.length) {
    await db
      .insert(responses)
      .values(
        data.responses.map((r, i) => ({
          promiseId,
          ordinal: i,
          submitter: r.submitter,
          statement: r.statement,
          sourceUrl: r.source_url,
          submittedTs: Number(r.submitted_ts),
          // Ownership is never claimed without verification.
          verified: false,
        }))
      )
      .onConflictDoNothing();
  }

  if (data.challenges.length) {
    await db
      .insert(challenges)
      .values(
        data.challenges.map((c, i) => ({
          promiseId,
          ordinal: i,
          challenger: c.challenger,
          reason: c.reason,
          evidenceUrl: c.evidence_url,
          submittedTs: Number(c.submitted_ts),
        }))
      )
      .onConflictDoNothing();
  }
}

async function indexOne(
  db: Database,
  reader: GenlayerReader,
  promiseId: string
): Promise<void> {
  const dna: PromiseDnaRaw = await reader.getPromise(promiseId);
  const lifecycle = await reader.getLifecycleStatus(promiseId);
  const [ev, dr, rs, ch, provisional, final, window] = await Promise.all([
    reader.getEvidence(promiseId),
    reader.getDrift(promiseId),
    reader.getResponses(promiseId),
    reader.getChallenges(promiseId),
    reader.getProvisionalResult(promiseId),
    reader.getFinalResult(promiseId),
    reader.getChallengeWindow(promiseId),
  ]);

  // A final result wins over a provisional one; FINAL is terminal and never regresses.
  const resolution: ResolutionRaw | null = final ?? provisional;
  const isFinal = final !== null;

  const projectSlug = slugifyProject(dna.project);
  const searchText = buildSearchText({
    project: dna.project,
    actor: dna.actor,
    originalQuote: dna.original_quote,
    action: dna.action,
    object: dna.object,
    scope: dna.scope,
  });

  const values = {
    promiseId,
    project: dna.project,
    projectSlug,
    actor: dna.actor,
    originalQuote: dna.original_quote,
    action: dna.action,
    object: dna.object,
    scope: dna.scope,
    deadlineTs: Number(dna.deadline_ts),
    conditions: dna.conditions,
    sourceUrl: dna.source_url,
    creator: dna.creator,
    createdTs: Number(dna.created_ts),
    contractVersion: dna.contract_version,
    lifecycle,
    delivery: resolution?.delivery ?? null,
    integrity: resolution?.integrity ?? null,
    deadlineMet: resolution?.deadline_met ?? null,
    materialScopeChange: resolution?.material_scope_change ?? null,
    explanation: resolution?.explanation ?? null,
    decidedTs: resolution ? Number(resolution.decided_ts) : null,
    isFinal,
    challengeCount: ch.length,
    evidenceCount: ev.length,
    driftCount: dr.length,
    responseCount: rs.length,
    challengeClosesAt: Number(window.challenge_closes_at) || null,
    search: searchText,
    indexedAt: new Date(),
  };

  await db
    .insert(promises)
    .values(values)
    .onConflictDoUpdate({ target: promises.promiseId, set: values });

  await syncChildren(db, promiseId, { evidence: ev, drift: dr, responses: rs, challenges: ch });
}

/** Recompute project aggregates from the promises table. */
async function rebuildProjects(db: Database): Promise<number> {
  await db.execute(dsql`
    INSERT INTO projects (
      slug, name, actor, promise_count, final_count, resolved_count, open_count,
      earliest_deadline_ts, latest_deadline_ts, latest_promise_ts, updated_at
    )
    SELECT
      project_slug,
      MIN(project),
      MIN(actor),
      COUNT(*),
      COUNT(*) FILTER (WHERE is_final),
      COUNT(*) FILTER (WHERE delivery IS NOT NULL),
      COUNT(*) FILTER (WHERE lifecycle = 'OPEN'),
      MIN(deadline_ts),
      MAX(deadline_ts),
      MAX(created_ts),
      NOW()
    FROM promises
    GROUP BY project_slug
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      actor = EXCLUDED.actor,
      promise_count = EXCLUDED.promise_count,
      final_count = EXCLUDED.final_count,
      resolved_count = EXCLUDED.resolved_count,
      open_count = EXCLUDED.open_count,
      earliest_deadline_ts = EXCLUDED.earliest_deadline_ts,
      latest_deadline_ts = EXCLUDED.latest_deadline_ts,
      latest_promise_ts = EXCLUDED.latest_promise_ts,
      updated_at = NOW()
  `);
  const rows = await db.select({ n: dsql<number>`COUNT(*)` }).from(projects);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Make the projection describe exactly one contract.
 *
 * If the recorded source differs from the configured address, every projected row belongs to a
 * contract this process no longer reads, so it is discarded and the pass rebuilds from
 * scratch. This is a derived cache — throwing it away is always safe, and keeping it would be
 * actively wrong.
 */
async function alignProjectionToContract(
  db: Database,
  contract: string,
  logger: IndexerLogger
): Promise<void> {
  const rows = await db
    .select({ value: indexerState.value })
    .from(indexerState)
    .where(eq(indexerState.key, SOURCE_KEY))
    .limit(1);

  const recorded = rows[0]?.value ?? null;
  if (recorded === contract) return;

  if (recorded !== null) {
    logger.warn({ from: recorded, to: contract }, "contract changed; rebuilding projection");
  }

  // Child rows cascade from promises.
  await db.delete(promises);
  await db.delete(projects);

  await db
    .insert(indexerState)
    .values({ key: SOURCE_KEY, value: contract })
    .onConflictDoUpdate({ target: indexerState.key, set: { value: contract } });
}

/**
 * Drop promises the chain no longer reports.
 *
 * The contract is append-only, so this should normally remove nothing. It exists because a
 * projection that can only grow is not a projection: a wrong address, a reset localnet, or a
 * reorg would leave records the product attributes to a contract that does not contain them.
 */
async function pruneVanished(
  db: Database,
  ids: Array<string | number>,
  logger: IndexerLogger
): Promise<number> {
  const onChain = ids.map((id) => String(id));
  const rows = await db.select({ id: promises.promiseId }).from(promises);
  const stale = rows.map((r) => r.id).filter((id) => !onChain.includes(id));
  if (stale.length === 0) return 0;

  for (const id of stale) {
    await db.delete(promises).where(eq(promises.promiseId, id));
  }
  return stale.length;
}

/**
 * One full synchronization pass.
 *
 * Always reconciles the entire promise list: it is the only way a restart is guaranteed
 * to self-heal, and the list is small enough that a full pass is cheap.
 */
export async function syncOnce(
  db: Database,
  reader: GenlayerReader,
  logger: IndexerLogger
): Promise<SyncResult> {
  const started = Date.now();
  const contract = reader.contractAddress.toLowerCase();

  await alignProjectionToContract(db, contract, logger);

  const ids = await reader.getAllPromiseIds();

  let indexed = 0;
  let failed = 0;

  for (const id of ids) {
    try {
      await indexOne(db, reader, id);
      indexed += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { promiseId: id, err: (err as Error).message },
        "failed to index promise; continuing"
      );
    }
  }

  const removed = await pruneVanished(db, ids, logger);
  if (removed > 0) logger.warn({ removed }, "pruned records no longer present on chain");

  const projectCount = await rebuildProjects(db);

  // Checkpoint the pass so an operator can see how fresh the projection is.
  const stamp = new Date().toISOString();
  await db
    .insert(indexerState)
    .values({ key: CHECKPOINT_KEY, value: stamp })
    .onConflictDoUpdate({ target: indexerState.key, set: { value: stamp } });

  const result: SyncResult = {
    promiseCount: ids.length,
    indexed,
    failed,
    projects: projectCount,
    durationMs: Date.now() - started,
  };
  logger.info({ ...result }, "sync complete");
  return result;
}
