/**
 * Production live proof, driven through the PUBLIC app with a key-backed injected wallet.
 *
 * What is real here:
 *   - the page is the deployed public site, in headless Chromium
 *   - every lifecycle write is initiated by clicking the app's own buttons
 *   - the injected provider forwards `eth_signTransaction` to a Node-side signer that signs with
 *     a real key (the key never enters the page) and the app's own SDK path broadcasts it
 *   - confirmation is read from Studionet, and contract state is read back independently
 *
 * What is NOT done through the UI: seeding the fixture (create_promise, add_evidence, add_drift)
 * is signed with the same wallet through the SDK, because the lifecycle writes are what this
 * certifies.
 *
 *   node apps/web/scripts/live-certify-ui.mjs <contractAddress> <outJson> [baseUrl]
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fixture, writePages, assertPagesServed, fetchLog, summarizeFetches, sdk, loadAccount, rpc, sleep, jsonSafe, iso } from "./live-fixture.mjs";

const [address, outFile, baseArg] = process.argv.slice(2);
if (!address || !outFile) throw new Error("usage: live-certify-ui.mjs <contractAddress> <outJson> [baseUrl]");
const BASE = baseArg ?? "https://promisedecay.bydx.fun";

const c = sdk(address);
const cfg = await c.read("get_config");
if (Number(cfg.challenge_window_seconds) !== 604800) throw new Error("this is not the 7-day production-window contract");

const report = { address, version: await c.read("get_version"), windowSeconds: 604800, base: BASE, steps: [], browser: { console: [], pageErrors: [], failedRequests: [], rpcErrors: [], rpcCalls: {} } };
const log = (...a) => console.log(...a);

// --- configuration agreement -----------------------------------------------------------------
const apiCfg = await (await fetch(`${BASE}/api/v1/config`)).json();
report.apiContract = apiCfg.contractAddress;
if (apiCfg.contractAddress.toLowerCase() !== address.toLowerCase()) throw new Error(`API serves ${apiCfg.contractAddress}, expected ${address}`);

// --- fixture ---------------------------------------------------------------------------------
const runId = `p${Date.now().toString(36)}`;
const nowTs = Math.floor(Date.now() / 1000);
const deadlineTs = nowTs + 420;
const fx = fixture(runId, nowTs, deadlineTs);
writePages(fx, new URL("../dist", import.meta.url).pathname);
await assertPagesServed(fx);
report.runId = runId;
report.deadlineTs = deadlineTs;
log(`fixture ${runId} served from ${fx.base}`);

async function snap(pid) {
  // Only read results the lifecycle says can exist: a read of a missing result is a failed
  // gen_call, and the Studio request budget is shared and capped.
  const lifecycle = await c.read("get_lifecycle_status", [pid]);
  const win = await c.read("get_challenge_window", [pid]);
  const challengeCount = Number(await c.read("get_challenge_count", [pid]));
  const evidenceCount = Number(await c.read("get_evidence_count", [pid]));
  const hasProvisional = !["OPEN", "DUE"].includes(lifecycle) && !(lifecycle === "RESOLVING" && challengeCount === 0);
  const brief = (r) => (r && typeof r === "object" ? { delivery: r.delivery, integrity: r.integrity, deadline_met: r.deadline_met, material_scope_change: r.material_scope_change, explanation: r.explanation, decided_ts: String(r.decided_ts) } : null);
  const provisional = hasProvisional ? brief(await c.read("get_provisional_result", [pid])) : null;
  const final = lifecycle === "FINAL" ? brief(await c.read("get_final_result", [pid])) : null;
  return { lifecycle, closesAt: Number(win.challenge_closes_at) || null, challengeCount, evidenceCount, provisional, final };
}

async function seed(method, pid, args) {
  const { hash, status } = await c.write(method, method, args);
  log(`  seed ${method}: ${status} ${hash}`);
  if (status !== "FINALIZED") throw new Error(`${method} ended ${status}`);
  report.steps.push({ phase: "seed", method, hash, status });
}

const idsBefore = (await c.read("get_all_promise_ids")).map(Number);
await seed("create_promise", null, fx.promise);
const ids = (await c.read("get_all_promise_ids")).map(Number);
const pid = BigInt(ids.filter((i) => !idsBefore.includes(i)).pop());
report.promiseId = String(pid);
log(`production fixture promise id ${pid}`);
for (const [u, q, k] of fx.evidence) await seed("add_evidence", pid, [pid, u, q, k]);
for (const [s, u] of fx.drift) await seed("add_drift", pid, [pid, s, u]);
report.driftRelations = JSON.parse(await c.read("get_drift", [pid])).map((d) => ({ page: d.source_url.split("/").pop(), relationship: d.relationship }));
log("drift relations", jsonSafe(report.driftRelations));

// One indexer pass so the public API/UI can show the new record, then back to rest.
function indexerPass() {
  const logFile = "/root/.pm2/logs/promisedecay-indexer-out.log";
  const mark = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  execFileSync("/root/.nvm/versions/node/v20.20.2/bin/pm2", ["restart", "promisedecay-indexer", "--update-env"], { stdio: "ignore", env: { ...process.env, ...envFromDotenv() } });
  return (async () => {
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const tail = fs.readFileSync(logFile, "utf8").slice(mark);
      if (/"msg":"sync complete"/.test(tail)) return tail.split("\n").filter((l) => l.includes("sync complete")).pop();
    }
    throw new Error("indexer pass did not complete");
  })();
}
function envFromDotenv() {
  const out = {};
  for (const raw of fs.readFileSync("/root/PromiseDecay/.env", "utf8").split("\n")) {
    const l = raw.trim();
    if (!l || l.startsWith("#") || !l.includes("=")) continue;
    out[l.slice(0, l.indexOf("="))] = l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "");
  }
  return out;
}
const stopIndexer = () => execFileSync("/root/.nvm/versions/node/v20.20.2/bin/pm2", ["stop", "promisedecay-indexer"], { stdio: "ignore" });

log("indexer:", (await indexerPass()).slice(0, 200));
stopIndexer();
const listed = await (await fetch(`${BASE}/api/v1/promises?limit=10`)).json();
if (!listed.items.some((i) => i.promiseId === String(pid))) throw new Error("promise is not visible in the public API after the indexer pass");

// --- browser with a key-backed wallet ---------------------------------------------------------------
const { privateKey } = loadAccount();
const signer = privateKeyToAccount(privateKey);
const signed = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.exposeFunction("__pdSign", async (tx) => {
  const big = (h) => (h === undefined || h === null ? undefined : BigInt(h));
  const raw = await signer.signTransaction({
    chainId: Number(big(tx.chainId)),
    to: tx.to,
    data: tx.data,
    value: big(tx.value) ?? 0n,
    gas: big(tx.gas),
    gasPrice: big(tx.gasPrice) ?? 0n,
    nonce: Number(big(tx.nonce)),
  });
  const evmHash = keccak256(raw);
  signed.push({ evmHash, to: tx.to, nonce: Number(big(tx.nonce)), at: Date.now() });
  return raw;
});
await context.addInitScript(({ addr }) => {
  const calls = [];
  window.__pdWalletCalls = calls;
  window.ethereum = {
    isKeyBackedTestWallet: true,
    selectedAddress: addr,
    chainId: "0xf22f",
    on() {}, removeListener() {},
    async request({ method, params }) {
      calls.push(method);
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts": return [addr];
        case "eth_chainId": return "0xf22f";
        case "net_version": return "61999";
        case "wallet_switchEthereumChain": return null;
        case "eth_signTransaction": return await window.__pdSign(params[0]);
        default: { const e = new Error(`unsupported wallet method ${method}`); e.code = 4200; throw e; }
      }
    },
  };
}, { addr: signer.address });

const page = await context.newPage();
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) report.browser.console.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
page.on("pageerror", (e) => report.browser.pageErrors.push(String(e).slice(0, 300)));
page.on("requestfailed", (r) => report.browser.failedRequests.push(`${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
page.on("response", async (res) => {
  if (!res.url().startsWith("https://studio.genlayer.com/api")) return;
  try {
    const reqBody = JSON.parse(res.request().postData() ?? "{}");
    const body = await res.json();
    const m = reqBody.method ?? "?";
    report.browser.rpcCalls[m] = (report.browser.rpcCalls[m] ?? 0) + 1;
    if (body.error) report.browser.rpcErrors.push(`${m}: ${String(body.error.message).slice(0, 160)}`);
  } catch { /* non-JSON */ }
});

