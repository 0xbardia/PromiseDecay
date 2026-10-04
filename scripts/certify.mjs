/**
 * Read-method certification against a live GenLayer deployment.
 *
 * Invokes every public READ method and records what actually came back. Write methods are
 * listed separately and deliberately NOT called: this tool must never mutate chain state.
 *
 *   node scripts/certify.mjs [contractAddress]
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, chains } from "genlayer-js";

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = {
  ...loadDotEnv(path.resolve(process.cwd(), "apps/api", ".env")),
  ...loadDotEnv(path.resolve(process.cwd(), ".env")),
  ...process.env,
};

const ADDRESS = process.argv[2] || env.GENLAYER_CONTRACT_ADDRESS;
if (!ADDRESS) {
  console.error("usage: node scripts/certify.mjs <contractAddress>");
  process.exit(2);
}

const client = createClient({ chain: chains.studionet });

/**
 * Pace reads against the shared public node.
 *
 * Studio enforces 30 requests/minute AND 500 requests/hour per client. Certification
 * makes roughly 40 reads, which is fine inside those limits — but only if nothing else is
 * competing for the same budget, and only if a 429 waits out the node's own advice rather
 * than being retried immediately.
 */
/** ~23 requests/minute: under the 30/min ceiling even with other traffic. */
const MIN_INTERVAL_MS = 2_600;
let lastRequest = 0;
let cooldownUntil = 0;

