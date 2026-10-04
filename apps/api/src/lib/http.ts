/**
 * Shared API utilities: typed errors, cursor pagination and text search normalisation.
 */
import { z } from "zod";

/**
 * Stable, typed error codes.
 *
 * The client can branch on `code` without parsing prose, and the prose is written for a
 * human who needs to know what to do next.
 */
export const ErrorCode = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  BAD_CURSOR: "BAD_CURSOR",
  RATE_LIMITED: "RATE_LIMITED",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ApiError extends Error {
  readonly code: ErrorCodeValue;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCodeValue, statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }

  static notFound(what: string): ApiError {
    return new ApiError(ErrorCode.NOT_FOUND, 404, `${what} was not found.`);
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(ErrorCode.VALIDATION_FAILED, 400, message, details);
  }

  static badCursor(message = "The pagination cursor is invalid or expired."): ApiError {
    return new ApiError(ErrorCode.BAD_CURSOR, 400, message);
  }
}

// ---------------------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------------------

export interface Cursor {
  createdTs: number;
  promiseId: string;
}

const cursorSchema = z.object({
  c: z.number().int(),
  p: z.string().min(1).max(64),
});

/**
 * Opaque cursor over the `(created_ts, promise_id)` feed key.
 *
 * Keyset pagination rather than OFFSET: the feed stays correct and cheap while new
 * promises arrive, and a cursor never skips or repeats a row.
 */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ c: c.createdTs, p: c.promiseId }), "utf8").toString(
    "base64url"
  );
}

export function decodeCursor(raw: string): Cursor {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw ApiError.badCursor();
  }
  const result = cursorSchema.safeParse(parsedJson);
  if (!result.success) throw ApiError.badCursor();
  return { createdTs: result.data.c, promiseId: result.data.p };
}

export const limitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .optional();

/**
 * Clamp a requested page size.
 *
 * @param requested value from the query string (may be absent)
 * @param max hard ceiling for this endpoint
 */
export function resolveLimit(
  requested: number | undefined,
  max: number,
  fallback: number
): number {
  if (requested === undefined) return Math.min(fallback, max);
  return Math.max(1, Math.min(requested, max));
}

// ---------------------------------------------------------------------------------------
// Search text
// ---------------------------------------------------------------------------------------

/**
 * Build the text fed into the full-text index.
 *
 * Only fields a user would actually search on are included. Untrusted evidence quotes are
 * deliberately NOT indexed: they are hostile-by-nature input and indexing them would let
 * a submitter plant search results.
 */
export function buildSearchText(input: {
  project: string;
  actor: string;
  originalQuote: string;
  action: string;
  object: string;
  scope: string;
}): string {
  return [input.project, input.actor, input.originalQuote, input.action, input.object, input.scope]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert a user query into a safe `tsquery` fragment.
 *
 * Only letters and digits survive, so no tsquery operator (`&`, `|`, `!`, `(`, `)`, `:`,
 * quotes) can ever be supplied by the caller. An empty or fully-punctuation query yields
 * an empty string, which callers must treat as "no results" rather than running a query.
 */
export function toPlainTsQuery(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `${t}:*`)
    .join(" & ");
}