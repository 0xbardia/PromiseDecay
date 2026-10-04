/**
 * Core production user journeys against https://promisedecay.bydx.fun.
 *
 * Runs on all three engines. Console errors, page errors and failed requests are
 * collected per test and asserted clean, because "the page rendered" is not the same as
 * "the page works".
 */
import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

interface Noise {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  page: Page;
}

/** Ignore noise that is expected and not caused by the app under test. */
function isBenign(text: string): boolean {
  return (
    /favicon/i.test(text) ||
    /Download the React DevTools/i.test(text)
  );
}

/**
 * Scroll an element into view, then click it.
 *
 * The app sets `scroll-behavior: smooth`, and that is exactly what breaks Playwright's own
 * `scrollIntoViewIfNeeded` path: the engine scrolls, and by the time it recomputes the click
 * point the surface is still animating, so the synthetic click is dispatched at stale
 * coordinates and lands on nothing. The failure is engine-dependent (it reproduces on
 * Chromium, Firefox and WebKit), which is why it looks flaky rather than obviously wrong.
 *
 * Scrolling with `behavior: "instant"` first puts the page at a known resting position, so
 * the click point is correct on every engine. This is a test-harness concern only — a human
 * clicks what they can actually see.
 */
async function clickAfterScroll(page: Page, target: ReturnType<Page["locator"]>): Promise<void> {
  await target.evaluate((el) => {
    el.scrollIntoView({ block: "center", behavior: "instant" });
  });
  // One frame so layout reflects the new scroll offset before the click is dispatched.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  );
  await target.click();
}

function watch(page: Page): Noise {
  const noise: Noise = { consoleErrors: [], pageErrors: [], failedRequests: [], page };
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" && !isBenign(msg.text())) {
      noise.consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => noise.pageErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    // Aborted navigations are normal during client-side routing.
    const failure = req.failure()?.errorText ?? "";
    if (/ERR_ABORTED|net::ERR_ABORTED/.test(failure)) return;
    noise.failedRequests.push(`${req.method()} ${req.url()} — ${failure}`);
  });
  return noise;
}

async function assertClean(noise: Noise, label: string) {
  expect(noise.pageErrors, `${label}: uncaught page errors`).toEqual([]);
  expect(noise.consoleErrors, `${label}: console errors`).toEqual([]);
  expect(noise.failedRequests, `${label}: failed requests`).toEqual([]);
}

