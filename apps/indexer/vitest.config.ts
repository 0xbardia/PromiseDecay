import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Without this file vitest walks up out of the package and picks up a config belonging to
    // something else on the host, then fails to resolve `vite` — which is how the indexer ended
    // up with a `test` script that could not start at all.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});