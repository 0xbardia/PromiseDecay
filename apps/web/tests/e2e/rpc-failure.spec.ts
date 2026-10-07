import { expect, test } from "@playwright/test";

const now = Math.floor(Date.now() / 1000);
const detail = {
  promiseId: "2",
  project: "RPC failure fixture",
  projectSlug: "rpc-failure-fixture",
  actor: "0x1111111111111111111111111111111111111111",
  originalQuote: "The original public commitment remains unchanged.",
  action: "deliver",
  object: "the promised work",
  scope: "the published scope",
  deadlineTs: now - 1000,
  conditions: "",
  sourceUrl: "https://example.org/original",
  creator: "0x1111111111111111111111111111111111111111",
  createdTs: now - 86_400,
  contractVersion: "1.0.1",
  lifecycle: "RESOLVING",
  delivery: "KEPT",
  integrity: "UNCHANGED",
  deadlineMet: true,
  materialScopeChange: false,
  explanation: "Indexed provisional result.",
  decidedTs: now - 100,
  isFinal: false,
  challengeCount: 1,
  evidenceCount: 1,
  driftCount: 0,
  responseCount: 0,
  challengeClosesAt: now + 86_400,
  indexedAt: new Date().toISOString(),
  evidence: [
    {
      submitter: "0x1111111111111111111111111111111111111111",
      sourceUrl: "https://example.org/evidence",
      quote: "Supporting evidence",
      kind: "SOURCE",
      submittedTs: now - 200,
    },
  ],
  drift: [],
  responses: [],
  challenges: [],
};

test("rate-limited and unreachable reads stay explicit, retryable, and non-actionable", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.addInitScript(() => {
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: {
        request: async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return ["0x1111111111111111111111111111111111111111"];
          }
          if (method === "eth_chainId") return "0xf22f";
          return null;
        },
      },
    });
  });
  await page.route("**/api/v1/promises/2", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) })
  );

  let rpcAttempts = 0;
  await page.route("**/studio.genlayer.com/api", async (route) => {
    rpcAttempts += 1;
    if (rpcAttempts === 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 429,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32029, message: "Rate limit exceeded" },
        }),
      });
    } else {
      await route.abort("failed");
    }
  });

  await page.goto("/promises/2/challenge");
  await expect(page.getByText("Checking current contract state…")).toBeVisible();
  const unavailable = page.getByText("Network data is temporarily unavailable. Please retry shortly.");
  await expect(unavailable).toBeVisible();
  await expect(page.getByText(/indexed data and may be stale/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run fresh GenLayer evaluation" })).toHaveCount(0);

  await page.getByTestId("action-connect").click();
  await page.getByTestId("field-reason").fill("The indexed verdict omitted material new evidence.");
  await page.getByTestId("field-sourceUrl").fill("https://example.org/new-evidence");
  await expect(page.getByRole("button", { name: "Sign and submit this challenge" })).toBeDisabled();

  const retry = page.getByTestId("retry-contract-read");
  await retry.focus();
  expect(await retry.evaluate((el) => el.matches(":focus"))).toBe(true);
  await retry.press("Enter");
  await expect.poll(() => rpcAttempts).toBe(2);
  await expect(unavailable).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("fresh-verdict")).toHaveCount(0);

  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 720]]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
      `unexpected horizontal overflow at ${width}px`
    ).toBe(false);
  }

  await page.reload();
  await expect(unavailable).toBeVisible();
  expect(rpcAttempts).toBe(3);
  detail.lifecycle = "CHALLENGE_WINDOW";
  detail.challengeClosesAt = now - 1;
  await page.reload();
  await expect(unavailable).toBeVisible();
  await page.getByTestId("action-connect").click();
  await expect(page.getByRole("button", { name: "Finalize this resolution" })).toHaveCount(0);
  expect(rpcAttempts).toBe(4);
  expect(pageErrors).toEqual([]);
});
