# PromiseDecay — API

Base URL in production: `https://promisedecay.bydx.fun/api/v1`

The API is **read-only**. It exposes `GET` and `HEAD` only — there is no server-side write
path, because every write is signed by the user's own wallet.

## Health

### `GET /health/live`

Process liveness. Touches nothing else.

```json
{ "status": "ok", "uptime": 8123.4 }
```

### `GET /health/ready`

Readiness. Returns `503` when a dependency is unreachable, so an orchestrator will not route
traffic to a process that cannot serve it.

```json
{
  "status": "ready",
  "checks": { "database": "ok", "chain": "ok" }
}
```

### `GET /api/v1/config`

Deployment identity, for the UI to display.

```json
{
  "contractAddress": "0x5F1C5C97ec9040FC76394419De3159C401bBDc05",
  "network": "studionet",
  "chainId": 61999,
  "rpcUrl": "https://studio.genlayer.com/api"
}
```

## Promises

### `GET /api/v1/promises`

Cursor-paginated feed, newest first.

| Parameter | Type | Notes |
|---|---|---|
| `limit` | int | 1–50, defaults to 25 |
| `cursor` | string | Opaque cursor from a previous `nextCursor` |
| `lifecycle` | csv | `OPEN`, `DUE`, `RESOLVING`, `PROVISIONAL`, `CHALLENGE_WINDOW`, `FINAL` |
| `delivery` | csv | `KEPT`, `KEPT_LATE`, `PARTIAL`, `NOT_KEPT`, `UNRESOLVED` |
| `integrity` | csv | `UNCHANGED`, `NARROWED`, `REFRAMED`, `REVERSED`, `UNKNOWN` |
| `project` | string | Project slug |

```json
{
  "items": [ { "promiseId": "3", "project": "Acme Protocol", "...": "..." } ],
  "nextCursor": "eyJjIjoxODAwMDAwMDAwLCJwIjoiMyJ9",
  "limit": 25
}
```

`nextCursor` is `null` on the last page.

### `GET /api/v1/promises/:id`

`:id` must be a positive integer. Returns the full record: DNA, lifecycle, resolution,
evidence, drift, responses and challenges.

```json
{
  "promiseId": "3",
  "project": "Acme Protocol",
  "projectSlug": "acme-protocol",
  "actor": "Acme Foundation",
  "originalQuote": "Acme Protocol will launch its public mainnet network before September 30.",
  "action": "launch",
  "object": "public mainnet network",
  "scope": "public",
  "deadlineTs": 1791247190,
  "conditions": "subject to final audit",
  "sourceUrl": "https://en.wikipedia.org/wiki/Mainnet",
  "creator": "0x7EB56204F7FfDd8f376CE75726e0A26ef8c9f8DA",
  "createdTs": 1791074391,
  "contractVersion": "1.0.0",
  "lifecycle": "CHALLENGE_WINDOW",
  "delivery": "UNRESOLVED",
  "integrity": "UNKNOWN",
  "deadlineMet": false,
  "materialScopeChange": false,
  "explanation": "The only retrieved source is…",
  "decidedTs": 1791075174,
  "isFinal": false,
  "challengeCount": 0,
  "evidenceCount": 2,
  "driftCount": 2,
  "responseCount": 1,
  "challengeClosesAt": 1791679574,
  "indexedAt": "2026-10-04T01:20:11.000Z",
  "evidence": [],
  "drift": [],
  "responses": [],
  "challenges": []
}
```

## Projects

### `GET /api/v1/projects`

| Parameter | Type |
|---|---|
| `limit` | int, 1–50 |

Returns each project with counts. These are counts of the record, never a score.

### `GET /api/v1/projects/:slug`

Returns the project plus its full commitment history, newest first.

## Search

### `GET /api/v1/search`

| Parameter | Type | Notes |
|---|---|---|
| `q` | string | Required, 1–200 chars |
| `limit` | int | 1–50 |
| `cursor` | string | Opaque |

Full-text search over indexed promise text only. Untrusted evidence, drift and response text
is deliberately **not** indexed: a submitter must not be able to plant search results on
someone else's promise.

Input is reduced to letters and digits before it reaches `tsquery`, so no query operator can
be supplied by the caller.

## Errors

Stable and typed. Branch on `code`, not on prose.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Promise pd-99 was not found.",
    "requestId": "0f2a1c3e-..."
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 400 | A query parameter or path value is invalid. `details` lists each offending field |
| `BAD_CURSOR` | 400 | The pagination cursor is invalid or expired |
| `NOT_FOUND` | 404 | No such promise, project or route |
| `RATE_LIMITED` | 429 | Too many requests; the message says how long to wait |
| `INTERNAL` | 500 | Unexpected server-side failure. Internal detail is not exposed |

Every response carries an `x-request-id` header matching the body's `requestId`.

## Pagination

Keyset pagination over `(created_ts, promise_id)`, encoded as an opaque base64url cursor.

This is chosen over `OFFSET` deliberately: a feed that stays correct and cheap while new
promises arrive, and a cursor that never skips or repeats a row when the underlying data
changes between pages.

## Operational headers

| Header | Value |
|---|---|
| `x-request-id` | Echoed from the request or generated |
| CORS | Allowlisted origins only, `credentials: false`, `GET`/`HEAD` |
| Rate limit | Per IP, window and ceiling configurable |
| Body limit | 32 KB |