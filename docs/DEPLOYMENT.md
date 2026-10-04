# PromiseDecay — Deployment

## Production

| Setting | Value |
|---|---|
| URL | `https://promisedecay.bydx.fun` |
| Network | GenLayer Studionet |
| Chain ID | `61999` |
| RPC | `https://studio.genlayer.com/api` |
| Contract | `0x5F1C5C97ec9040FC76394419De3159C401bBDc05` |
| Explorer | `https://explorer-studio.genlayer.com` |

The contract address is the one this documentation is written against. If the contract is
redeployed, this file, `README.md` and the GitHub release must be updated together. An
address is never reported for an obsolete deployment.

## Process layout

```
promisedecay-web      127.0.0.1:4180   PM2
promisedecay-api      127.0.0.1:4182   PM2
promisedecay-indexer  no listener      PM2 worker
nginx                 :443             TLS terminator
```

Internal services bind to loopback. Only nginx is public.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `WEB_ORIGIN` | no | `http://localhost:4180` | Comma-separated CORS allowlist |
| `API_PORT` | no | `4182` | API listen port |
| `API_HOST` | no | `127.0.0.1` | API bind address |
| `DATABASE_URL` | **yes** | — | `postgres://…` connection string |
| `DATABASE_POOL_MAX` | no | `10` | Pool ceiling per process |
| `GENLAYER_RPC_URL` | **yes** | — | GenLayer RPC endpoint |
| `GENLAYER_CHAIN_ID` | **yes** | — | Numeric chain id |
| `GENLAYER_NETWORK` | **yes** | — | `studionet` \| `testnet-bradbury` \| `localnet` |
| `GENLAYER_CONTRACT_ADDRESS` | yes for indexer | — | 20-byte hex address |
| `GENLAYER_EXPLORER_API` | no | Studio explorer | Used by deployment tooling |
| `INDEXER_INTERVAL_MS` | no | `15000` | Pass interval |
| `LOG_LEVEL` | no | `info` | Pino level |
| `RATE_LIMIT_WINDOW_MS` | no | `60000` | Rate limit window |
| `RATE_LIMIT_MAX` | no | `300` | Requests per window per IP |
| `DEFAULT_PAGE_SIZE` | no | `25` | Feed page size |
| `MAX_PAGE_SIZE` | no | `50` | Hard page-size ceiling |

Frontend public equivalents: `VITE_API_URL`, `VITE_GENLAYER_RPC_URL`,
`VITE_GENLAYER_CHAIN_ID`, `VITE_GENLAYER_CONTRACT_ADDRESS`, `VITE_GENLAYER_NETWORK`,
`VITE_WEB_ORIGIN`.

Mandatory configuration is validated at boot. A missing key fails loudly and names itself,
rather than producing a half-working service:

```
Error: Invalid environment configuration:
  - DATABASE_URL: DATABASE_URL is required
  - GENLAYER_RPC_URL: GENLAYER_RPC_URL must be a valid URL
```

`.env` is created locally with mode `600` and is gitignored. It is never committed.

## Deploying the contract

```bash
# Reads the deployer key from a 600-mode file outside the repository.
node scripts/deploy.mjs deploy contracts/PromiseDecay.py
```

The script prints the deployment transaction hash, polls to a terminal status, resolves the
contract address from the Studio explorer (the node's receipt method is not exposed by every
Studio node), then **verifies** the address by fetching its schema and confirming it exposes
methods. An unverified address is never reported.

## Running locally

```bash
pnpm install
cp .env.example .env            # then fill it in

pnpm --filter @promisedecay/api db:migrate
pnpm --filter @promisedecay/api dev        # API on :4182
pnpm --filter @promisedecay/web dev        # web on :4180, proxies /api
pnpm --filter @promisedecay/indexer dev    # indexer worker
```

The contract tests need a Python 3.12+ virtualenv:

```bash
uv venv --python 3.12 .venv
VIRTUAL_ENV=.venv uv pip install "genlayer-test==0.29.2" pytest
pnpm contract:test
```

## Production deployment

```bash
pnpm install --frozen-lockfile
pnpm --filter @promisedecay/web build      # -> apps/web/dist
pnpm --filter @promisedecay/api db:migrate
```

