/**
 * Exploratory user journey.
 *
 * Drives the deployed dApp the way a visitor would — no scripted contract writes — and
 * REPORTS what it finds rather than asserting a fixed expectation. Its job is to surface
 * defects, so every console error, page error, failed request, dead control and layout
 * overflow is collected and printed at the end.
 *
 *   node scripts/journey.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import { MOCK_WALLET } from "../tests/e2e/mock-wallet.mjs";

const BASE = process.argv[2] ?? "https://promisedecay.bydx.fun";
const findings = [];
const note = (severity, where, message) => {
  findings.push({ severity, where, message });
  console.log(`  [${severity}] ${where}: ${message}`);
};

function watch(page, label) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|DevTools|Download the React/i.test(t)) return;
    note("CONSOLE", label, t.slice(0, 180));
  });
  page.on("pageerror", (e) => note("PAGEERROR", label, String(e).slice(0, 200)));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (/ERR_ABORTED/.test(f)) return;
    note("REQFAIL", label, `${r.method()} ${r.url().replace(BASE, "")} — ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) note("HTTP5XX", label, `${r.status()} ${r.url().replace(BASE, "")}`);
  });
}

async function withWallet(page, script) {
  await page.addInitScript(MOCK_WALLET);
  if (script) await page.addInitScript(script);
}

async function overflowCheck(page, label) {
  const r = await page.evaluate(() => {
    const d = document.documentElement;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && (b.right > d.clientWidth + 2 || b.left < -2);
      })
      .slice(0, 4)
      .map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 30)}`);
    return { scrollW: d.scrollWidth, clientW: d.clientWidth, offenders };
  });
  if (r.scrollW > r.clientW + 2) {
    note("OVERFLOW", label, `${r.scrollW}px in a ${r.clientW}px viewport — ${r.offenders.join(", ")}`);
  }
}

/** Every interactive control must actually do something. */
async function deadControls(page, label) {
  const dead = await page.evaluate(() => {
    const out = [];
    for (const el of Array.from(document.querySelectorAll("a[href]"))) {
      const href = el.getAttribute("href") ?? "";
      if (href === "" || href === "#" || href === "javascript:void(0)") {
        out.push(`link "${(el.textContent || "").trim().slice(0, 28)}" -> ${href || "(empty)"}`);
      }
    }
    for (const el of Array.from(document.querySelectorAll("button"))) {
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if (el.disabled) continue;
      const hasTest = el.getAttribute("data-testid");
      const labelled = (el.textContent || "").trim().length > 0 || el.getAttribute("aria-label");
      if (!hasTest && !labelled) out.push(`button with no accessible name`);
    }
    return out;
  });
  for (const d of dead) note("DEAD", label, d);
}

const browser = await chromium.launch();

// Discover a live promise id from the public feed. Hard-coding one made the whole walkthrough
// silently meaningless after a redeploy: every action route 404'd and the results looked like
// product failures rather than a stale fixture.
async function livePromiseId() {
  const res = await fetch(`${BASE}/api/v1/promises?limit=20`);
  if (!res.ok) return null;
  const body = await res.json();
  return body.items?.[0]?.promiseId ?? null;
}

