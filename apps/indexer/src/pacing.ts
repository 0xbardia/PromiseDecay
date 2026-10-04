/**
 * Indexer pacing.
 *
 * The GenLayer Studio endpoint allows a bounded number of requests per day. How often the
 * indexer can safely sync is therefore not a taste decision — it is arithmetic over the request
 * budget and the cost of a pass — and the cost of a pass grows with the dataset.
 *
 * This lives apart from the worker so it can be tested directly. Getting it wrong is not a
 * crash: the indexer simply keeps requesting, and the endpoint starts refusing, which looks
 * like an outage somewhere else entirely.
 */

/** `get_all_promise_ids`, once per pass. */
export const READS_PER_PASS = 1;

/**
 * Per promise: the DNA, the lifecycle status, and seven child/result reads — evidence, drift,
 * responses, challenges, provisional result, final result, challenge window.
 *
 * Kept next to the reader's behaviour on purpose. If the reader starts making more calls, this
 * count is the thing that must be updated with it; a stale count quietly under-budgets.
 */
export const READS_PER_PROMISE = 9;

/** Chain reads one full pass costs. */
export function readsPerPass(promiseCount: number): number {
  return READS_PER_PASS + READS_PER_PROMISE * Math.max(promiseCount, 1);
}

/**
 * How long to wait between passes so a day's syncing stays inside the budget.
 *
 * @param promiseCount promises currently indexed
 * @param dailyBudget  requests this process may spend per day
 * @param minIntervalMs floor, because a pass takes minutes and cannot usefully repeat faster
 */
export function intervalFor(
  promiseCount: number,
  dailyBudget: number,
  minIntervalMs: number
): number {
  const perPass = readsPerPass(promiseCount);
  // At least one pass a day, whatever the budget says: a promise nobody ever re-reads is a
  // product that has stopped being a record of the chain.
  const passesPerDay = Math.max(1, Math.floor(dailyBudget / perPass));
  return Math.max(Math.floor(86_400_000 / passesPerDay), minIntervalMs);
}

/** Requests a day at this cadence, for logging and for asserting against the budget. */
export function dailySpend(
  promiseCount: number,
  dailyBudget: number,
  minIntervalMs: number
): number {
  const perPass = readsPerPass(promiseCount);
  const intervalMs = intervalFor(promiseCount, dailyBudget, minIntervalMs);
  return perPass * Math.floor(86_400_000 / intervalMs);
}