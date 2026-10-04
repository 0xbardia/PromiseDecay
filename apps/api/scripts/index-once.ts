/**
 * One-shot indexer run.
 *
 * The long-running worker is apps/indexer. This script performs a single synchronous pass,
 * which is what you want for a deploy step, a smoke test, or verifying that rebuilding
 * derived state reproduces it exactly.
 *
 *   node --experimental-strip-types scripts/index-once.mjs   (or via tsx)
 */
import { loadEnv } from "@promisedecay/config";
import { createDatabase } from "@promisedecay/api/db";
import { GenlayerReader } from "@promisedecay/api/chain/reader";
import { syncOnce } from "@promisedecay/api/indexer/sync";

const env = loadEnv();

if (!env.GENLAYER_CONTRACT_ADDRESS) {
  console.error("GENLAYER_CONTRACT_ADDRESS is required for the indexer.");
  process.exit(1);
}

const reader = new GenlayerReader({
  rpcUrl: env.GENLAYER_RPC_URL,
  network: env.GENLAYER_NETWORK,
  address: env.GENLAYER_CONTRACT_ADDRESS,
});

const { sql, db } = createDatabase(env.DATABASE_URL, 2);

const logger = {
  info: (obj: unknown, msg?: string) =>
    console.log(JSON.stringify({ level: "info", msg, ...(obj as object) })),
  warn: (obj: unknown, msg?: string) =>
    console.warn(JSON.stringify({ level: "warn", msg, ...(obj as object) })),
  error: (obj: unknown, msg?: string) =>
    console.error(JSON.stringify({ level: "error", msg, ...(obj as object) })),
};

try {
  const result = await syncOnce(db, reader, logger);
  console.log(JSON.stringify({ sync: result }, null, 2));
  // A pass that indexed nothing while the chain reports promises is a real failure.
  process.exit(result.failed > 0 ? 1 : 0);
} catch (err) {
  console.error("index run failed:", (err as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}