Then, as the `promisedecay` PM2 processes:

```bash
pm2 start apps/web/server/index.mjs --name promisedecay-web
pm2 start apps/api/dist/server.js    --name promisedecay-api
pm2 start apps/indexer/dist/worker.js --name promisedecay-indexer
pm2 save
```

nginx proxies `/` to `127.0.0.1:4180` and `/api` to `127.0.0.1:4182`, with:

- HTTP → HTTPS redirect
- TLS from Let's Encrypt
- `gzip` on (and `brotli` where the module is installed)
- `Cache-Control: public, max-age=31536000, immutable` for hashed assets under `/assets/`
- `Cache-Control: no-store` for API responses
- Always `nginx -t` before reloading, and never edit an unrelated vhost

## Security headers

Served by the web process:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self' https://studio.genlayer.com https://explorer-studio.genlayer.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
```

`script-src` has no `unsafe-inline` and no `unsafe-eval`: the bundle ships no inline script.

## WalletConnect

Not enabled. RainbowKit is not bundled, so no placeholder project id exists anywhere in this
repository — a fake credential would be worse than an absent one.

The app works today with any injected EIP-1193 wallet. To add WalletConnect:

1. Obtain a real project id from https://cloud.walletconnect.com
2. Add it as `VITE_WALLETCONNECT_PROJECT_ID`
3. Add `@rainbow-me/rainbowkit` and `@walletconnect/ethereum-provider` to `apps/web`
4. Wrap the connect button with RainbowKit's `connectModal`

Nothing else needs to change: writes already go through an EIP-1193 provider, and
WalletConnect supplies one.

## Operational notes

- **Studionet rate limit.** The public node allows 30 `gen_*` requests per minute per client.
  The indexer paces itself at 22/min. Do not run unthrottled tooling against it.
- **Indexer lag.** Visible as "Indexing" under a promise's provenance panel. Derived state is
  always rebuildable: `pnpm --filter @promisedecay/api db:reset` then re-index.
- **Restart safety.** All three processes handle SIGTERM: the web server drains, the API
  closes its pool, the indexer lets an in-flight pass finish before exiting.


---

## Operating notes

### GenLayer Studio rate limits

The public Studio endpoint enforces **two** limits per client, and the smaller one governs:

| Window | Limit | `reader.ts` budget |
|---|---|---|
| Per minute | 30 | 24 |
| Per hour | 500 | 420 |

Pacing on the per-minute limit alone is not sufficient — 22/min is 1320/hour, which exhausts the
hourly budget in under half an hour. `RateLimiter` therefore enforces a dual-window token bucket.

The node reports throttling as a generic `UnknownRpcError: An unknown RPC error occurred.`, with
the real signal (`code -32029`, plus `bucket`/`window`/`limit`/`retry_after_seconds`) hidden in
`cause.data`. Any tooling you write against this endpoint must detect that structure, not the
message text — matching on the string "rate limit" silently never fires.

Expect a full sync of the current dataset to take roughly 3–4 minutes wall-clock. `INDEXER_INTERVAL_MS`
is the floor between passes, not a freshness guarantee.

### Port selection

If an API process starts, logs nothing, and binds no port, check for a **stale socket** on the
configured port before touching the process: `ss -tlnp | grep <port>` can show a listener with no
live process, and `curl` will be refused. Choose a different `API_PORT` rather than killing whatever
holds it — it may belong to another service.

### Why the API has a dedicated entrypoint

`apps/api/dist/main.js` exists so the server starts unconditionally. A process manager runs a
module inside its own fork, so `process.argv[1]` is the *manager's* file; any
"am I the entrypoint?" guard evaluated from it is false under PM2, and the API silently starts,
binds nothing and logs nothing. A dedicated entrypoint removes that whole failure mode.

### Certificate renewal

TLS uses certbot with the webroot plugin. Renewals reload nginx via certbot's deploy hooks. Verify
that HSTS survives renewal by checking a route that nginx serves itself:

```bash
curl -sI https://promisedecay.bydx.fun/ | grep -i strict-transport
```

nginx does not inherit `add_header` into a `location` that declares its own, and every `location`
here sets `Cache-Control` — so HSTS must be repeated in each of them. Omitting it produces a
configuration that *looks* secure and is not.
