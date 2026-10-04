/**
 * Environment parsing shared by the API and the indexer.
 *
 * Production must fail LOUDLY and by name when mandatory configuration is missing — a
 * half-configured service that boots and then 500s is worse than one that refuses to
 * start. Every variable the product actually needs is declared here; nothing is invented
 * and no secret has a default.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Minimal .env reader.
 *
 * Kept dependency-free on purpose (Principle VI): this is ~30 lines and runs before
 * anything else, so it should not be able to fail in interesting ways.
 */
function readDotEnv(): Record<string, string> {
  // Resolve upward from the running package so `apps/api` and `apps/indexer` both find
  // the single repo-root .env instead of each needing its own copy.
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) return parseDotEnv(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return {};
}

function parseDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const csv = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- Database -----------------------------------------------------------------
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .min(1, "DATABASE_URL is required")
    .refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(50).default(10),

  // --- GenLayer -----------------------------------------------------------------
  GENLAYER_RPC_URL: z
    .string({ required_error: "GENLAYER_RPC_URL is required" })
    .url("GENLAYER_RPC_URL must be a valid URL")
    .refine((v) => v.startsWith("https://") || v.startsWith("http://"), {
      message: "GENLAYER_RPC_URL must be http(s)",
    }),
  GENLAYER_CHAIN_ID: z.coerce.number().int().positive(),
  GENLAYER_NETWORK: z.string().min(1),
  GENLAYER_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "GENLAYER_CONTRACT_ADDRESS must be a 20-byte hex address")
    .optional(),

  // --- Indexer ------------------------------------------------------------------
  INDEXER_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
  INDEXER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // --- HTTP ---------------------------------------------------------------------
  API_PORT: z.coerce.number().int().positive().max(65535).default(4182),
  API_HOST: z.string().min(1).default("127.0.0.1"),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:4180"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // --- Rate limiting ------------------------------------------------------------
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  // --- Pagination ---------------------------------------------------------------
  DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(25),
  MAX_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(50),
});

export type Env = z.infer<typeof schema>;

/**
 * Parse and validate configuration.
 *
 * Real environment variables always win over `.env`, so a container/PM2 override is
 * never silently clobbered by a file on disk.
 *
 * @throws {Error} naming every missing/invalid key, so the operator can fix them all at
 * once instead of one restart at a time.
 */
export function loadEnv(source?: NodeJS.ProcessEnv): Env {
  const merged: NodeJS.ProcessEnv = { ...readDotEnv(), ...process.env };
  if (source) Object.assign(merged, source);
  const candidate: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined) candidate[k] = v;
  }

  const result = schema.safeParse(candidate);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
        `Copy .env.example to .env and fill in the required values.`
    );
  }
  return result.data;
}

/** CORS origins parsed from WEB_ORIGIN (comma-separated allowed). */
export function allowedOrigins(env: Env): string[] {
  return csv(env.WEB_ORIGIN);
}

export { csv };