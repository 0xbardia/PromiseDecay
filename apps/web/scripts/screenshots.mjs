/**
 * Visual QA capture.
 *
 * Produces desktop (1440) and mobile (390) screenshots of the real production pages so the
 * visual system can be inspected by eye, not just asserted on. Screenshots are written to
 * docs/screenshots/ for the README, and to .qa/ for review.
 *
 *   node scripts/screenshots.mjs
 */
import fs from "node:fs";
import path from "node:path";
// Import from @playwright/test rather than playwright-core: @playwright/test is a declared
// dependency of this package, so it resolves through pnpm's isolated store.
import { chromium } from "@playwright/test";

const BASE = process.env.PD_BASE_URL ?? "https://promisedecay.bydx.fun";
const OUT = process.env.PD_SHOT_DIR ?? path.resolve(process.cwd(), ".qa");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function firstPromiseId() {
  const res = await fetch(`${BASE}/api/v1/promises?limit=20`);
  const body = await res.json();
  // Prefer a record with drift so the timeline is exercised, not an empty one.
  const withDrift = (body.items ?? []).find((p) => (p.driftCount ?? 0) > 0);
  const chosen = withDrift ?? (body.items ?? [])[0];
  return { id: chosen?.promiseId, slug: chosen?.projectSlug };
}

const targets = async () => {
  const { id, slug } = await firstPromiseId();
  return [
    { route: "/", name: "landing" },
    { route: "/explore", name: "explore" },
    { route: "/promises/${id}".replace("${id}", String(id)), name: "promise-detail" },
    { route: `/projects/${slug}`, name: "project" },
    { route: "/record", name: "record" },
    { route: "/docs", name: "docs" },
    { route: "/roadmap", name: "roadmap" },
    { route: "/how-it-works", name: "how-it-works" },
  ];
};

const consoleErrors = [];

async function capture(page, route, name, vp) {
  const errors = [];
  const onConsole = (m) => {
    if (m.type() === "error") errors.push(`${route}@${vp.name}: ${m.text()}`);
  };
  page.on("console", onConsole);

  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 45_000 });
  // Let entrance transitions settle so the capture shows the resting state.
  await page.waitForTimeout(1400);

  const file = path.join(OUT, `${name}-${vp.name}.png`);
  await page.screenshot({ path: file, fullPage: vp.name === "desktop" });

  // Horizontal overflow is a design bug, not just a test failure.
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollW: d.scrollWidth, clientW: d.clientWidth };
  });
  page.off("console", onConsole);
  consoleErrors.push(...errors);

  console.log(
    `  ${name.padEnd(16)} ${vp.name.padEnd(8)} ${overflow.scrollW > overflow.clientW + 2 ? "OVERFLOW" : "ok"}` +
      (errors.length ? `  ${errors.length} console error(s)` : "")
  );
  return { name, vp: vp.name, overflow: overflow.scrollW > overflow.clientW + 2, errors: errors.length };
}

const browser = await chromium.launch();
const results = [];

for (const vp of VIEWPORTS) {
  console.log(`\n${vp.name} (${vp.width}px)`);
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.name === "mobile" ? 2 : 1,
    isMobile: vp.name === "mobile",
    hasTouch: vp.name === "mobile",
  });
  const page = await ctx.newPage();
  for (const t of await targets()) {
    results.push(await capture(page, t.route, t.name, vp));
  }
  await ctx.close();
}

await browser.close();

const bad = results.filter((r) => r.overflow || r.errors > 0);
console.log(`\n${results.length} captures -> ${OUT}`);
console.log(`overflow or console errors: ${bad.length === 0 ? "none" : JSON.stringify(bad, null, 2)}`);
process.exit(bad.length ? 1 : 0);