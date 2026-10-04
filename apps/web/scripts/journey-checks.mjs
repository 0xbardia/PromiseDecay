/**
 * Interaction questions a static screenshot cannot answer.
 *
 * Each check asks what a user pressing something would actually get. These are the places
 * where a control looks available and quietly is not, or where it is available and leads
 * nowhere.
 */
import { chromium } from "@playwright/test";
import { MOCK_WALLET } from "../tests/e2e/mock-wallet.mjs";

const BASE = process.argv[2] ?? "https://promisedecay.bydx.fun";
const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 140)));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 140)}`));

console.log(`\nRecord page without a wallet\n`);
await page.goto(`${BASE}/record`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const submit = page.getByTestId("tx-submit");
const disabledBeforeConnect = await submit.isDisabled();
check(
  "submit is disabled before a wallet is connected",
  disabledBeforeConnect,
  disabledBeforeConnect ? "" : "enabled with no wallet — leads to a dead end"
);

// If it is enabled, pressing it must produce a clear explanation, not silence.
if (!disabledBeforeConnect) {
  await submit.click();
  await page.waitForTimeout(1500);
  const status = page.getByTestId("tx-status");
  const visible = await status.isVisible().catch(() => false);
  const msg = visible ? (await page.getByTestId("tx-message").innerText().catch(() => "")) : "";
  check(
    "pressing it without a wallet explains what to do",
    visible && /wallet|connect/i.test(msg),
    msg.slice(0, 70) || "(no message)"
  );
} else {
  check("pressing it without a wallet explains what to do", true, "unreachable: button disabled");
}

check(
  "the page tells the user their wallet signs and no key is held",
  await page.getByText(/never holds a key|no key for you/i).first().isVisible().catch(() => false)
);

// ---- Explore: does search actually filter? ----------------------------------------------
console.log(`\nExplore search and filters\n`);
await page.goto(`${BASE}/explore`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const countAll = await page.getByTestId("promise-card").count();
const search = page.getByPlaceholder(/search projects and promises/i);
await search.fill("ethereum");
await page.waitForTimeout(1400);
const countEthereum = await page.getByTestId("promise-card").count();
check(
  "search narrows the list",
  countEthereum < countAll,
  `"ethereum": ${countAll} -> ${countEthereum}`
);

await search.fill("zzzznomatchzzzz");
await page.waitForTimeout(1400);
const countNone = await page.getByTestId("promise-card").count();
const emptyMsg = await page
  .getByText(/no promises|nothing|no results|no matches/i)
  .first()
  .isVisible()
  .catch(() => false);
check("a no-match search shows an empty state, not a blank page", emptyMsg, `${countNone} cards`);

await search.fill("");
await page.waitForTimeout(1200);
check("clearing search restores the list", (await page.getByTestId("promise-card").count()) === countAll);

// ---- Filter chips -------------------------------------------------------------------------
console.log(`\nFilters\n`);
const chips = page.locator(".pd-chip");
const chipCount = await chips.count();
check("filter chips exist", chipCount > 0, `${chipCount} chips`);

if (chipCount > 0) {
  const kept = chips.filter({ hasText: /^kept$/i }).first();
  if (await kept.count()) {
    await kept.click();
    await page.waitForTimeout(1200);
    const afterKept = await page.getByTestId("promise-card").count();
    const cards = await page.getByTestId("promise-card").allInnerTexts();
    const allKept = cards.every((c) => /KEPT/i.test(c));
    check(
      "a verdict filter only shows matching records",
      afterKept === 0 || allKept,
      `${afterKept} cards, all KEPT: ${allKept}`
    );
  }
}

// ---- Project deep link --------------------------------------------------------------------
console.log(`\nDeep links\n`);
await page.goto(`${BASE}/projects/acme-protocol`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
check("project page renders its promises", (await page.getByTestId("promise-card").count()) > 0);
check("project page has a heading", await page.locator("h1").first().isVisible().catch(() => false));

console.log(`\nConsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 3)) console.log(`   ${e}`);
check("no console errors during the walk", consoleErrors.length === 0);

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${"=".repeat(58)}\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log("NEEDS ATTENTION:");
  for (const f of failed) console.log(`  ${f.label} ${f.detail}`);
}
process.exit(failed.length ? 1 : 0);