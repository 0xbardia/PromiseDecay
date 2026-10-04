/**
 * PromiseDecay domain vocabulary.
 *
 * These values are the single source of truth for the TypeScript side and are kept
 * byte-identical to the enums in contracts/PromiseDecay.py. `tests/api/schema.test.ts`
 * and `scripts/verify-contract-sync.mjs` assert the two never drift apart.
 *
 * There is deliberately NO trust score here. Delivery and integrity are separate axes.
 */

// ---------------------------------------------------------------------------------------
// Delivery — "was the commitment delivered?"
// ---------------------------------------------------------------------------------------

export const DELIVERY = {
  KEPT: "KEPT",
  KEPT_LATE: "KEPT_LATE",
  PARTIAL: "PARTIAL",
  NOT_KEPT: "NOT_KEPT",
  UNRESOLVED: "UNRESOLVED",
} as const;

export type Delivery = (typeof DELIVERY)[keyof typeof DELIVERY];

export const DELIVERY_VALUES: readonly Delivery[] = [
  DELIVERY.KEPT,
  DELIVERY.KEPT_LATE,
  DELIVERY.PARTIAL,
  DELIVERY.NOT_KEPT,
  DELIVERY.UNRESOLVED,
];

// ---------------------------------------------------------------------------------------
// Integrity — "was the promise's meaning preserved?"
// ---------------------------------------------------------------------------------------

export const INTEGRITY = {
  UNCHANGED: "UNCHANGED",
  NARROWED: "NARROWED",
  REFRAMED: "REFRAMED",
  REVERSED: "REVERSED",
  UNKNOWN: "UNKNOWN",
} as const;

export type Integrity = (typeof INTEGRITY)[keyof typeof INTEGRITY];

export const INTEGRITY_VALUES: readonly Integrity[] = [
  INTEGRITY.UNCHANGED,
  INTEGRITY.NARROWED,
  INTEGRITY.REFRAMED,
  INTEGRITY.REVERSED,
  INTEGRITY.UNKNOWN,
];

// ---------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------

export const LIFECYCLE = {
  OPEN: "OPEN",
  DUE: "DUE",
  RESOLVING: "RESOLVING",
  PROVISIONAL: "PROVISIONAL",
  CHALLENGE_WINDOW: "CHALLENGE_WINDOW",
  FINAL: "FINAL",
} as const;

export type Lifecycle = (typeof LIFECYCLE)[keyof typeof LIFECYCLE];

export const LIFECYCLE_VALUES: readonly Lifecycle[] = [
  LIFECYCLE.OPEN,
  LIFECYCLE.DUE,
  LIFECYCLE.RESOLVING,
  LIFECYCLE.PROVISIONAL,
  LIFECYCLE.CHALLENGE_WINDOW,
  LIFECYCLE.FINAL,
];

// ---------------------------------------------------------------------------------------
// Promise Drift relationship
// ---------------------------------------------------------------------------------------

export const RELATION = {
  SOFTENED: "SOFTENED",
  NARROWED: "NARROWED",
  REFRAMED: "REFRAMED",
  REVERSED: "REVERSED",
  FULFILLED_EARLY: "FULFILLED_EARLY",
  UNRELATED: "UNRELATED",
} as const;

export type Relation = (typeof RELATION)[keyof typeof RELATION];

export const RELATION_VALUES: readonly Relation[] = [
  RELATION.SOFTENED,
  RELATION.NARROWED,
  RELATION.REFRAMED,
  RELATION.REVERSED,
  RELATION.FULFILLED_EARLY,
  RELATION.UNRELATED,
];

// ---------------------------------------------------------------------------------------
// Evidence kinds
// ---------------------------------------------------------------------------------------

export const EVIDENCE_KIND = {
  SOURCE: "SOURCE",
  ARTIFACT: "ARTIFACT",
  STATEMENT: "STATEMENT",
  ABSENCE: "ABSENCE",
} as const;

export type EvidenceKind = (typeof EVIDENCE_KIND)[keyof typeof EVIDENCE_KIND];

export const EVIDENCE_KIND_VALUES: readonly EvidenceKind[] = [
  EVIDENCE_KIND.SOURCE,
  EVIDENCE_KIND.ARTIFACT,
  EVIDENCE_KIND.STATEMENT,
  EVIDENCE_KIND.ABSENCE,
];

// ---------------------------------------------------------------------------------------
// Records (mirror the contract's stored shapes)
// ---------------------------------------------------------------------------------------

export interface PromiseDna {
  promiseId: string;
  project: string;
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
}

export interface EvidenceItem {
  submitter: string;
  sourceUrl: string;
  quote: string;
  kind: EvidenceKind;
  submittedTs: number;
}

export interface DriftItem {
  submitter: string;
  statement: string;
  sourceUrl: string;
  submittedTs: number;
  relationship: Relation;
}

export interface ResponseItem {
  submitter: string;
  statement: string;
  sourceUrl: string;
  submittedTs: number;
  /** Always false in V1: ownership is unverified, so the UI must not claim otherwise. */
  verified: boolean;
}

export interface ChallengeItem {
  challenger: string;
  reason: string;
  evidenceUrl: string;
  submittedTs: number;
}

export interface ResolutionResult {
  delivery: Delivery;
  integrity: Integrity;
  deadlineMet: boolean;
  materialScopeChange: boolean;
  explanation: string;
  decidedTs: number;
}

