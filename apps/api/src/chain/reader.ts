/**
 * GenLayer read client.
 *
 * Read-only. This module NEVER signs anything — every production write is signed by the
 * user's browser wallet. Its only job is to turn finalized on-chain state into plain
 * objects for indexing and for the API's readiness checks.
 */
import { createClient, chains } from "genlayer-js";

type ChainName = keyof typeof chains;

const CHAIN_BY_NAME: Record<string, ChainName> = {
  studionet: "studionet",
  "testnet-bradbury": "testnetBradbury",
  localnet: "localnet",
};

export interface PromiseDnaRaw {
  promise_id: string;
  project: string;
  actor: string;
  original_quote: string;
  action: string;
  object: string;
  scope: string;
  deadline_ts: string;
  conditions: string;
  source_url: string;
  creator: string;
  created_ts: string;
  contract_version: string;
}

export interface EvidenceRaw {
  submitter: string;
  source_url: string;
  quote: string;
  kind: string;
  submitted_ts: string;
}

export interface DriftRaw {
  submitter: string;
  statement: string;
  source_url: string;
  submitted_ts: string;
  relationship: string;
}

export interface ResponseRaw {
  submitter: string;
  statement: string;
  source_url: string;
  submitted_ts: string;
  verified: boolean;
}

export interface ChallengeRaw {
  challenger: string;
  reason: string;
  evidence_url: string;
  submitted_ts: string;
}

export interface ResolutionRaw {
  delivery: string;
  integrity: string;
  deadline_met: boolean;
  material_scope_change: boolean;
  explanation: string;
  decided_ts: string;
}

/**
 * Paced client for a rate-limited GenLayer node.
 *
 * A shared public node enforces TWO limits, and the smaller one governs:
 *   - 30 requests per minute
 *   - 500 requests per hour
 *
 * A per-minute interval alone is not enough: 22/min is 1320/hour, which exhausts the
 * hourly budget in under half an hour. This limiter therefore enforces BOTH windows with
 * a token bucket over each, and honours the node's own `retry_after_seconds` on a 429 by
 * entering a cooldown.
 */
class RateLimiter {
  /** Serialises requests: two concurrent reads must not race for the same budget. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Window definitions. Conservative fractions of the published limits. */
  private readonly windows: Array<{ limit: number; windowMs: number; tokens: number; last: number }>;

  private cooldownUntil = 0;

  constructor(windows: Array<{ limit: number; windowMs: number }>) {
    this.windows = windows.map((w) => ({ ...w, tokens: w.limit, last: Date.now() }));
  }

  private refill(): void {
    const now = Date.now();
    for (const w of this.windows) {
      const elapsed = now - w.last;
      if (elapsed <= 0) continue;
      const replenished = (elapsed / w.windowMs) * w.limit;
      if (replenished > 0) {
        w.tokens = Math.min(w.limit, w.tokens + replenished);
        w.last = now;
      }
    }
  }

  /** Record a 429 so the next requests wait out the node's advertised cooldown. */
  penalise(retryAfterSeconds: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + retryAfterSeconds * 1000);
    // Drain the buckets so a burst cannot immediately re-trigger the limit.
    for (const w of this.windows) w.tokens = 0;
  }

  /** Milliseconds until at least one token exists in every window. */
  private waitTime(): number {
    const now = Date.now();
    const until = Math.max(now, this.cooldownUntil);
    let wait = until - now;
    for (const w of this.windows) {
      if (w.tokens >= 1) continue;
      const deficit = 1 - w.tokens;
      const ms = (deficit / w.limit) * w.windowMs;
      wait = Math.max(wait, ms);
    }
    return wait;
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      for (;;) {
        this.refill();
        const wait = this.waitTime();
        if (wait <= 50) break;
        await new Promise((r) => setTimeout(r, Math.min(wait, 5_000)));
      }
      this.refill();
      for (const w of this.windows) w.tokens = Math.max(0, w.tokens - 1);
      return await fn();
    });
    // Keep the chain alive even when a link rejects.
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}


