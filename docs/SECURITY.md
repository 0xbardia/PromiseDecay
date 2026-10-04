# PromiseDecay — Security

The findings register lives in **[SECURITY_FINDINGS.md](./SECURITY_FINDINGS.md)**. This page
is the summary and the reasoning behind the postures.

## Read this first

The findings register is a **Security Review**, not an independent audit. No third party has
reviewed this code. It is self-assessed, and it is labelled that way so nobody mistakes it
for external assurance.

If you are deploying PromiseDecay with anything at risk, commission an independent audit
first.

## Gate for v1.0.0

| Severity | Open |
|---|---|
| Critical | 0 |
| High | 0 |

## Threat model

### What we are protecting

- **The integrity of the record.** An original promise must never be altered.
- **The honesty of a verdict.** A resolution must follow from evidence, not from an
  instruction someone wrote on a page.
- **The user's authority.** Nobody may write on a user's behalf.

### What we are not protecting against

- A majority of validators agreeing on a wrong-but-valid verdict. The challenge window
  exists for this; it is a governance property, not a cryptographic one.
- Denial of service against the GenLayer public node, which we do not control and do not
  attempt to.
- Total compromise of a user's browser. A malicious script in the page could ask the wallet
  to sign; the user still sees and approves the signature.

### Assets

| Asset | Where it lives | Why it matters |
|---|---|---|
| Authoritative promise state | GenLayer contract | The product |
| Evidence and drift | GenLayer contract | The basis of every verdict |
| Derived projection | PostgreSQL | Rebuildable; losing it is an outage, not a breach |
| User signing authority | Browser wallet | Never on the server, by design |

### Trust boundaries

1. **User text → contract.** Untrusted. Bounded, escaped, stored verbatim, never
   interpreted as instruction.
2. **Web page → contract.** Untrusted. Screened before fetching, delimited in the prompt,
   schema-validated after consensus.
3. **Contract → database.** Trusted-to-derive only. The indexer mirrors; it never decides.
4. **Browser → server.** Read-only. No session, no cookie, nothing to forge.

## Security postures

| Concern | Posture |
|---|---|
| **Prompt injection** | Deterministic URL screening → delimited prompt regions → explicit validator instruction → deterministic post-consensus schema and enum validation → invariant re-check |
| **Consensus is not a defence** | Consensus output is an input to validation, never a shortcut around the state machine |
| **SSRF** | Scheme, credentials, localhost, IPv4/IPv6 literals (including octal-ambiguous leading zeros), port allowlist, length — all checked before the fetch |
| **XSS** | All untrusted text rendered as React children. No `dangerouslySetInnerHTML` anywhere. CSP with no `unsafe-inline` for scripts |
| **SQL injection** | Parameterised queries throughout; search input reduced to letters and digits before it reaches `tsquery` |
| **CSRF** | No server-side write path exists, so there is no cookie-authenticated state to forge |
| **CORS** | Explicit allowlist, `credentials: false`, `GET`/`HEAD` only |
| **Clickjacking** | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| **Body exhaustion** | 32 KB body limit |
| **Rate abuse** | Per-IP rate limiting with a typed `RATE_LIMITED` response |
| **Wallet spoofing** | Chain id verified before signing; a mismatch names both the actual and expected chain |
| **False success** | A transaction is only shown as final when the chain reports `FINALIZED` |
| **Replay / duplicates** | Evidence deduplicated on chain; challenge must cite unused evidence; indexer upserts by unique key |
| **Secrets** | No secrets in the repository; `.env` gitignored and mode 600; `authorization`/`cookie` redacted from logs; no key in any bundle |
| **Unverified authority** | Responses are never labelled official in V1; the indexer forces `verified: false` |

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md) in the repository root. Please do not open a public issue
for an unfixed vulnerability.

## Honest limitations

- Rate limiting is per-instance and in memory. A multi-instance deployment needs a shared
  store.
- `style-src` allows `'unsafe-inline'` because React sets inline style attributes for status
  colours. The data on these pages is public, so practical impact is nil, but it is a real
  allowance and is recorded rather than hidden.
- The security review is a snapshot. Re-run it before each release.