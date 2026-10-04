/**
 * Shim.
 *
 * The implementation lives in `apps/api/scripts/deploy.mjs` because that is the only place
 * `genlayer-js` resolves under pnpm's isolated store — a copy at the repository root cannot
 * import it at all. Two full copies of a deployment script is a maintenance hazard: they drift,
 * and the stale one is what someone eventually runs.
 *
 *   node scripts/deploy.mjs deploy ../../contracts/PromiseDecay.py
 *   node scripts/deploy.mjs certify <contractAddress>
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../apps/api/scripts/deploy.mjs");

const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
