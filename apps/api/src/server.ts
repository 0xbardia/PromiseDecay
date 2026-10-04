/**
 * PromiseDecay API — a read-only public surface over the indexed on-chain projection.
 *
 * The API NEVER decides a promise outcome and never signs a write. Every response is
 * derived state; the GenLayer contract is authoritative.
 */
import fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { allowedOrigins, loadEnv, type Env } from "@promisedecay/config";
import { createDatabase } from "./db/client.js";
import { GenlayerReader } from "./chain/reader.js";
import {
  ApiError,
  ErrorCode,
  decodeCursor,
  limitSchema,
  resolveLimit,
} from "./lib/http.js";
import {
  getProject,
  getPromiseDetail,
  listProjects,
  listPromises,
  searchPromises,
} from "./repo/promises.js";

export interface BuildAppOptions {
  env?: Env;
  /** Injected in tests to avoid a real database / network. */
  db?: ReturnType<typeof createDatabase>["db"];
  reader?: GenlayerReader;
}

const listQuery = z.object({
  limit: limitSchema,
  cursor: z.string().min(1).optional(),
  lifecycle: z.string().optional(),
  delivery: z.string().optional(),
  integrity: z.string().optional(),
  project: z.string().min(1).max(120).optional(),
  q: z.string().min(1).max(200).optional(),
});

const splitList = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return parts.length ? parts : undefined;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();
  const owns = !options.db;
  const connection = options.db
    ? { db: options.db, sql: null as never }
    : createDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const db = connection.db;

  const reader =
    options.reader ??
    (env.GENLAYER_CONTRACT_ADDRESS
      ? new GenlayerReader({
          rpcUrl: env.GENLAYER_RPC_URL,
          network: env.GENLAYER_NETWORK,
          address: env.GENLAYER_CONTRACT_ADDRESS,
        })
      : null);

  const app = fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        remove: true,
      },
    },
    // Trust nothing larger than a small JSON body; promises are bounded on chain too.
    bodyLimit: 32 * 1024,
    genReqId: (req) => (req.headers["x-request-id"] as string) || crypto.randomUUID(),
    requestIdHeader: "x-request-id",
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin/no-origin (SSR, curl) and allow-listed browser origins only.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins(env).includes(origin));
    },
    credentials: false,
    methods: ["GET", "HEAD"],
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_MS,
    // Rate limit per IP; the API is public and read-only.
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
      },
    }),
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    const requestId = req.id;
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details, requestId },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: ErrorCode.VALIDATION_FAILED,
          message: "Some query parameters are invalid.",
          details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          requestId,
        },
      });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, "unhandled error");
    return reply.status(status).send({
      error: {
        code: status >= 500 ? ErrorCode.INTERNAL : ErrorCode.VALIDATION_FAILED,
        message: status >= 500 ? "Something went wrong on our side." : error.message,
        requestId,
      },
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: `No route matches ${req.method} ${req.url}.`,
        requestId: req.id,
      },
    });
  });

  // --- Health -----------------------------------------------------------------------

  app.get("/health/live", async () => ({ status: "ok", uptime: process.uptime() }));

  app.get("/health/ready", async (_req, reply) => {
    const checks: Record<string, "ok" | "fail"> = { database: "fail", chain: "fail" };
    try {
      await db.execute("SELECT 1" as never);
      checks.database = "ok";
    } catch {
      checks.database = "fail";
    }
    if (reader) {
      checks.chain = (await reader.ping()) ? "ok" : "fail";
    } else {
      // No contract configured is a configuration problem, not a healthy state.
      checks.chain = "fail";
    }
    const ready = Object.values(checks).every((v) => v === "ok");
    reply.status(ready ? 200 : 503);
    return { status: ready ? "ready" : "not-ready", checks };
  });

  // --- Public data ------------------------------------------------------------------

  app.get("/api/v1/config", async () => ({
    contractAddress: env.GENLAYER_CONTRACT_ADDRESS ?? null,
    network: env.GENLAYER_NETWORK,
    chainId: env.GENLAYER_CHAIN_ID,
    rpcUrl: env.GENLAYER_RPC_URL,
  }));

  app.get("/api/v1/promises", async (req) => {
    const q = listQuery.parse(req.query);
    const limit = resolveLimit(q.limit, env.MAX_PAGE_SIZE, env.DEFAULT_PAGE_SIZE);
    const result = await listPromises(db, {
      limit,
      cursor: q.cursor ? decodeCursor(q.cursor) : undefined,
      lifecycle: splitList(q.lifecycle),
      delivery: splitList(q.delivery),
      integrity: splitList(q.integrity),
      projectSlug: q.project?.toLowerCase(),
    });
    return { ...result, limit };
  });

  app.get("/api/v1/promises/:id", async (req) => {
    const { id } = req.params as { id: string };
    if (!/^\d+$/.test(id)) throw ApiError.badRequest("Promise id must be a positive integer.");
    const detail = await getPromiseDetail(db, id);
    if (!detail) throw ApiError.notFound(`Promise pd-${id}`);
    return detail;
  });

  app.get("/api/v1/projects", async (req) => {
    const q = z.object({ limit: limitSchema }).parse(req.query);
    const limit = resolveLimit(q.limit, env.MAX_PAGE_SIZE, env.DEFAULT_PAGE_SIZE);
    return listProjects(db, limit);
  });

  app.get("/api/v1/projects/:slug", async (req) => {
    const { slug } = req.params as { slug: string };
    const project = await getProject(db, slug.toLowerCase());
    if (!project) throw ApiError.notFound(`Project "${slug}"`);
    return project;
  });

  app.get("/api/v1/search", async (req) => {
    const q = listQuery.extend({ q: z.string().min(1).max(200) }).parse(req.query);
    const limit = resolveLimit(q.limit, env.MAX_PAGE_SIZE, env.DEFAULT_PAGE_SIZE);
    return searchPromises(db, q.q, limit, q.cursor ? decodeCursor(q.cursor) : undefined);
  });

  app.addHook("onClose", async () => {
    if (owns && connection.sql) await connection.sql.end({ timeout: 5 });
  });

  return app;
}

// ---------------------------------------------------------------------------------------
// Startup
//
// Deliberately a separate exported function rather than a `process.argv[1]` guard: a
// process manager runs this module inside its own fork wrapper, so argv[1] is the manager's
// file and any such guard silently evaluates false — the process then starts, binds
// nothing, and logs nothing. A dedicated entrypoint (src/main.ts) removes that class of
// failure entirely.
// ---------------------------------------------------------------------------------------

export async function startServer(): Promise<FastifyInstance> {
  const env = loadEnv();
  const app = await buildApp({ env });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ port: env.API_PORT, host: env.API_HOST });
    app.log.info(
      { port: env.API_PORT, host: env.API_HOST, network: env.GENLAYER_NETWORK },
      "api listening"
    );
    return app;
  } catch (err) {
    app.log.error({ err }, "failed to start");
    process.exit(1);
  }
}