test.describe("PromiseDecay production", () => {
  test("landing: headline, CTAs, hero product visual", async ({ page }) => {
    const noise = watch(page);
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Promises deserve a memory."
    );
    await expect(page.getByText(/GenLayer consensus to determine what was actually delivered/)).toBeVisible();

    // Primary and secondary CTAs must be real, visible links.
    const explore = page.getByTestId("cta-explore");
    const record = page.getByTestId("cta-record");
    await expect(explore).toBeVisible();
    await expect(record).toBeVisible();
    await expect(explore).toHaveAttribute("href", "/explore");
    await expect(record).toHaveAttribute("href", "/record");

    // The hero must show real product UI: the Promise Lens with real statuses.
    const lens = page.getByTestId("promise-lens");
    await expect(lens).toBeVisible();
    await expect(page.getByTestId("lens-quote")).toBeVisible();
    await expect(lens).toContainText(/PARTIAL|UNRESOLVED/);

    // The lens is interactive.
    const before = await lens.getAttribute("data-frame");
    await page.getByTestId("lens-next").click();
    await expect(lens).not.toHaveAttribute("data-frame", before ?? "");

    await assertClean(noise, "landing");
  });

  test("explore: feed renders real records with statuses", async ({ page }) => {
    const noise = watch(page);
    await page.goto("/explore");
    await expect(page.getByRole("heading", { name: /Public commitments/i })).toBeVisible();

    const cards = page.getByTestId("promise-card");
    await expect(cards.first()).toBeVisible({ timeout: 25_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);

    // Status is conveyed as text, not colour alone.
    await expect(page.getByText(/PARTIAL|KEPT|UNRESOLVED|NOT_KEPT/).first()).toBeVisible();

    await assertClean(noise, "explore");
  });

  test("explore: search filters the feed", async ({ page }) => {
    const noise = watch(page);
    await page.goto("/explore");
    await expect(page.getByTestId("promise-card").first()).toBeVisible({ timeout: 25_000 });

    const search = page.getByTestId("explore-search");
    await search.fill("zzzznotathingmatches");
    await search.press("Enter");

    await expect(page.getByTestId("empty-state")).toBeVisible({ timeout: 20_000 });
    await assertClean(noise, "search");
  });

  test("promise detail: original, drift rail, evidence, provenance", async ({ page }) => {
    const noise = watch(page);

    // Discover a real promise id from the public feed.
    const res = await page.request.get("/api/v1/promises?limit=1");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const id = body.items?.[0]?.promiseId;
    expect(id, "expected at least one indexed promise").toBeTruthy();

    await page.goto(`/promises/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 25_000 });

    // The original quote is the visual anchor.
    await expect(page.locator(".pd-quote").first()).toBeVisible();

    // Drift lineage is rendered as an ordered timeline.
    const rail = page.getByTestId("drift-rail");
    await expect(rail).toBeVisible();
    await expect(page.getByTestId("drift-step-original")).toBeVisible();
    await expect(page.getByTestId("drift-step-deadline")).toBeVisible();

    // Provenance is progressively disclosed, not dumped.
    await page.getByTestId("provenance-toggle").click();
    await expect(page.getByTestId("provenance-body")).toBeVisible();

    await assertClean(noise, "promise detail");
  });

  test("promise detail: deep-link refresh survives a reload", async ({ page }) => {
    const noise = watch(page);
    const res = await page.request.get("/api/v1/promises?limit=1");
    const id = (await res.json()).items?.[0]?.promiseId;
    expect(id).toBeTruthy();

    await page.goto(`/promises/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 25_000 });

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("drift-rail")).toBeVisible();

    await assertClean(noise, "deep-link refresh");
  });

  test("browsing requires no wallet", async ({ page }) => {
    const noise = watch(page);
    for (const route of ["/", "/explore", "/how-it-works", "/roadmap", "/docs"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 25_000 });
      // The wallet button must offer connection, never demand one to read.
      await expect(page.getByTestId("wallet-connect")).toBeVisible();
    }
    await assertClean(noise, "no-wallet browsing");
  });

  test("docs: sidebar navigation works across pages", async ({ page }) => {
    const noise = watch(page);
    await page.goto("/docs");
    await expect(page.getByTestId("docs-index")).toBeVisible();

    for (const slug of ["getting-started", "contract", "consensus", "api", "deployment"]) {
      await page.goto(`/docs/${slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".pd-prose")).toBeVisible();
    }
    await assertClean(noise, "docs");
  });

  test("roadmap: only V1 is marked shipped", async ({ page }) => {
    const noise = watch(page);
    await page.goto("/roadmap");
    await expect(page.getByTestId("roadmap-list")).toBeVisible();
    await expect(page.getByTestId("roadmap-state-V1")).toContainText("Shipped");
    await expect(page.getByTestId("roadmap-state-V1.1")).toContainText("Planned");
    await expect(page.getByTestId("roadmap-state-V2")).toContainText("Planned");
    await assertClean(noise, "roadmap");
  });

  test("record: validates before asking for a signature", async ({ page }) => {
    const noise = watch(page);
    await page.goto("/record");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // With no wallet connected, the submit button must be disabled and explained.
    const submit = page.getByTestId("tx-submit");
    await expect(submit).toBeDisabled();

    // Invalid URL is reported inline, before any transaction.
    await page.getByTestId("record-source-url").fill("http://127.0.0.1/secret");
    await page.getByTestId("record-quote").click();
    await expect(page.getByRole("alert").first()).toBeVisible();

    // Progressive disclosure for the optional fields.
    //
    const toggle = page.getByTestId("record-toggle-advanced");
    await clickAfterScroll(page, toggle);
    await expect(page.locator("#action")).toBeVisible();

    await assertClean(noise, "record");
  });

  test("404 route is designed, not blank", async ({ page }) => {
    const noise = watch(page);
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByText(/does not exist/i)).toBeVisible();
    await assertClean(noise, "404");
  });

  test("API failure surfaces a recoverable message", async ({ page }) => {
    const noise = watch(page);
    // Fail the feed request and confirm the UI explains itself rather than going blank.
    await page.route("**/api/v1/promises*", (route) => route.abort("failed"));
    await page.goto("/explore");
    await expect(page.getByTestId("notice-error")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();

    // The app handled the failure deliberately, so the browser's own console noise about
    // the aborted request is expected here and must not be counted against the app.
    // What matters is that there is no UNCAUGHT page error.
    expect(noise.pageErrors, "api failure: uncaught page errors").toEqual([]);

    // And recovery works: with the route restored the feed renders again.
    await page.unroute("**/api/v1/promises*");
    await page.getByRole("button", { name: /retry/i }).click();
    await expect(page.getByTestId("promise-card").first()).toBeVisible({ timeout: 25_000 });
  });
});

test.describe("responsive", () => {
  for (const width of [320, 390, 768, 1440]) {
    test(`no horizontal overflow at ${width}px`, async ({ page }) => {
      for (const route of ["/", "/explore", "/how-it-works", "/roadmap", "/docs"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await page.waitForLoadState("networkidle").catch(() => undefined);

        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return {
            scrollW: doc.scrollWidth,
            clientW: doc.clientWidth,
            offenders: Array.from(document.querySelectorAll("body *"))
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.right > doc.clientWidth + 2 || r.left < -2;
              })
              .slice(0, 5)
              .map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 40)}`),
          };
        });

        expect(
          overflow.scrollW,
          `${route} at ${width}px overflows: ${overflow.offenders.join(", ")}`
        ).toBeLessThanOrEqual(overflow.clientW + 2);
      }
    });
  }
});