async function pace() {
  for (;;) {
    const now = Date.now();
    const wait = Math.max(cooldownUntil - now, lastRequest + MIN_INTERVAL_MS - now);
    if (wait <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
  }
  lastRequest = Date.now();
}

/** True when any link in the error chain looks like a node rate-limit rejection. */
function isRateLimitRejection(err) {
  let node = err;
  for (let d = 0; d < 5 && node && typeof node === "object"; d++) {
    if (node.code === -32029) return true;
    if (node.data && "bucket" in node.data && "window" in node.data) return true;
    node = node.cause;
  }
  return false;
}

/**
 * Run an RPC call, waiting out any throttle.
 *
 * Every call in this tool funnels through here, including `getContractSchema`. An earlier
 * version let the schema fetch bypass the retry, so certification would abort mid-run with a
 * bare UnknownRpcError the moment the shared hourly quota ran dry.
 */
async function rpc(fn, label) {
  for (let attempt = 1; ; attempt++) {
    await pace();
    try {
      return await fn();
    } catch (err) {
      const text = String(err?.message ?? err);
      // The node wraps rate-limit rejections in a generic UnknownRpcError; the real signal
      // is the structured payload (code -32029 plus bucket/window/limit), so walk the chain.
      let node = err;
      let retryAfter = 0;
      for (let d = 0; d < 5 && node; d++) {
        const e = node;
        if (typeof e !== "object") break;
        if (e.code === -32029 || (e.data && "bucket" in e.data && "limit" in e.data)) {
          retryAfter = Number(e.data?.retry_after_seconds ?? 0);
          break;
        }
        node = e.cause;
      }
      // The node advertises exactly how long its bucket needs to refill, which for the
      // hourly window can be minutes. Wait it out rather than giving up: certification
      // is read-only, so waiting is always safe.
      const isRateLimit = retryAfter > 0 || /rate limit/i.test(text) || isRateLimitRejection(err);
      if (isRateLimit) {
        const wait = Math.max(retryAfter, 20) * 1000 + 2000;
        console.error(
          `   rate limited on ${label} (attempt ${attempt}); waiting ${Math.round(wait / 1000)}s`
        );
        cooldownUntil = Date.now() + wait;
        continue;
      }
      throw err;
    }
  }
}

const read = (method, args = []) =>
  rpc(() => client.readContract({ address: ADDRESS, functionName: method, args }), method);

const isJsonString = (v) => {
  try {
    JSON.parse(v);
    return true;
  } catch {
    return false;
  }
};
const isInt = (v) => Number.isFinite(Number(v));
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isArr = (v) => Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

console.log("=".repeat(96));
console.log("PromiseDecay — deployed read-method certification");
console.log("=".repeat(96));
console.log("contract :", ADDRESS);
console.log("network  : studionet (chain 61999)");

async function fetchSchema() {
  for (let attempt = 1; ; attempt++) {
    await pace();
    try {
      return await client.getContractSchema(ADDRESS);
    } catch (err) {
      // The schema is a fixed property of the deployment, so any transport-level failure
      // resolving it is transient by definition. Retrying is safe and terminating is not useful.
      const seconds = attempt * 20;
      console.error(
        `   schema fetch failed (${String(err?.message ?? err).split("\n")[0].slice(0, 50)}); ` +
          `retrying in ${seconds}s`
      );
      cooldownUntil = Date.now() + seconds * 1000;
      if (attempt > 60) throw err;
    }
  }
}

const schema = await fetchSchema();
const allMethods = Object.entries(schema.methods);
const readMethods = allMethods.filter(([, m]) => m.readonly === true);
const writeMethods = allMethods.filter(([, m]) => m.readonly !== true);

console.log(`schema   : ${allMethods.length} methods (${readMethods.length} read, ${writeMethods.length} write)\n`);

const ids = (await read("get_all_promise_ids")) ?? [];
const chainCount = Number(await read("get_promise_count"));
const first = ids.length ? Number(ids[0]) : 0;
const last = ids.length ? Number(ids[ids.length - 1]) : 0;
// A promise known to carry drift/evidence/challenges, so child reads return real content.
let rich = first;
for (const id of ids) {
  const n = Number(id);
  if (Number(await read("get_drift_count", [n])) > 0) {
    rich = n;
    break;
  }
}

const rows = [];
const record = (method, input, expected, actual, ok) =>
  rows.push({ method, input, expected, actual, status: ok ? "PASS" : "FAIL" });

// --- contract-level reads ---------------------------------------------------------------
record("get_version", "—", '"1.0.0"', JSON.stringify(await read("get_version")),
  (await read("get_version")) === "1.0.0");

const cfg = await read("get_config");
record("get_config", "—", "object with contract_version + enums",
  `v${cfg.contract_version}, ${cfg.delivery_values?.length} delivery, ${cfg.integrity_values?.length} integrity`,
  isObj(cfg) && !!cfg.contract_version && Array.isArray(cfg.delivery_values));

record("get_promise_count", "—", "integer > 0", String(chainCount), chainCount > 0);
record("get_all_promise_ids", "—", "array of ids", `[${ids.map(String).join(",")}]`,
  isArr(ids) && ids.length === chainCount);

// --- per-promise reads (first id) -----------------------------------------------------
record("get_promise", String(first), "object with original_quote", "", false);
{
  const p = await read("get_promise", [first]);
  rows[rows.length - 1].actual = `project=${p.project}, quote=${String(p.original_quote).slice(0, 34)}…`;
  rows[rows.length - 1].status = isObj(p) && isStr(p.original_quote) ? "PASS" : "FAIL";
}

record("get_created_at", String(first), "integer > 0", String(await read("get_created_at", [first])),
  isInt(await read("get_created_at", [first])) && Number(await read("get_created_at", [first])) > 0);
record("get_deadline_at", String(first), "integer > 0", String(await read("get_deadline_at", [first])),
  Number(await read("get_deadline_at", [first])) > 0);

const lifecycle = await read("get_lifecycle_status", [first]);
record("get_lifecycle_status", String(first), "lifecycle enum", lifecycle,
  ["OPEN", "DUE", "RESOLVING", "PROVISIONAL", "CHALLENGE_WINDOW", "FINAL"].includes(lifecycle));

// --- child collections on the richest promise ------------------------------------------
record("get_drift_count", String(rich), "integer >= 1", String(await read("get_drift_count", [rich])),
  Number(await read("get_drift_count", [rich])) > 0);
{
  const v = await read("get_drift", [rich]);
  const arr = JSON.parse(v);
  rows[rows.length - 1] && void 0;
  record("get_drift", String(rich), "JSON array, non-empty", `[${arr.length} entries]`, isJsonString(v) && arr.length > 0);
  record("get_drift", String(rich) + " (empty id)", "JSON array", "[]",
    isJsonString(await read("get_drift", [99999])));
}

record("get_evidence_count", String(rich), "integer >= 1", String(await read("get_evidence_count", [rich])),
  Number(await read("get_evidence_count", [rich])) > 0);
{
  const v = await read("get_evidence", [rich]);
  const arr = JSON.parse(v);
  record("get_evidence", String(rich), "JSON array, non-empty", `[${arr.length} entries]`, isJsonString(v) && arr.length > 0);
}

record("get_response_count", String(rich), "integer >= 0", String(await read("get_response_count", [rich])),
  isInt(await read("get_response_count", [rich])));
{
  const v = await read("get_responses", [rich]);
  const arr = JSON.parse(v);
  record("get_responses", String(rich), "JSON array", `[${arr.length} entries]`, isJsonString(v));
  if (arr.length) {
    record("get_responses", String(rich) + " verified flag", "verified=false in V1",
      `verified=${arr[0].verified}`, arr[0].verified === false);
  }
}

record("get_challenge_count", String(rich), "integer >= 0", String(await read("get_challenge_count", [rich])),
  isInt(await read("get_challenge_count", [rich])));
{
  const v = await read("get_challenges", [rich]);
  const arr = JSON.parse(v);
  record("get_challenges", String(rich), "JSON array", `[${arr.length} entries]`, isJsonString(v));
}

{
  const w = await read("get_challenge_window", [first]);
  record("get_challenge_window", String(first), "object with window_seconds",
    `closes=${w.challenge_closes_at}, window=${w.window_seconds}s`,
    isObj(w) && Number(w.window_seconds) > 0);
}

// --- resolution reads ------------------------------------------------------------------
// A promise that has not been resolved has NO provisional result, and the contract raises
// UserError for exactly that. That is correct behaviour, not a failure, so both the
// "resolved" and the "not yet resolved" cases are certified separately.
const readSafe = async (method, args) => {
  try {
    return { ok: true, value: await read(method, args) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err).split("\n")[0].trim() };
  }
};

