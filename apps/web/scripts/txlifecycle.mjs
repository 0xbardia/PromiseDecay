/**
 * Transaction lifecycle, driven through the UI.
 *
 * The app's write path is: idle → awaiting-wallet → submitted → consensus → accepted → final,
 * or failed. This drives a real write with an injected provider that returns a real-shaped hash
 * and then serves a scripted chain response, so every stage transition is exercised as the user
 * experiences it rather than assumed from the source.
 */
import { chromium } from "@playwright/test";
import { keccak256, toHex } from "viem";
import { chains } from "genlayer-js";
import { MOCK_WALLET } from "../tests/e2e/mock-wallet.mjs";

const BASE = process.argv[2] ?? "https://promisedecay.bydx.fun";
const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const pid = await (await fetch(`${BASE}/api/v1/promises?limit=1`)).json()
  .then((d) => d.items?.[0]?.promiseId);
if (!pid) throw new Error("no live promise to act on");

const HASH = "0x9f2c41b7e5d3a086c4f17b2e9d5a3c8b1e6f4d7a2c9b3e5f1d8c6a4b2e0f9d7c";

// GenLayer returns a tx id, not an EVM hash: after broadcasting, the SDK reads the
// `NewTransaction` event out of the receipt logs and hands back its `txId`, which is bytes32.
// A receipt with empty logs therefore makes writeContract throw "Transaction not processed by
// consensus" — correct SDK behaviour, and the reason the stage machine stalled in an earlier
// run of this harness.
//
// All three event inputs are indexed, so the values live in topics and `data` is empty.
const TX_ID =
  "0x7d1f4c9a2b6e83051d4fa7c395e0b8d2461ace9f0b75c31e8a4d67029fb5e1c83";