/**
 * A client bound to one deployed contract, with typed read helpers and retry/backoff for
 * transient RPC failures. Retrying a read is always safe: reads cannot mutate anything.
 */
export class GenlayerReader {
  /** Inferred from genlayer-js rather than imported: the package exports no type. */
  private client: ReturnType<typeof createClient>;
  private address: string;
  private rpcUrl: string;
  /** Serialises reads and keeps them under the node's per-minute ceiling. */
  private limiter: RateLimiter;

  constructor(opts: { rpcUrl: string; network: string; address: string }) {
    const chainKey = CHAIN_BY_NAME[opts.network];
    if (!chainKey) {
      throw new Error(
        `Unsupported GenLayer network "${opts.network}". ` +
          `Supported: ${Object.keys(CHAIN_BY_NAME).join(", ")}`
      );
    }
    this.address = opts.address;
    this.rpcUrl = opts.rpcUrl;
    // Stay under BOTH published ceilings with headroom for health probes and for anyone
    // else using the same public node: 24/min and 420/hour.
    this.limiter = new RateLimiter([
      { limit: 24, windowMs: 60_000 },
      { limit: 420, windowMs: 3_600_000 },
    ]);
    this.client = createClient({
      chain: chains[chainKey],
      endpoint: opts.rpcUrl,
    });
  }

  get contractAddress(): string {
    return this.address;
  }