const txBox = () => page.locator('[data-testid="tx-status"]').last();

/** Click the app's own submit button, wait for the panel to confirm, return the shown hash. */
async function appWrite(label, submitLocator) {
  const before = await snap(pid);
  const t0 = Date.now();
  const signedBefore = signed.length;
  await submitLocator.click();
  await page.waitForSelector('[data-testid="tx-status"]', { timeout: 60_000 });
  // Confirmed chip means the panel itself reached FINALIZED, not a local assumption.
  await txBox().locator("text=Confirmed").waitFor({ timeout: 12 * 60_000 });
  const t1 = Date.now();
  const hash = (await txBox().locator("a.pd-tx__hash").first().innerText()).replace(/\s*↗\s*$/, "").trim();
  const status = await rpc("gen_getTransactionStatus", [hash]);
  const after = await snap(pid);
  const rec = { phase: "ui", method: label, promiseId: String(pid), hash, status, evmTxs: signed.slice(signedBefore), before, after, t0, t1 };
  report.steps.push(rec);
  log(`  ${label}: ${status} ${hash}\n    before ${jsonSafe(before)}\n    after  ${jsonSafe(after)}`);
  return rec;
}

const connect = async () => {
  const btn = page.getByRole("button", { name: "Connect wallet" }).first();
  await btn.waitFor({ timeout: 30_000 });
  await btn.click();
  await page.locator("text=/Connected as 0x/").first().waitFor({ timeout: 15_000 });
};