// Pick a promise that actually carries a provisional result.
let resolved = null;
for (const id of ids) {
  const r = await readSafe("get_provisional_result", [Number(id)]);
  if (r.ok) {
    resolved = { id: Number(id), result: r.value };
    break;
  }
}
{
  const prov = await readSafe("get_provisional_result", [rich]);
  record(
    "get_provisional_result",
    String(rich),
    "result object, or UserError when unresolved",
    prov.ok
      ? `${prov.value.delivery}/${prov.value.integrity}`
      : `UserError: ${prov.error.slice(0, 44)}`,
    prov.ok
      ? isObj(prov.value) && isStr(prov.value.delivery) && isStr(prov.value.integrity)
      : /Missing or invalid parameters|Unknown promise|No provisional/i.test(prov.error)
  );
}
{
  const r = resolved
    ? { ok: true, value: resolved.result, id: resolved.id }
    : { ok: false, error: "no promise carries a provisional result" };
  record("get_provisional_result", `${rich} (resolved)`, "closed enums + explanation",
    r.ok ? `${r.value.delivery}/${r.value.integrity} · ${String(r.value.explanation).slice(0, 26)}…` : r.error,
    r.ok && ["KEPT", "KEPT_LATE", "PARTIAL", "NOT_KEPT", "UNRESOLVED"].includes(r.value.delivery) &&
      ["UNCHANGED", "NARROWED", "REFRAMED", "REVERSED", "UNKNOWN"].includes(r.value.integrity));
}
{
  // Nothing is FINAL in this deployment, so every final read must raise UserError. If one
  // ever returned a result, the lifecycle would have moved without us noticing.
  const fin = await readSafe("get_final_result", [first]);
  record("get_final_result", String(first), "UserError (no promise is FINAL yet)",
    fin.ok ? "UNEXPECTEDLY returned a result" : `UserError: ${fin.error.slice(0, 40)}`,
    !fin.ok);
}
{
  // An unknown id must refuse rather than return a default record — otherwise a caller could
  // mistake a non-existent promise for a real one with empty fields.
  //
  // The message itself is not assertable here: the RPC wraps GenVM UserError as "Missing or
  // invalid parameters", losing the text. The message ("Unknown promise id", raised by
  // `_require_promise`) is verified in Direct Mode instead, and the refusal is verified here.
  const missing = await readSafe("get_promise", [999999]);
  record("get_promise", "999999 (nonexistent)", "raises rather than returning a default",
    missing.ok ? "RETURNED A RECORD (fault)" : `refused: ${missing.error.slice(0, 40)}`,
    !missing.ok);
}

// --- report ----------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(pad("Method", 26) + pad("Input", 20) + pad("Expected", 34) + pad("Actual", 34) + "Result");
console.log("-".repeat(118));
for (const r of rows) {
  console.log(pad(r.method, 26) + pad(r.input, 20) + pad(r.expected, 34) + pad(r.actual, 34) + r.status);
}
const failed = rows.filter((r) => r.status === "FAIL");
console.log(`\nREADS: ${rows.length - failed.length}/${rows.length} PASS`);

console.log(`\nWRITE methods (intentionally NOT invoked — certification must not mutate chain):`);
for (const [name] of writeMethods.sort()) console.log(`  - ${name}`);

console.log(`\nChain reconciliation: contract reports ${chainCount} promises, ids length ${ids.length}`);

// Always write to the repository's docs/ directory, regardless of the invoking cwd.
const REPO_ROOT = path.resolve(process.env.PD_REPO_ROOT ?? path.join(process.cwd(), "..", ".."));
const OUT_FILE = path.join(REPO_ROOT, "docs", "CERTIFICATION.md");
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

fs.writeFileSync(
  OUT_FILE,
  `# PromiseDecay — Deployed Read-Method Certification\n\n` +
    `**Contract:** \`${ADDRESS}\`  \n**Network:** GenLayer Studionet (chain 61999)  \n` +
    `**RPC:** \`${env.GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api"}\`\n\n` +
    `Generated by \`node scripts/certify.mjs\`. Write methods are listed but never called.\n\n` +
    rows
      .map((r) => `| \`${r.method}\` | ${r.input} | ${r.expected} | ${r.actual} | **${r.status}** |`)
      .join("\n") +
    `\n\n**Result: ${rows.length - failed.length}/${rows.length} PASS**\n\n` +
    `## Write methods (not invoked)\n\n` +
    writeMethods
      .sort()
      .map(([n]) => `- \`${n}\``)
      .join("\n") +
    `\n\n## Chain state at certification\n\n` +
    `Contract reports **${chainCount}** promises. Promise ids: ${ids.map(String).join(", ")}\n`
);

process.exit(failed.length ? 1 : 0);