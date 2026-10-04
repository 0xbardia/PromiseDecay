# PromiseDecay — Architecture

## The one rule

**The GenLayer Intelligent Contract is the only authority.**

`apps/api` and PostgreSQL are a derived, rebuildable projection. The API decides nothing:
drop every table, re-run the indexer, and you get identical derived state without a single
user-facing write.

```
Browser wallet ──signs──▶ GenLayer network (Studionet, chain 61999)
                              │  authoritative state
                              ▼
                    Indexer  (apps/indexer → apps/api/src/indexer)
                              │  idempotent, restart-safe
                              ▼
                    PostgreSQL  (search / filter / cache projection)
                              │
                              ▼
                    Fastify API  (apps/api, read-only, public)
                              │
                              ▼
                    React web  (apps/web, SSR-capable, wallet-signed writes)
```

## Repository layout

```
contracts/PromiseDecay.py      the authoritative Intelligent Contract
packages/domain/               enums, URL screening, slugs, labels — mirrors the contract
packages/config/               environment parsing/validation shared by api + indexer
apps/api/
  src/chain/reader.ts          read-only GenLayer client, rate-limited
  src/db/                      schema, migrations, pool
  src/repo/promises.ts         all SQL lives here
  src/indexer/sync.ts          the projection logic
  src/server.ts                Fastify app
apps/indexer/src/worker.ts     long-running PM2 worker (reuses api modules)
apps/web/                      React + Vite client
docs/                          this documentation
tests/contract/                Direct Mode (genlayer-test)
scripts/                       deploy, certify, lifecycle
```

## Key decisions and their reasons

| Decision | Why |
|---|---|
| pnpm workspaces | One toolchain, shared domain types, no publish step |
| Drizzle + raw SQL migrations | Small, strongly typed, reviewable SQL; no generated-diff drift |
| postgres.js (not an ORM client) | Direct, explicit SQL; connection pooling built in |
| Keyset pagination | A feed that stays correct and cheap while new promises arrive |
| Hand-rolled router | Fixed route table, no nested loaders; a dependency would add weight without capability |
| Lazy-load genlayer-js in the browser | Cut the main bundle from 449kB to 234kB; the SDK is only needed when someone signs |
| Rate-limited chain reads | Studionet allows 30 gen_* requests/minute per client |

## What we deliberately did not build

No Redis. No Kafka. No GraphQL. No microservices. No vector database. No auth service.
No admin panel. No notification worker. No webhooks. No separate search engine.

PostgreSQL full-text search covers V1. Any of the above should return only when a
**measured** requirement demands it.

## Indexer design

The indexer must be safe to run at any time, including after a crash.

- **Full reconciliation each pass.** Every pass reads the complete promise list. This is the
  only way a restart is guaranteed to self-heal, and the list is small enough that a full
  pass is cheap.
- **Idempotent by construction.** Upsert on `(promise_id)`; child collections are replaced
  wholesale with stable ordinals under a unique `(promise_id, ordinal)` key. Re-running
  cannot duplicate a row.
- **Fault tolerant.** One failing promise is logged and skipped; the pass continues.
- **Paced.** Reads are serialised through a 22/min queue — under the node's 30/min ceiling —
  and a rate-limit response is retried after a real pause rather than with jitter.
- **Checkpointed.** Each pass records `last_sync_at` in `indexer_state`.
- **Graceful shutdown.** SIGTERM lets an in-flight pass finish so the checkpoint is not lost.

## API design

Read-only by construction: there is no POST, PUT, PATCH or DELETE anywhere.

- Zod-validated query parameters; validation failures name the offending parameter.
- Stable typed errors: `{ error: { code, message, details?, requestId } }`.
- Request IDs on every response; `authorization` and `cookie` headers redacted from logs.
- 32 KB body limit, per-IP rate limiting with a typed `RATE_LIMITED` response.
- CORS restricted to an allowlist, `credentials: false`, `GET`/`HEAD` only.
- `/health/live` (process) and `/health/ready` (database + chain both reachable).
- Keyset pagination over `(created_ts, promise_id)` with an opaque base64url cursor.

## Frontend design

See `docs/PRODUCT.md` for the product and `apps/web/src/styles/` for the Living Glass
system. The architectural notes that matter:

- **No server signing.** Writes go through the user's injected EIP-1193 provider via
  genlayer-js. The server holds no key for user actions.
- **Untrusted text is escaped.** All promise, drift, evidence and response text renders as
  React children. There is no `dangerouslySetInnerHTML` in the repository.
- **Wallet SDK deliberately absent.** An injected provider is used directly. WalletConnect
  is not enabled with a placeholder project id; see `docs/DEPLOYMENT.md` for how to add one.
- **Real transaction states.** waiting-for-wallet → submitted → consensus → accepted →
  final, or failed. Nothing is marked final until the chain says `FINALIZED`.

## Operational shape

```
promisedecay-web      127.0.0.1:4180   PM2, serves dist/ with security headers
promisedecay-api      127.0.0.1:4182   PM2, Fastify
promisedecay-indexer  no listener      PM2 worker
nginx                 :443             TLS, proxies /api to the API
```

Internal services bind to loopback. Only nginx is public.