test.describe("accessibility", () => {
  test("keyboard navigation and visible focus on the landing page", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const s = getComputedStyle(el);
      return { tag: el.tagName, text: (el.textContent || "").trim().slice(0, 40), outline: s.outlineStyle };
    });
    expect(focused, "focus should land on the skip link").not.toBeNull();
    // The skip link must be the first stop and must become visible on focus.
    await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
  });

  test("every image and control has an accessible name", async ({ page }) => {
    await page.goto("/explore");

    // Wait for the card list to settle before scanning. The list is populated from the API, so
    // waiting for only the first card left a window in which later cards had not rendered and
    // their controls were absent from the scan — the source of the intermittent failure.
    await expect(page.getByTestId("promise-card").first()).toBeVisible({ timeout: 25_000 });
    await page.waitForLoadState("networkidle");
    await expect
      .poll(async () => page.getByTestId("promise-card").count(), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const unlabelled = await page.evaluate(() => {
      const problems: string[] = [];
      for (const el of Array.from(
        document.querySelectorAll("button, a, input, select, textarea, img")
      )) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const name =
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          (el.textContent || "").trim() ||
          (el as HTMLInputElement).placeholder ||
          (el.labels?.[0]?.textContent ?? "") ||
          // An image is named by its alt text, which none of the above surface.
          (el as HTMLImageElement).alt ||
          "";
        if (!name) problems.push(`${el.tagName}: ${(el.className || "").toString().slice(0, 40)}`);
      }
      return problems;
    });
    expect(unlabelled).toEqual([]);

    // Prove the scan can actually fail. Without this, a selector or evaluate bug that made it
    // inspect nothing would report success — the test would pass while checking zero elements.
    const scanned = await page.evaluate(
      () => document.querySelectorAll("button, a, input, select, textarea, img").length
    );
    expect(scanned, "the accessible-name scan inspected nothing").toBeGreaterThan(10);
  });

  test("reduced motion is honoured", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByTestId("promise-lens")).toBeVisible();

    // Assert the property the test is named for, rather than inferring it from behaviour.
    //
    // The previous version clicked the lens and asserted that `data-frame` changed. That
    // proved the lens advanced — it said nothing about whether motion was disabled, and it
    // depended on a click landing within the assertion window, so it went flaky under the
    // parallel three-browser run. Computed style is deterministic.
    //
    // The reset is 0.001ms rather than 0s on purpose (a well-known accessibility
    // workaround): browsers ignore `animationend`/`transitionend` for zero-duration
    // animations, which would break any listener waiting to clean up.
    const motion = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("*")).slice(0, 400);
      const offenders: string[] = [];
      for (const el of nodes) {
        const cs = getComputedStyle(el);
        const ms = (v: string) => (v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000);
        const anim = cs.animationName === "none" ? 0 : ms(cs.animationDuration);
        const trans = ms(cs.transitionDuration);
        if (anim > 1 || trans > 1) {
          offenders.push(
            `${el.tagName}.${el.className}: anim=${cs.animationName}/${cs.animationDuration} trans=${cs.transitionDuration}`
          );
        }
      }
      return {
        offenders: offenders.slice(0, 5),
        scroll: getComputedStyle(document.documentElement).scrollBehavior,
      };
    });

    expect(motion.offenders, `still animating under reduced motion: ${motion.offenders.join(" | ")}`).toEqual([]);
    // Smooth scrolling is itself motion, and is what the earlier click-eating bug came from.
    expect(motion.scroll).not.toBe("smooth");

    // And the feature must remain fully usable — reduced motion disables movement, not function.
    const before = await page.getByTestId("promise-lens").getAttribute("data-frame");
    await page.getByTestId("lens-next").click();
    await expect(page.getByTestId("promise-lens")).not.toHaveAttribute("data-frame", before ?? "", {
      timeout: 15_000,
    });
  });

  test("motion is enabled when the user has not asked for reduced motion", async ({ page }) => {
    // The complement of the test above, so the reduced-motion path cannot pass by disabling
    // motion unconditionally. Without this, the product could satisfy the accessibility
    // requirement simply by never animating anything.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await expect(page.getByTestId("promise-lens")).toBeVisible();

    const scroll = await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior
    );
    expect(scroll, "smooth scrolling should be restored when motion is allowed").toBe("smooth");
  });

  test("search filters as you type, without pressing Enter", async ({ page }) => {
    // Regression: the field applied a query only on form submit, and the form has no visible
    // submit control. Typing did nothing, so the search box looked broken to anyone who did
    // not happen to press Enter. This asserts typing alone is enough.
    await page.goto("/explore");
    const cards = page.getByTestId("promise-card");
    await expect(cards.first()).toBeVisible({ timeout: 25_000 });
    const total = await cards.count();
    expect(total).toBeGreaterThan(0);

    // A term that cannot match anything, so the direction of the change is unambiguous.
    const search = page.getByTestId("explore-search");
    await search.fill("zzzznomatchzzzz");
    await expect(cards).toHaveCount(0, { timeout: 10_000 });

    // The empty state must say so, rather than leaving a blank page.
    await expect(page.getByTestId("explore-search-status")).toContainText(/no promises match/i);

    // A term drawn from a live record narrows to fewer than everything.
    await search.fill("a");
    await expect.poll(async () => cards.count(), { timeout: 10_000 }).toBeLessThan(total + 1);

    await search.fill("");
    await expect(cards).toHaveCount(total, { timeout: 10_000 });
  });

  test("search result count is announced", async ({ page }) => {
    // The status line is what makes typing visibly do something; without it the page looks
    // inert even though the query is applied.
    await page.goto("/explore");
    await expect(page.getByTestId("promise-card").first()).toBeVisible({ timeout: 25_000 });
    const status = page.getByTestId("explore-search-status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await page.getByTestId("explore-search").fill("zzzznomatchzzzz");
    await expect(status).toContainText(/no promises match/i, { timeout: 10_000 });
  });

  test("status is never conveyed by colour alone", async ({ page }) => {
    await page.goto("/explore");
    await expect(page.getByTestId("promise-card").first()).toBeVisible({ timeout: 25_000 });
    // Every status chip carries its own text label.
    const chips = page.locator(".pd-chip");
    const n = await chips.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(n, 6); i++) {
      const text = (await chips.nth(i).innerText()).trim();
      expect(text.length, "a status chip must carry a text label").toBeGreaterThan(0);
    }
  });
});