// ---------------------------------------------------------------------------------------
// Bounds — mirrored from the contract so the UI can validate before signing.
// ---------------------------------------------------------------------------------------

export const BOUNDS = {
  MAX_QUOTE: 1200,
  MAX_SHORT: 200,
  MAX_URL: 500,
  MAX_EXPLANATION: 600,
  MAX_EVIDENCE: 64,
  MAX_DRIFT: 64,
  MAX_RESPONSES: 32,
  MAX_CHALLENGES: 16,
  CHALLENGE_WINDOW_SECONDS: 7 * 24 * 60 * 60,
  CONTRACT_VERSION: "1.0.0",
} as const;

// ---------------------------------------------------------------------------------------
// URL admissibility — mirrors contracts/PromiseDecay.py::_check_url so a user gets an
// immediate, specific message instead of a failed transaction.
// ---------------------------------------------------------------------------------------

export type UrlRejection =
  | "empty"
  | "too-long"
  | "scheme"
  | "credentials"
  | "no-host"
  | "invalid-port"
  | "port-range"
  | "unusual-port"
  | "localhost"
  | "ip-literal";

const ALLOWED_PORTS = new Set([80, 443, 8080, 8443, 3000, 5000, 8000]);

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * True when host is an IPv4 literal.
 *
 * Leading zeros are deliberately NOT disqualifying: 010.0.0.1 is still an address, and a
 * resolver that reads it as octal would route somewhere the screen never inspected. It
 * must be rejected, not waved through as a hostname.
 */
function isIpv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export function checkSourceUrl(raw: string): { ok: true } | { ok: false; reason: UrlRejection } {
  const url = (raw ?? "").trim();
  if (url.length === 0) return { ok: false, reason: "empty" };
  if (url.length > BOUNDS.MAX_URL) return { ok: false, reason: "too-long" };

  const lower = url.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
    return { ok: false, reason: "scheme" };
  }

  // Authority is everything up to the first "/", "?" or "#".
  let authority = url.slice(url.indexOf("://") + 3);
  for (const sep of ["/", "?", "#"]) {
    const at = authority.indexOf(sep);
    if (at !== -1) authority = authority.slice(0, at);
  }

  if (authority.includes("@")) return { ok: false, reason: "credentials" };
  if (authority.length === 0) return { ok: false, reason: "no-host" };

  let host: string;
  let portPart = "";
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close === -1) return { ok: false, reason: "no-host" };
    host = authority.slice(1, close);
    const rest = authority.slice(close + 1);
    if (rest.startsWith(":")) portPart = rest.slice(1);
    else if (rest.length > 0) return { ok: false, reason: "no-host" };
  } else {
    const pieces = authority.split(":");
    host = pieces[0] ?? "";
    portPart = pieces.slice(1).join(":");
  }

  if (host.length === 0) return { ok: false, reason: "no-host" };
  host = host.toLowerCase();

  if (portPart.length > 0) {
    if (!/^\d+$/.test(portPart)) return { ok: false, reason: "invalid-port" };
    const port = Number(portPart);
    if (port < 1 || port > 65535) return { ok: false, reason: "port-range" };
    if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: "unusual-port" };
  }

  if (BLOCKED_HOSTS.has(host) || host.endsWith(".localhost")) {
    return { ok: false, reason: "localhost" };
  }
  if (host.includes(":")) return { ok: false, reason: "ip-literal" }; // IPv6 literal
  if (isIpv4Literal(host)) return { ok: false, reason: "ip-literal" };

  return { ok: true };
}

export const URL_REJECTION_MESSAGE: Record<UrlRejection, string> = {
  empty: "Enter a source URL.",
  "too-long": `Source URL must be under ${BOUNDS.MAX_URL} characters.`,
  scheme: "Source URL must start with http:// or https://",
  credentials: "Source URL must not contain a username or password.",
  "no-host": "Source URL is missing a host name.",
  "invalid-port": "Source URL has an invalid port.",
  "port-range": "Source URL port is out of range.",
  "unusual-port": "Source URL uses an unusual port. Use a standard web port.",
  localhost: "Source URL must not point at localhost.",
  "ip-literal": "Source URL must use a domain name, not a raw IP address.",
};

// ---------------------------------------------------------------------------------------
// Slugs — projects get a stable URL segment derived from their name.
// ---------------------------------------------------------------------------------------

export function slugifyProject(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "unknown";
}

// ---------------------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------------------

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address ?? "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function promiseRef(promiseId: string | number): string {
  return `pd-${String(promiseId)}`;
}

/**
 * A response is never an "official project response" in V1 — ownership is unverified.
 * Returning the label from one place prevents the UI from inventing authority.
 */
export function responseLabel(submitter: string, verified: boolean): string {
  return verified
    ? `Verified response from ${shortAddress(submitter)}`
    : `Response from ${shortAddress(submitter)}`;
}

export function isDelivery(value: string): value is Delivery {
  return (DELIVERY_VALUES as readonly string[]).includes(value);
}

export function isIntegrity(value: string): value is Integrity {
  return (INTEGRITY_VALUES as readonly string[]).includes(value);
}

export function isLifecycle(value: string): value is Lifecycle {
  return (LIFECYCLE_VALUES as readonly string[]).includes(value);
}