const PID = await livePromiseId();
console.log(`live promise under test: pd-${PID ?? "(none)"}`);

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, ...opts.ctx });
  const page = await ctx.newPage();
  return { ctx, page };
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 1. Anonymous visitor (no wallet) ===\n`);
{
  const { ctx, page } = await newPage();
  watch(page, "anon");
  for (const route of ["/", "/explore", "/how-it-works", "/roadmap", "/docs", "/record"]) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const h1 = await page.locator("h1").first().innerText().catch(() => "(none)");
    console.log(`  ${route.padEnd(14)} h1="${h1.slice(0, 44)}"`);
    if (!h1 || h1 === "(none)") note("A11Y", route, "no h1");
    await overflowCheck(page, `anon${route}`);
    await deadControls(page, `anon${route}`);
  }
  // Browse without a wallet must work everywhere.
  const wallet = await page.getByTestId("wallet-connect").count();
  console.log(`  wallet control present: ${wallet > 0}`);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 2. Real promise discovery + detail ===\n`);
{
  const { ctx, page } = await newPage();
  watch(page, "detail");
  await page.goto(BASE + "/explore", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const cards = page.getByTestId("promise-card");
  const n = await cards.count();
  console.log(`  feed cards: ${n}`);
  if (n === 0) note("DATA", "explore", "no promises rendered");

  // Click a card the way a user would.
  if (n > 0) {
    await cards.first().click();
    await page.waitForLoadState("networkidle");
    const url = page.url();
    console.log(`  card click -> ${url.replace(BASE, "")}`);
    if (!/\/promises\/\d+/.test(url)) note("NAV", "explore", `card click went to ${url}, not a promise`);
    await overflowCheck(page, "detail");

    const sections = {
      quote: ".pd-quote",
      drift: '[data-testid="drift-rail"]',
      evidence: '[data-testid="drift-rail"]',
      resolution: "text=/DELIVERY/i",
    };
    for (const [name, sel] of Object.entries(sections)) {
      const found = await page.locator(sel).first().isVisible().catch(() => false);
      console.log(`  ${name.padEnd(11)} ${found ? "visible" : "MISSING"}`);
      if (!found) note("LAYOUT", "detail", `${name} section not visible`);
    }

    // Provenance disclosure.
    const toggle = page.getByTestId("provenance-toggle");
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(400);
      const body = await page.getByTestId("provenance-body").isVisible().catch(() => false);
      console.log(`  provenance expands: ${body}`);
      if (!body) note("BUG", "detail", "provenance toggle did not reveal content");
    } else {
      note("BUG", "detail", "no provenance toggle");
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 3. Wallet: connect, wrong network, rejection ===\n`);
for (const [name, script] of [
  ["connected", "window.__pdMock.chainId = 0xf7a1;"],
  ["wrong-network", "window.__pdMock.chainId = 0x1;"],
  ["rejected", "window.__pdMock.rejectConnect = true;"],
]) {
  const { ctx, page } = await newPage();
  await withWallet(page, script);
  watch(page, `wallet:${name}`);
  await page.goto(BASE + "/record", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const connect = page.getByTestId("record-connect");
  if (await connect.count()) {
    await connect.click();
    await page.waitForTimeout(900);
    const alert = await page.getByRole("alert").first().innerText().catch(() => "");
    const connected = await page.getByText(/Connected as/i).isVisible().catch(() => false);
    console.log(`  ${name.padEnd(14)} connected=${connected} alert="${alert.slice(0, 52)}"`);
    if (name === "wrong-network" && !/chain/i.test(alert)) {
      note("BUG", `wallet:${name}`, "wrong network did not explain itself");
    }
    if (name === "rejected" && !/declin|reject/i.test(alert)) {
      note("BUG", `wallet:${name}`, `rejection not surfaced: "${alert.slice(0, 60)}"`);
    }
    if (name === "connected" && !connected) {
      note("BUG", `wallet:${name}`, "did not show a connected account");
    }
  } else {
    // Already connected on load (autoConnect) — verify the submit becomes reachable.
    const connected = await page.getByText(/Connected as/i).isVisible().catch(() => false);
    console.log(`  ${name.padEnd(14)} connected=${connected} (no connect button needed)`);
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 4. Write flows: validation only (no signature) ===\n`);
for (const flow of ["evidence", "update", "respond", "challenge"]) {
  const { ctx, page } = await newPage();
  await withWallet(page, "window.__pdMock.chainId = 0xf7a1;");
  watch(page, flow);
  await page.goto(`${BASE}/promises/${PID}/${flow}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const h1 = await page.locator("h1").first().innerText().catch(() => "(none)");
  console.log(`  ${flow.padEnd(10)} h1="${h1.slice(0, 36)}"`);

  // Submit must be blocked before anything is filled in.
  const submit = page.getByTestId("tx-submit");
  const disabled = await submit.isDisabled().catch(() => null);
  console.log(`             submit disabled initially: ${disabled}`);
  if (disabled !== true) note("BUG", flow, "submit was enabled with an empty form");

  // Fill with values the contract must reject, and confirm the UI catches them first.
  const urlField = page.getByTestId("field-sourceUrl");
  if (await urlField.count()) {
    await urlField.fill("http://127.0.0.1/private");
    await page.getByTestId("tx-submit").click({ force: true }).catch(() => {});
    await page.waitForTimeout(400);
    const alerts = await page.getByRole("alert").allInnerTexts().catch(() => []);
    const caught = alerts.some((a) => /IP address|loopback|localhost|domain name/i.test(a));
    console.log(`             blocks loopback URL: ${caught}`);
    if (!caught) note("BUG", flow, `SSRF-style URL not caught by UI: ${JSON.stringify(alerts).slice(0, 90)}`);
  }
  await overflowCheck(page, flow);
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 5. Transaction lifecycle states ===\n`);
{
  const { ctx, page } = await newPage();
  await withWallet(page, "window.__pdMock.chainId = 0xf7a1; window.__pdMock.rejectWrite = true;");
  watch(page, "tx");
  await page.goto(`${BASE}/promises/${PID}/evidence`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  await page.getByTestId("field-sourceUrl").fill("https://example.com/genesis-delivery-note");
  await page.getByTestId("field-quote").fill("The team confirmed the delivery window in writing.");
  await page.waitForTimeout(300);

  const submit = page.getByTestId("tx-submit");
  console.log(`  submit enabled with valid input: ${!(await submit.isDisabled())}`);
  if (await submit.isDisabled()) {
    note("BUG", "tx", "submit stayed disabled after filling valid fields");
  } else {
    await submit.click();
    await page.waitForTimeout(3500);
    const panel = await page.getByTestId("tx-panel").innerText().catch(() => "");
    console.log(`  panel after rejection:\n    ${panel.replace(/\n+/g, "\n    ").slice(0, 220)}`);
    if (!/reject/i.test(panel)) note("BUG", "tx", "signature rejection not reported to the user");
    // The form must remain usable so the user can retry.
    const stillThere = await page.getByTestId("field-quote").isVisible().catch(() => false);
    if (!stillThere) note("BUG", "tx", "form vanished after a rejected signature");
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 6. Deep links, refresh, 404 ===\n`);
{
  const { ctx, page } = await newPage();
  watch(page, "deep");
  for (const route of ["/promises/99999", "/promises/abc", "/projects/does-not-exist", "/nope"]) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const text = (await page.locator("main, body").first().innerText()).replace(/\s+/g, " ").slice(0, 90);
    console.log(`  ${route.padEnd(26)} ${text.slice(0, 80)}`);
    if (text.trim().length < 20) note("BLANK", route, "page rendered essentially empty");
  }
  // Refresh on a deep route must keep working.
  await page.goto(`${BASE}/promises/${PID}`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const survived = await page.getByTestId("drift-rail").isVisible().catch(() => false);
  console.log(`  refresh on /promises/${PID} keeps drift rail: ${survived}`);
  if (!survived) note("BUG", "deep", "refresh lost the promise detail");
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 7. Mobile (390px) ===\n`);
{
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, ctx: { isMobile: true, hasTouch: true } });
  watch(page, "mobile");
  for (const route of ["/", "/explore", `/promises/${PID}`, `/promises/${PID}/evidence`, "/record", "/docs"]) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await overflowCheck(page, `mobile ${route}`);
    // Tap targets must be reachable.
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a, button"))
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && (b.height < 32 || b.width < 32);
        })
        .slice(0, 5)
        .map((el) => `${(el.textContent || el.tagName).trim().slice(0, 20)} ${Math.round(el.getBoundingClientRect().height)}px`)
    );
    if (small.length) note("A11Y", `mobile ${route}`, `small tap targets: ${small.join(" | ")}`);
  }
  console.log("  mobile routes checked");
  await ctx.close();
}