const NEW_TX_SIG = keccak256(toHex("NewTransaction(bytes32,address,address)"));
const pad = (a) => `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
const NEW_TX_TOPICS = [
  NEW_TX_SIG,
  TX_ID,
  pad("0x6B340D9C6230b31652aAbDC08acDAd763635A82b"),
  pad("0x1111111111111111111111111111111111111111"),
];
const NEW_TX_LOG = {
  address: chains.studionet.consensusMainContract.address,
  topics: NEW_TX_TOPICS,
  data: "0x",
  blockNumber: "0x1",
  blockHash: "0x" + "ab".repeat(32),
  transactionHash: HASH,
  transactionIndex: "0x0",
  logIndex: "0x0",
  removed: false,
};

/**
 * Serve a scripted sequence of chain states to the app's status poller.
 *
 * `eth_sendRawTransaction` is intercepted too. The signing and broadcast path is verified
 * separately and directly — the wallet receives a complete transaction and the SDK sends it —
 * but a mock cannot produce a valid signature, so the node would reject the bytes. Stubbing
 * here is what lets the UI's stage machine be driven end to end.
 */
function stubChainStates(page, states, delayMs = 0) {
  let i = 0;
  // Match every request and decide inside: a "**/api" glob does not match the GenLayer RPC
  // endpoint, so the scripted states were silently bypassed and the app was talking to the
  // real node about a hash that never existed there.
  return page.route("**/*", async (route) => {
    const body = route.request().postData() ?? "";
    const rpcMethod = body.match(/"method":"([^"]+)"/)?.[1];
    if (!rpcMethod) return route.continue();
    const ok = (result) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
      });

    if (rpcMethod === "eth_sendRawTransaction") return ok(HASH);

    // After broadcasting, the app resolves the hash to confirm the transaction is known.
    // Without this the SDK asks the real node about a hash that never existed there.
    // After broadcasting, the SDK waits for a receipt before writeContract resolves. Without
    // a receipt it polls eth_getTransactionReceipt forever, which is correct SDK behaviour and
    // why the stage machine never advanced in an earlier run of this harness.
    if (rpcMethod === "eth_getTransactionReceipt") {
      return ok({
        transactionHash: HASH,
        transactionIndex: "0x0",
        blockHash: "0x" + "ab".repeat(32),
        blockNumber: "0x1",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x6B340D9C6230b31652aAbDC08acDAd763635A82b",
        cumulativeGasUsed: "0x7a120",
        gasUsed: "0x7a120",
        status: "0x1",
        logs: [NEW_TX_LOG],
        logsBloom: "0x" + "00".repeat(256),
      });
    }
    if (rpcMethod === "eth_getTransactionByHash") {
      return ok({
        hash: HASH,
        from: "0x1111111111111111111111111111111111111111",
        to: "0x6B340D9C6230b31652aAbDC08acDAd763635A82b",
        input: "0x",
        value: "0x0",
        nonce: "0x0",
        gas: "0x7a120",
        chainId: "0xf22f",
      });
    }
    if (!body.includes("gen_getTransactionStatus")) return route.continue();
    const state = states[Math.min(i, states.length - 1)];
    i += 1;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: state }),
    });
  });
}

const browser = await chromium.launch();

async function run(name, states, delayMs) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e}`));

  await page.addInitScript(MOCK_WALLET);
  await stubChainStates(page, states, delayMs);

  await page.goto(`${BASE}/promises/${pid}/evidence`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.getByTestId("action-connect").click().catch(() => {});
  await page.waitForTimeout(600);
  await page.getByTestId("field-sourceUrl").fill("https://example.com/lifecycle-probe");
  await page.getByTestId("field-quote").fill("A quoted passage used to observe stage transitions.");
  await page.waitForTimeout(300);

  const submit = page.getByTestId("tx-submit");
  if (await submit.isDisabled()) {
    check(`${name}: submit reachable`, false, "disabled after valid input + wallet");
    await ctx.close();
    return;
  }
  await submit.click();

  const seen = [];
  // The app polls every 3s and advances one state per poll, so budget for the whole scripted
  // progression rather than sampling it mid-flight.
  const stop = Date.now() + delayMs + 3000 * (states.length + 3);
  while (Date.now() < stop) {
    const s = await page.getByTestId("tx-status").getAttribute("data-stage").catch(() => null);
    if (s && seen.at(-1) !== s) seen.push(s);
    if (s === "final" || s === "failed") break;
    await page.waitForTimeout(120);
  }

  // Sampling can stop a beat short of the terminal stage, after which the message read below
  // would observe a state the stage list never recorded. Wait for the terminal stage
  // explicitly so the two observations cannot disagree.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="tx-status"]');
        const st = el && el.getAttribute("data-stage");
        return st === "final" || st === "failed";
      },
      null,
      { timeout: 8000 }
    )
    .catch(() => {});
  const terminal = await page.getByTestId("tx-status").getAttribute("data-stage").catch(() => null);
  if (terminal && seen.at(-1) !== terminal) seen.push(terminal);

  const panel = page.getByTestId("tx-status");
  // The live message, deliberately NOT the whole panel: the panel renders the full stage
  // list as static text, so "Finalized on chain" is present even while the transaction sits
  // at awaiting-wallet. Assertions against it proved nothing.
  const msgEl = page.getByTestId("tx-message");
  const message = (await msgEl.isVisible().catch(() => false))
    ? (await msgEl.innerText()).replace(/\s+/g, " ").trim()
    : "";

  check(`${name}: terminal stage reached`, terminal === "final" || terminal === "failed",
    `seen=${seen.join(" -> ")}`);
  check(`${name}: no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 1).join(""));
  if (states.at(-1) === "FINALIZED") {
    check(`${name}: message says finalized`, /finalized on chain/i.test(message), message.slice(0, 60));
    check(`${name}: shows the tx hash`, /0x[0-9a-f]{10,}/.test(await panel.innerText()));
  }
  if (states.at(-1) === "REVERTED") {
    check(`${name}: message explains the failure`, /end(ed)? as|reverted/i.test(message), message.slice(0, 80));
    check(`${name}: offers retry`, await page.getByTestId("tx-retry").isVisible().catch(() => false));
  }
  if (states.at(-1) === "UNDERCATED") {
    // The important property: an undercated transaction is never presented as success.
    check(`${name}: never claims success`, !/finalized on chain/i.test(message), message.slice(0, 60));
    check(`${name}: reports the real outcome`, /undercated/i.test(message), message.slice(0, 60));
  }

  await ctx.close();
}

// Progressing to final through every intermediate stage.
await run("consensus->final", ["PENDING", "PROPOSING", "COMMITTING", "ACCEPTED", "FINALIZED"], 150);
await run("straight to final", ["FINALIZED"], 0);
await run("reverted", ["PENDING", "REVERTED"], 150);
await run("undercated", ["PENDING", "UNDERCATED"], 150);

// ---- Wallet rejection and wrong network -------------------------------------------------
console.log(`\nWallet conditions\n`);
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(MOCK_WALLET);
  await page.addInitScript("window.__pdMock.rejectWrite = true;");
  await page.goto(`${BASE}/promises/${pid}/evidence`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.getByTestId("action-connect").click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByTestId("field-sourceUrl").fill("https://example.com/rejected");
  await page.getByTestId("field-quote").fill("This signature will be refused by the wallet.");
  await page.waitForTimeout(300);
  await page.getByTestId("tx-submit").click();
  await page.waitForTimeout(2500);
  const text = await page.getByTestId("tx-status").innerText().catch(() => "");
  check("rejection: reported as rejected", /reject/i.test(text), text.replace(/\s+/g, " ").slice(0, 80));
  check("rejection: form still usable", await page.getByTestId("field-quote").isVisible().catch(() => false));
  check("rejection: retry offered", await page.getByTestId("tx-retry").isVisible().catch(() => false));
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(MOCK_WALLET);
  await page.addInitScript("window.__pdMock.chainId = 0x1;");
  await page.goto(`${BASE}/promises/${pid}/evidence`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.getByTestId("action-connect").click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByTestId("field-sourceUrl").fill("https://example.com/wrongnet");
  await page.getByTestId("field-quote").fill("This write is attempted on the wrong chain.");
  await page.waitForTimeout(300);
  await page.getByTestId("tx-submit").click();
  await page.waitForTimeout(2500);
  const text = (await page.getByTestId("tx-status").innerText().catch(() => "")).replace(/\s+/g, " ");
  check("wrong network: named the chain mismatch", /chain/i.test(text), text.slice(0, 90));
  await ctx.close();
}

// ---- Disconnect mid-flight --------------------------------------------------------------
console.log(`\nMid-operation disruption\n`);
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(MOCK_WALLET);
  await stubChainStates(page, ["PENDING", "PENDING", "PENDING", "FINALIZED"], 400);
  await page.goto(`${BASE}/promises/${pid}/evidence`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.getByTestId("action-connect").click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByTestId("field-sourceUrl").fill("https://example.com/disconnect");
  await page.getByTestId("field-quote").fill("The wallet disappears while consensus is running.");
  await page.waitForTimeout(300);
  await page.getByTestId("tx-submit").click();
  await page.waitForTimeout(300);

  // Yank the wallet out from under the in-flight transaction.
  await page.evaluate(() => {
    window.__pdMock.accounts = [];
    window.__pdMock.autoConnect = false;
  });
  await page.waitForTimeout(2000);
  const survived = await page.getByTestId("tx-status").isVisible().catch(() => false);
  check("disconnect mid-flight: UI does not crash", survived);
  check("disconnect mid-flight: still tracks the tx",
    survived && /consensus|evaluating|submitted/i.test(await page.getByTestId("tx-status").innerText().catch(() => "")));
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(MOCK_WALLET);
  await stubChainStates(page, ["PENDING", "PENDING", "PENDING", "PENDING", "FINALIZED"], 500);
  await page.goto(`${BASE}/promises/${pid}/evidence`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.getByTestId("action-connect").click().catch(() => {});
  await page.waitForTimeout(500);
  await page.getByTestId("field-sourceUrl").fill("https://example.com/refresh");
  await page.getByTestId("field-quote").fill("The page reloads while the transaction is pending.");
  await page.waitForTimeout(300);
  await page.getByTestId("tx-submit").click();
  await page.waitForTimeout(700);

  // Reload mid-flight: the product must not claim anything it cannot know.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const afterReload = await page.getByTestId("tx-status").count();
  check("refresh during tx: no false 'final' claim", afterReload === 0 || !(await page.getByTestId("tx-status").getAttribute("data-stage").catch(() => "")).includes("final"));
  check("refresh during tx: page usable", await page.getByTestId("tx-submit").isVisible().catch(() => false));
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${"=".repeat(60)}\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  ${f.label} ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);