/**
 * Crawl the deployed site and check every internal link resolves.
 *
 * A dead link is the most common way a reviewer finds a product that was never actually used.
 * This walks the real rendered DOM rather than a route table, so it only reports links a user
 * could genuinely click, and distinguishes "page 404s" from "page renders but the link inside
 * it is broken".
 */
import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "https://promisedecay.bydx.fun";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 120)));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 120)}`));

const seeds = [
  "/",
  "/explore",
  "/how-it-works",
  "/roadmap",
  "/docs",
  "/record",
  "/promises/1",
  "/promises/1/evidence",
  "/promises/1/drift",
  "/promises/1/response",
  "/promises/1/resolution",
  "/projects/acme-protocol",
];

const seen = new Set();
const checked = new Map(); // url -> status
const consoleByPage = new Map();
const broken = [];

for (const seed of seeds) {
  const resp = await page.goto(BASE + seed, { waitUntil: "domcontentloaded" }).catch(() => null);
  const status = resp ? resp.status() : 0;
  checked.set(seed, status);
  if (status !== 200) broken.push({ from: seed, to: seed, status, kind: "page" });

  const before = consoleErrors.length;
  await page.waitForTimeout(700);

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href"))
      .filter((h) => h && !h.startsWith("#"))
  );
  const unique = [...new Set(links)];
  for (const href of unique) {
    const abs = new URL(href, BASE).toString();
    if (!abs.startsWith(BASE)) continue; // external link, not our concern here
    const key = abs.slice(BASE.length) || "/";
    if (seen.has(key)) continue;
    seen.add(key);
  }
  const gained = consoleErrors.slice(before);
  if (gained.length) consoleByPage.set(seed, gained);
}

// Now visit everything discovered and confirm it renders.
for (const path of [...seen]) {
  const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => null);
  const status = resp ? resp.status() : 0;
  checked.set(path, status);
  if (status >= 400 || status === 0) {
    broken.push({ from: "(crawl)", to: path, status, kind: "link" });
    continue;
  }
  // A page that renders but is actually the 404 view is still a broken link.
  const body = await page.locator("body").innerText().catch(() => "");
  if (/\b404\b|page not found|not found\b/i.test(body.slice(0, 400))) {
    broken.push({ from: "(crawl)", to: path, status, kind: "soft-404" });
  }
}

await browser.close();

console.log(`\nSeeds checked      : ${seeds.length}`);
console.log(`Links discovered   : ${seen.size}`);
console.log(`Total URLs visited : ${checked.size}`);
console.log(`Broken             : ${broken.length}`);

if (broken.length) {
  console.log("\nBROKEN:");
  for (const b of broken) console.log(`  [${b.kind}] ${b.to} -> HTTP ${b.status}`);
}

const noisy = [...consoleByPage.entries()];
if (noisy.length) {
  console.log("\nConsole noise by page:");
  for (const [p, msgs] of noisy) console.log(`  ${p}: ${msgs.slice(0, 2).join(" | ")}`);
}
if (consoleErrors.length) {
  console.log(`\nTotal console errors: ${consoleErrors.length}`);
}

console.log(
  `\n${broken.length === 0 && consoleErrors.length === 0 ? "CLEAN" : "ISSUES ABOVE"}`
);
process.exit(broken.length || consoleErrors.length ? 1 : 0);