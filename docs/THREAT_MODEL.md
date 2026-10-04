# PromiseDecay — Threat Model

Structured threat modelling for the V1 system. Read [SECURITY.md](./SECURITY.md) for the
postures and [SECURITY_FINDINGS.md](./SECURITY_FINDINGS.md) for the findings register.

## 1. System description

A public dApp for recording promises, tracking how they drift, and resolving what was
actually delivered using GenLayer consensus.

| Element | Trust level | Notes |
|---|---|---|
| GenLayer contract | Trusted to enforce invariants | The authority |
| Web pages fetched on chain | **Untrusted** | Fully attacker-controlled content |
| User-submitted text | **Untrusted** | Promises, drift, evidence, responses |
| API | Derived, trusted for correctness | Decides nothing |
| PostgreSQL | Derived | Rebuildable; not a source of truth |
| Browser + wallet | Partially trusted | The user approves each signature |
| nginx / TLS | Trusted infrastructure | |

## 2. Trust boundaries

```
[ untrusted web ]  →  [ contract URL screen ]  →  [ non-det block + consensus ]
                                                      ↓
[ untrusted user ] →  [ contract bounds + enum ]   [ deterministic validation ]
                                                      ↓
                                            [ persistent state ]

[browser] → [nginx TLS] → [api: read-only] → [postgres]
     └──────→ [genlayer-js + injected wallet] → [chain]   (writes never touch the server)
```

## 3. Assets and what would hurt

| Asset | Loss impact | Likelihood without controls |
|---|---|---|
| Original promise immutability | The product's entire premise is void | High without a missing mutator |
| Verdict honesty | The record becomes confidently wrong | High without deterministic validation |
| User signing authority | Users act without consent | Medium without server-side write removal |
| Derived projection | Temporary outage only | Low — rebuildable |
| Deployment secrets | Full compromise | Low with `.env` discipline |

## 4. Threats

### T1 — Instruction injection via a fetched page

**Attacker** controls a URL submitted as evidence. **Goal:** force `KEPT` regardless of
evidence.

**Path:** page text → prompt → LLM → consensus → state.

**Controls:** deterministic URL screen → three separated prompt regions → explicit validator
instruction repeated in the comparison criteria → deterministic post-consensus schema and
enum validation → invariant re-check.

**Residual:** a sufficiently indirect injection could produce a *valid but wrong* verdict.
Bounded by the challenge window.

### T2 — Unanimous bad consensus output

**Goal:** corrupt state by getting every validator to agree on something invalid.

**Path:** leader output → validators agree → state write.

**Controls:** `_parse_decision` rebuilds the result from only the five known fields.
Invalid enums, missing fields, non-boolean flags and incoherent pairs all raise before any
write. Unknown keys are inert.

**Residual:** a valid-but-wrong enum still passes. That is a judgement problem, bounded by
the challenge window.

### T3 — SSRF / internal reachability from the VM

**Goal:** reach internal infrastructure via a submitted URL.

**Path:** URL → `gl.nondet.web.render`.

**Controls:** scheme allowlist; no credentials in URL; localhost and `.localhost` blocked;
all IPv4 and IPv6 literals blocked, **including leading-zero octets** such as `010.0.0.1`
which resolvers may read as octal; port allowlist; 500-character cap; at most 3 sources.

**Residual:** DNS rebinding cannot be prevented because resolution happens inside the VM's
fetcher. The fetch only reads public text.

### T4 — XSS via stored promise or evidence text

**Goal:** execute script in a visitor's browser.

**Controls:** all untrusted text rendered as React children; diff highlighting splits on
whitespace and wraps tokens rather than building HTML; no `dangerouslySetInnerHTML` in the
repository (enforced by a test); CSP `script-src 'self'` with no `unsafe-inline` or
`unsafe-eval`.

**Residual:** `style-src 'unsafe-inline'` is allowed for inline status colours. Public data,
negligible impact, recorded.

### T5 — SQL injection through search

**Goal:** manipulate or exfiltrate via `tsquery`.

**Controls:** input reduced to letters and digits, so no query operator can be supplied;
empty result rather than a query when nothing survives; parameterised queries elsewhere.

**Residual:** none material.

### T6 — CSRF against a connected user

**Goal:** cause a signed write without consent.

**Controls:** no server-side write path exists. Writes require the user's own wallet
signature. CORS allowlist with no credentials; `GET`/`HEAD` only; `frame-ancestors 'none'`.

**Residual:** a malicious script could request a signature; the user still sees the wallet
prompt.

### T7 — Wallet rejection or network mismatch mishandled

**Goal:** convince a user a write succeeded when it did not.

**Controls:** typed `UserRejectedError` and `WrongNetworkError`; chain id checked before
signing with a message naming both chains; a transaction is only shown as final when the
chain reports `FINALIZED`; recovery affordance offered after rejection.

**Residual:** none material.

### T8 — Duplicate or replayed submissions

**Goal:** inflate the record.

**Controls:** evidence deduplicated on `(source_url, quote)`; a challenge must cite a source
not already used as evidence; the indexer upserts on unique keys.

**Residual:** none material.

### T9 — Stale chain state presented as current

**Goal:** have a stale verdict read as final.

**Controls:** every row carries `indexed_at`, surfaced in the UI as "Indexing"; the indexer
runs on an interval and checkpoints; writes re-read chain state before proceeding.

**Residual:** with a 15s interval against a rate-limited public node, lag can reach minutes.
Acceptable and visible.

### T10 — Secret exposure

**Controls:** no secrets in the repository; `.env` gitignored, mode 600; Pino redacts
`authorization` and `cookie`; no key in any client bundle; deployer key kept in a 600-mode
file outside the repo tree.

**Residual:** development tooling prints a keystore password to a pty; the helper masks it
and lives outside the repository.

### T11 — Rate-limit exhaustion against the shared node

**Not a breach**, but an availability risk. The public Studionet node allows 30 `gen_*`
requests per minute per client.

**Controls:** the indexer serialises reads at 22/min; a rate-limit response is retried after
a real pause; lifecycle and deploy tooling retry using the server's `retry_after_seconds`.

**Residual:** under sustained contention the indexer can fall behind. Visible via
`indexed_at`.

## 5. What is deliberately out of scope

- Compromising a majority of GenLayer validators.
- Griefing the shared public RPC node beyond staying inside its published limit.
- Browser extension compromise.
- Privacy of submitters: addresses and submissions are public by design. This is a property
  of a *public* memory layer, and it is stated plainly rather than overlooked.

## 6. Review cadence

This model is a snapshot. Re-run the review before each release, and commission an
independent audit before relying on PromiseDecay for anything with risk attached.