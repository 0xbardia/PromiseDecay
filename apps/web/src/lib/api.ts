/**
 * Typed API client.
 *
 * Read-only. Writes go directly from the browser to the chain with the user's wallet
 * signature; this module never asks the server to sign anything.
 */
import type { Delivery, Integrity, Lifecycle } from "@promisedecay/domain";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export interface ApiPromise {
  promiseId: string;
  project: string;
  projectSlug: string;
  actor: string;
  originalQuote: string;
  action: string;
  object: string;
  scope: string;
  deadlineTs: number;
  conditions: string;
  sourceUrl: string;
  creator: string;
  createdTs: number;
  contractVersion: string;
  lifecycle: Lifecycle | string;
  delivery: Delivery | null;
  integrity: Integrity | null;
  deadlineMet: boolean | null;
  materialScopeChange: boolean | null;
  explanation: string | null;
  decidedTs: number | null;
  isFinal: boolean;
  challengeCount: number;
  evidenceCount: number;
  driftCount: number;
  responseCount: number;
  challengeClosesAt: number | null;
  indexedAt: string;
}

export interface ApiEvidence {
  submitter: string;
  sourceUrl: string;
  quote: string;
  kind: string;
  submittedTs: number;
}

export interface ApiDrift {
  submitter: string;
  statement: string;
  sourceUrl: string;
  submittedTs: number;
  relationship: string;
}

export interface ApiResponseItem {
  submitter: string;
  statement: string;
  sourceUrl: string;
  submittedTs: number;
  verified: boolean;
}

export interface ApiChallenge {
  challenger: string;
  reason: string;
  evidenceUrl: string;
  submittedTs: number;
}

export interface ApiPromiseDetail extends ApiPromise {
  evidence: ApiEvidence[];
  drift: ApiDrift[];
  responses: ApiResponseItem[];
  challenges: ApiChallenge[];
}

export interface ApiProject {
  slug: string;
  name: string;
  actor: string;
  promiseCount: number;
  finalCount: number;
  resolvedCount: number;
  openCount: number;
  latestPromiseTs: number | null;
}

export interface ApiProjectDetail extends ApiProject {
  promises: ApiPromise[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

/** An error the UI can present without guessing what went wrong. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    if (requestId) this.requestId = requestId;
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    // A network failure must read as a network failure, not as "no results".
    throw new ApiClientError(0, "NETWORK", "Could not reach the PromiseDecay API.");
  }

  if (!res.ok) {
    let code = "UNKNOWN";
    let message = `Request failed (${res.status}).`;
    let requestId: string | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; message?: string; requestId?: string };
      };
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        requestId = body.error.requestId;
      }
    } catch {
      // Keep the generic message when the body is not JSON.
    }
    throw new ApiClientError(res.status, code, message, requestId);
  }

  return (await res.json()) as T;
}

export interface ListParams {
  limit?: number;
  cursor?: string;
  lifecycle?: string;
  delivery?: string;
  integrity?: string;
  project?: string;
  q?: string;
}

function qs(params: ListParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  listPromises: (params: ListParams = {}, signal?: AbortSignal) =>
    request<Page<ApiPromise>>(`/promises${qs(params)}`, signal),

  getPromise: (id: string, signal?: AbortSignal) =>
    request<ApiPromiseDetail>(`/promises/${encodeURIComponent(id)}`, signal),

  listProjects: (params: { limit?: number } = {}, signal?: AbortSignal) =>
    request<Page<ApiProject>>(`/projects${qs(params)}`, signal),

  getProject: (slug: string, signal?: AbortSignal) =>
    request<ApiProjectDetail>(`/projects/${encodeURIComponent(slug)}`, signal),

  search: (params: ListParams & { q: string }, signal?: AbortSignal) =>
    request<Page<ApiPromise>>(`/search${qs(params)}`, signal),

  config: (signal?: AbortSignal) =>
    request<{
      contractAddress: string | null;
      network: string;
      chainId: number;
      rpcUrl: string;
    }>("/config", signal),
};

export { BASE as API_BASE };