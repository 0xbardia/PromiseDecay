/**
 * Indexer worker process.
 *
 * Runs under its own PM2 process. It owns no listener: it polls the chain, projects
 * finalized state into PostgreSQL, checkpoints its progress, and exits cleanly on
 * SIGTERM so a restart never leaves a half-written projection.
 */
import { loadEnv } from "@promisedecay/config";
// The indexer reuses the API's db/chain/indexer modules rather than copying them, so
// there is exactly one projection implementation in the repository.
import { createDatabase } from "@promisedecay/api/db";
import { GenlayerReader } from "@promisedecay/api/chain/reader";
import { syncOnce } from "@promisedecay/api/indexer/sync";

const env = loadEnv();

if (!env.GENLAYER_CONTRACT_ADDRESS) {
  console.error(
    "GENLAYER_CONTRACT_ADDRESS is required for the indexer.\n" +
      "Deploy the contract and set the address, then restart the indexer."
  );
  process.exit(1);
}

const logger = {
  info: (obj: unknown, msg?: string) => console.log(JSON.stringify({ level: "info", msg, ...(obj as object) })),
  warn: (obj: unknown, msg?: string) => console.warn(JSON.stringify({ level: "warn", msg, ...(obj as object) })),
  error: (obj: unknown, msg?: string) => console.error(JSON.stringify({ level: "error", msg, ...(obj as object) })),
};

const reader = new GenlayerReader({
  rpcUrl: env.GENLAYER_RPC_URL,
  network: env.GENLAYER_NETWORK,
  address: env.GENLAYER_CONTRACT_ADDRESS,
});

const { sql, db } = createDatabase(env.DATABASE_URL, 2);

let stopping = false;
let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick() {
  // Skip rather than overlap: a slow sync must not become a pile of concurrent ones.
  if (running || stopping) return;
  running = true;
  try {
    await syncOnce(db, reader, logger);
  } catch (err) {
    logger.error({ err: (err as Error).message }, "sync failed; will retry next interval");
  } finally {
    running = false;
  }
}

function schedule() {
  if (stopping) return;
  timer = setTimeout(async () => {
    await tick();
    schedule();
  }, env.INDEXER_INTERVAL_MS);
  // Do not hold the event loop open just for the next tick.
  timer.unref?.();
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "indexer shutting down");
  if (timer) clearTimeout(timer);
  // Let an in-flight sync finish so the checkpoint is not lost mid-write.
  const deadline = Date.now() + 15_000;
  while (running && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
  await sql.end({ timeout: 5 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ reason: String(reason) }, "unhandled rejection");
});

logger.info(
  {
    network: env.GENLAYER_NETWORK,
    contract: env.GENLAYER_CONTRACT_ADDRESS,
    intervalMs: env.INDEXER_INTERVAL_MS,
  },
  "indexer starting"
);

await tick();
schedule();