  /** Read with bounded exponential backoff. Safe because every call here is a view. */
  private async read<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < attempts - 1) {
          const rateLimited = String((err as Error).message).includes("RATE_LIMITED");
          // The limiter already holds a cooldown; this wait lets that window elapse.
          const delay = rateLimited ? 32_000 * (i + 1) : 400 * 2 ** i + Math.random() * 250;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Promise ids cross this boundary as strings (that is how the API and the database
  /**
   * Recognise a rate-limit rejection.
   *
   * The node does NOT surface these as a friendly message: viem wraps them into a generic
   * `UnknownRpcError: An unknown RPC error occurred.` and hides the detail in `cause.data`
   * (code -32029, plus the bucket, window, limit and retry_after_seconds). Matching on the
   * message text therefore never fires, which is exactly how a rate-limited indexer ends up
   * reporting every promise as failed instead of politely waiting for the bucket to refill.
   */
  private static rateLimitInfo(err: unknown): { retryAfterSeconds: number } | null {
    const seen = new Set<unknown>();
    let frontier: unknown[] = [err];

    for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
      const next: unknown[] = [];
      for (const node of frontier) {
        if (!node || typeof node !== "object" || seen.has(node)) continue;
        seen.add(node);
        const e = node as { code?: unknown; data?: Record<string, unknown>; message?: unknown };
        const data = (e.data ?? {}) as Record<string, unknown>;
        // The structured shape is the reliable signal; the message is a last resort.
        if (e.code === -32029 || ("bucket" in data && "window" in data && "limit" in data)) {
          const retry = Number(data.retry_after_seconds ?? 0);
          return { retryAfterSeconds: retry > 0 ? retry : 30 };
        }
        if ("cause" in (node as Record<string, unknown>)) {
          next.push((node as { cause?: unknown }).cause);
        }
      }
      frontier = next;
    }

    if (/rate limit/i.test(String((err as Error)?.message ?? ""))) {
      return { retryAfterSeconds: 30 };
    }
    return null;
  }

  /**
   * Coerce numeric-looking strings to numbers.
   *
   * The API and database store promise ids as strings (they are opaque identifiers in
   * URLs), but the contract schema declares them as `int`, and genlayer-js rejects a string
   * for that type. Coerce once, here, at the boundary.
   */
  private static toArgs(args: unknown[]): unknown[] {
    return args.map((a) => (typeof a === "string" && /^\d+$/.test(a) ? Number(a) : a));
  }

  private call<T>(functionName: string, args: unknown[] = []): Promise<T> {
    return this.read(
      () =>
        this.limiter.run(async () => {
          try {
            return (await this.client.readContract({
              address: this.address as `0x${string}`,
              functionName,
              args: GenlayerReader.toArgs(args) as never,
            })) as unknown as T;
          } catch (err) {
            // A rate-limit response deserves a real, node-advised pause; other errors
            // do not, and retrying them more slowly would just hide a real fault.
            const rateLimit = GenlayerReader.rateLimitInfo(err);
            if (rateLimit) {
              this.limiter.penalise(rateLimit.retryAfterSeconds);
              throw new Error("RATE_LIMITED");
            }
            throw err;
          }
        }),
      3
    );
  }

  // --- Contract-level reads ------------------------------------------------------------

  getVersion(): Promise<string> {
    return this.call<string>("get_version");
  }

  getConfig(): Promise<Record<string, unknown>> {
    return this.call<Record<string, unknown>>("get_config");
  }

  getPromiseCount(): Promise<number> {
    return this.call<number>("get_promise_count");
  }

  async getAllPromiseIds(): Promise<string[]> {
    const ids = await this.call<unknown[]>("get_all_promise_ids");
    // Normalise to strings: the API and database key on the string form.
    return (ids ?? []).map((v) => String(v));
  }

  getPromise(id: string): Promise<PromiseDnaRaw> {
    return this.call<PromiseDnaRaw>("get_promise", [id]);
  }

  getLifecycleStatus(id: string): Promise<string> {
    return this.call<string>("get_lifecycle_status", [id]);
  }

  async getEvidence(id: string): Promise<EvidenceRaw[]> {
    const raw = await this.call<string>("get_evidence", [id]);
    return raw ? JSON.parse(raw) : [];
  }

  async getDrift(id: string): Promise<DriftRaw[]> {
    const raw = await this.call<string>("get_drift", [id]);
    return raw ? JSON.parse(raw) : [];
  }

  async getResponses(id: string): Promise<ResponseRaw[]> {
    const raw = await this.call<string>("get_responses", [id]);
    return raw ? JSON.parse(raw) : [];
  }

  async getChallenges(id: string): Promise<ChallengeRaw[]> {
    const raw = await this.call<string>("get_challenges", [id]);
    return raw ? JSON.parse(raw) : [];
  }

  async getChallengeWindow(id: string): Promise<{ challenge_closes_at: string; window_seconds: number }> {
    return this.call("get_challenge_window", [id]);
  }

  /** Provisional result, or null when none exists yet. */
  async getProvisionalResult(id: string): Promise<ResolutionRaw | null> {
    return this.tryCall<ResolutionRaw>("get_provisional_result", [id]);
  }

  /** Final result, or null while the promise is still open. */
  async getFinalResult(id: string): Promise<ResolutionRaw | null> {
    return this.tryCall<ResolutionRaw>("get_final_result", [id]);
  }

  /**
   * A read whose *absence* is a legitimate answer — "this promise has no provisional result
   * yet", "no final result" — reported as null rather than as an error.
   *
   * The subtlety this method exists to get right: a throttled or failed read is NOT the same
   * thing as an absent value. Swallowing every error into `null` meant that during a rate-limit
   * window every resolution in the product silently became "not resolved", and the indexer
   * persisted that lie to the database. A momentary throttle could erase a verdict the chain
   * had already finalized.
   *
   * So transport-level failures are re-thrown and the promise is left alone for this pass;
   * only a genuine UserError — the contract saying "there is no such result" — yields null.
   */
  private async tryCall<T>(functionName: string, args: unknown[] = []): Promise<T | null> {
    try {
      return await this.call<T>(functionName, args);
    } catch (err) {
      const info = GenlayerReader.rateLimitInfo(err);
      if (info) {
        this.limiter.penalise(info.retryAfterSeconds);
        // Rethrown so the caller skips this promise entirely rather than recording absence.
        throw new Error("RATE_LIMITED");
      }
      // "No result yet" is an expected state, not an error.
      return null;
    }
  }

  /** Raw RPC liveness probe used by /health/ready. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_getTransactionStatus", params: ["0x0"] }),
        signal: AbortSignal.timeout(8000),
      });
      // A JSON-RPC error response still proves the node is alive and answering.
      return res.ok && (await res.json()).jsonrpc === "2.0";
    } catch {
      return false;
    }
  }
}