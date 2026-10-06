/**
 * Full lifecycle against a deployed contract through real signed Studionet transactions:
 *
 *   create → evidence ×4 → drift ×3 → request_resolution → challenge → re_evaluate
 *          → (challenge window expires) → finalize
 *
 * Intended for the TEST-ONLY short-window fixture contract. Refuses to run against a contract
 * whose window is not short, so it can never sit waiting on (or be mistaken for) production.
 *
 *   node apps/web/scripts/live-certify-sdk.mjs <contractAddress> <outJson>
 */
import fs from "node:fs";
import { PUBLIC_ORIGIN, fixture, writePages, assertPagesServed, fetchLog, summarizeFetches, sdk, sleep, jsonSafe, iso } from "./live-fixture.mjs";

const [address, outFile] = process.argv.slice(2);
if (!address || !outFile) throw new Error("usage: live-certify-sdk.mjs <contractAddress> <outJson>");

const c = sdk(address);
const cfg = await c.read("get_config");
const windowSeconds = Number(cfg.challenge_window_seconds);
if (windowSeconds > 3600) throw new Error(`refusing to run: window is ${windowSeconds}s, not a test-only short window`);
console.log(`contract ${address} version ${await c.read("get_version")} window ${windowSeconds}s signer ${c.address}`);

const runId = `t${Date.now().toString(36)}`;
const nowTs = Math.floor(Date.now() / 1000);
const deadlineTs = nowTs + 420;
const fx = fixture(runId, nowTs, deadlineTs);
writePages(fx, new URL("../dist", import.meta.url).pathname);
await assertPagesServed(fx);
console.log(`fixture ${runId}: pages served from ${fx.base}`);

const report = { address, version: await c.read("get_version"), windowSeconds, runId, deadlineTs, steps: [] };

async function snap(pid) {
  const lifecycle = await c.read("get_lifecycle_status", [pid]);
  const win = await c.read("get_challenge_window", [pid]);
  const challenges = JSON.parse(await c.read("get_challenges", [pid]));
  const evidence = JSON.parse(await c.read("get_evidence", [pid]));
  let provisional = null;
  let final = null;
  try { provisional = await c.read("get_provisional_result", [pid]); } catch { /* none yet */ }
  try { final = await c.read("get_final_result", [pid]); } catch { /* none yet */ }
  const brief = (r) => (r && typeof r === "object" ? { delivery: r.delivery, integrity: r.integrity, deadline_met: r.deadline_met, material_scope_change: r.material_scope_change, explanation: r.explanation, decided_ts: String(r.decided_ts) } : null);
  return { lifecycle, closesAt: Number(win.challenge_closes_at) || null, challengeCount: challenges.length, evidenceCount: evidence.length, provisional: brief(provisional), final: brief(final) };
}

async function step(method, pid, args, extra = {}) {
  const before = pid ? await snap(pid) : null;
  const t0 = Date.now();
  const { hash, status } = await c.write(method, method, args);
  const t1 = Date.now();
  const after = pid ? await snap(pid) : null;
  const rec = { method, promiseId: pid ? String(pid) : null, hash, status, before, after, t0, t1, ...extra };
  report.steps.push(rec);
  console.log(`  ${method}: ${status} ${hash}\n    before ${jsonSafe(before)}\n    after  ${jsonSafe(after)}`);
  if (status !== "FINALIZED") throw new Error(`${method} ended ${status}`);
  return rec;
}

// --- create + seed ------------------------------------------------------------------------
const idsBefore = (await c.read("get_all_promise_ids")).map(Number);
await step("create_promise", null, fx.promise);
const ids = (await c.read("get_all_promise_ids")).map(Number);
const pid = BigInt(ids.filter((i) => !idsBefore.includes(i)).pop());
report.promiseId = String(pid);
console.log(`promise id ${pid}`);
for (const [u, q, k] of fx.evidence) await step("add_evidence", pid, [pid, u, q, k]);
for (const [s, u] of fx.drift) await step("add_drift", pid, [pid, s, u]);
// Drift classification recorded by the deployed contract.
report.driftRelations = JSON.parse(await c.read("get_drift", [pid])).map((d) => ({ url: d.source_url.split("/").pop(), relationship: d.relationship }));
console.log("drift relations", jsonSafe(report.driftRelations));

// --- request_resolution ------------------------------------------------------------------
const wait = deadlineTs + 15 - Math.floor(Date.now() / 1000);
if (wait > 0) { console.log(`waiting ${wait}s for the deadline to pass`); await sleep(wait * 1000); }
const rr = await step("request_resolution", pid, [pid]);
if (rr.after.lifecycle !== "CHALLENGE_WINDOW" || !rr.after.provisional) throw new Error("request_resolution did not produce a provisional result");

// --- challenge ---------------------------------------------------------------------------
const ch = await step("challenge", pid, [pid, ...fx.challenge]);
if (ch.after.lifecycle !== "RESOLVING" || ch.after.challengeCount !== 1) throw new Error("challenge was not stored");

// --- re_evaluate -------------------------------------------------------------------------
const re = await step("re_evaluate", pid, [pid]);
if (re.after.lifecycle !== "CHALLENGE_WINDOW") throw new Error("re_evaluate did not return the promise to the challenge window");

// --- window expiry + finalize --------------------------------------------------------------
const closes = re.after.closesAt;
const w2 = closes + 20 - Math.floor(Date.now() / 1000);
console.log(`challenge window closes ${iso(closes)}; waiting ${Math.max(w2, 0)}s`);
if (w2 > 0) await sleep(w2 * 1000);
const fin = await step("finalize", pid, [pid]);
if (fin.after.lifecycle !== "FINAL" || !fin.after.final) throw new Error("finalize did not persist FINAL");

// --- fetch evidence ------------------------------------------------------------------------
const rows = fetchLog(runId, rr.t0 - 60_000);
report.fetches = {
  request_resolution: summarizeFetches(rows, rr.t0, rr.t1 + 30_000),
  re_evaluate: summarizeFetches(rows, re.t0, re.t1 + 30_000),
  expected: fx.expected,
};
report.fetchRows = rows;
fs.writeFileSync(outFile, JSON.stringify(report, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));
console.log("fetches", jsonSafe(report.fetches));
console.log(`wrote ${outFile}`);