// ---------------------------------------------------------------------------------------
console.log(`\n=== 8. Keyboard-only navigation ===\n`);
{
  const { ctx, page } = await newPage();
  watch(page, "keyboard");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const stops = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const s = getComputedStyle(a);
      return { text: (a.textContent || "").trim().slice(0, 26), tag: a.tagName, outline: s.outlineStyle, shadow: s.boxShadow !== "none" };
    });
    if (el) stops.push(el);
  }
  const noFocusRing = stops.filter((s) => s.outline === "none" && !s.shadow);
  console.log(`  tab stops visited: ${stops.length}, without a visible focus ring: ${noFocusRing.length}`);
  if (noFocusRing.length) note("A11Y", "keyboard", `no focus ring: ${noFocusRing.map((s) => s.text).join(", ")}`);
  await ctx.close();
}

await browser.close();

// ---------------------------------------------------------------------------------------
console.log(`\n${"=".repeat(72)}`);
if (findings.length === 0) {
  console.log("NO DEFECTS REPORTED");
} else {
  const bySeverity = {};
  for (const f of findings) (bySeverity[f.severity] ||= []).push(f);
  for (const [sev, list] of Object.entries(bySeverity)) {
    console.log(`\n${sev} (${list.length}):`);
    const seen = new Set();
    for (const f of list) {
      const k = `${f.where}|${f.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  ${f.where}: ${f.message}`);
    }
  }
}
console.log(`${"=".repeat(72)}`);
process.exit(findings.some((f) => ["PAGEERROR", "HTTP5XX", "OVERFLOW", "BLANK"].includes(f.severity)) ? 1 : 0);
