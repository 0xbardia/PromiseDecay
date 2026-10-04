/**
 * Shim.
 *
 * The implementation lives in `apps/api/scripts/lifecycle.mjs` because that is the only place
 * `genlayer-js` resolves under pnpm's isolated store — a copy at the repository root cannot
 * import it at all. This file used to be a full 14 KB duplicate of that script, which is a
 * maintenance hazard: two copies drift, and the stale one is what someone eventually runs.
 *
 *   node scripts/lifecycle.mjs
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../apps/api/scripts/lifecycle.mjs");

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);