// Wait for the deadline to pass on chain time.
const wait = deadlineTs + 20 - Math.floor(Date.now() / 1000);
if (wait > 0) { log(`waiting ${wait}s for the deadline`); await sleep(wait * 1000); }

// 1. request_resolution ------------------------------------------------------------------------
await page.goto(`${BASE}/promises/${pid}`, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="detail-project"]', { timeout: 60_000 });
await connect();
const requestCta = page.getByRole("button", { name: "Request a GenLayer resolution" });
await requestCta.waitFor({ timeout: 30_000 });
const rr = await appWrite("request_resolution", requestCta);
await page.waitForSelector('[data-testid="verdict-delivery"]', { timeout: 60_000 });
rr.ui = { delivery: await page.locator('[data-testid="verdict-delivery"]').innerText(), integrity: await page.locator('[data-testid="verdict-integrity"]').innerText() };
await page.screenshot({ path: outFile.replace(/\.json$/, "-1-provisional.png"), fullPage: false });
if (rr.after.lifecycle !== "CHALLENGE_WINDOW" || !rr.after.provisional) throw new Error("request_resolution did not produce a provisional result");
if (rr.ui.delivery.trim() !== rr.after.provisional.delivery) throw new Error(`UI shows ${rr.ui.delivery}, chain has ${rr.after.provisional.delivery}`);

// 2. challenge ---------------------------------------------------------------------------------
await page.locator('[data-testid="challenge-cta"]').click();
await page.waitForSelector('[data-testid="field-reason"]', { timeout: 30_000 });
await page.locator('[data-testid="action-connect"]').click();
await page.locator("text=/Connected as 0x/").first().waitFor({ timeout: 15_000 });
await page.locator('[data-testid="field-reason"]').fill(fx.challenge[0]);
await page.locator('[data-testid="field-sourceUrl"]').fill(fx.challenge[1]);
const challengeBtn = page.locator('[data-testid="tx-submit"]').first();
await page.waitForFunction(() => { const b = document.querySelector('[data-testid="tx-submit"]'); return b && !b.disabled; }, null, { timeout: 60_000 });
const ch = await appWrite("challenge", challengeBtn);
if (ch.after.lifecycle !== "RESOLVING" || ch.after.challengeCount !== 1) throw new Error("challenge was not stored on chain");

// 3. re_evaluate -------------------------------------------------------------------------------
const reBtn = page.getByRole("button", { name: "Run fresh GenLayer evaluation" });
await reBtn.waitFor({ timeout: 60_000 });
const re = await appWrite("re_evaluate", page.locator('[data-testid="tx-submit"]').last());
await page.waitForSelector('[data-testid="fresh-verdict"]', { timeout: 60_000 });
re.ui = { fresh: (await page.locator('[data-testid="fresh-verdict"]').innerText()).replace(/\s+/g, " ") };
await page.screenshot({ path: outFile.replace(/\.json$/, "-2-fresh-verdict.png"), fullPage: false });
if (re.after.lifecycle !== "CHALLENGE_WINDOW") throw new Error("re_evaluate did not return to the challenge window");

// 4. fetch evidence + indexer pass + hard refresh ---------------------------------------------------
const rows = fetchLog(runId, rr.t0 - 60_000);
report.fetches = {
  request_resolution: summarizeFetches(rows, rr.t0, rr.t1 + 30_000),
  re_evaluate: summarizeFetches(rows, re.t0, re.t1 + 30_000),
  expected: fx.expected,
};
report.fetchRows = rows;

log("indexer:", (await indexerPass()).slice(0, 200));
stopIndexer();
await page.goto(`${BASE}/promises/${pid}`, { waitUntil: "networkidle" });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="verdict-delivery"]', { timeout: 60_000 });
const finalChain = await snap(pid);
report.refresh = {
  uiDelivery: (await page.locator('[data-testid="verdict-delivery"]').innerText()).trim(),
  uiIntegrity: (await page.locator('[data-testid="verdict-integrity"]').innerText()).trim(),
  chain: finalChain.provisional,
  chainLifecycle: finalChain.lifecycle,
};
await page.screenshot({ path: outFile.replace(/\.json$/, "-3-after-refresh.png"), fullPage: false });
report.walletMethodsUsed = [...new Set(await page.evaluate(() => window.__pdWalletCalls))];
report.signedEvmTxs = signed;
await browser.close();

fs.writeFileSync(outFile, JSON.stringify(report, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2));
log("fetches", jsonSafe(report.fetches));
log("refresh", jsonSafe(report.refresh));
log("browser", jsonSafe({ console: report.browser.console, pageErrors: report.browser.pageErrors, failedRequests: report.browser.failedRequests, rpcErrors: report.browser.rpcErrors, rpcCalls: report.browser.rpcCalls }));
log(`wrote ${outFile}`);
