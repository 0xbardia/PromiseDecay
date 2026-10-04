import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright runs against the REAL production build and the REAL production domain.
 *
 * These are not localhost smoke tests: the point of the browser matrix is to prove the
 * deployed product works for a real visitor, behind real TLS, with the real API.
 */
const BASE_URL = process.env.PD_BASE_URL ?? "https://promisedecay.bydx.fun";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The GenLayer RPC is a shared public node with tight rate limits; serial execution
  // avoids several workers competing for the same budget.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],

  // Viewport coverage is asserted inside the tests so every engine checks every width.
  webServer: undefined,
});