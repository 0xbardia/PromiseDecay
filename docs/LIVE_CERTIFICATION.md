# PromiseDecay — Live lifecycle certification (contract 1.0.1)

Run on 2026-10-07 against GenLayer Studionet (chain 61999). Every transaction below was signed
and broadcast for real; every hash resolves on the Studio explorer.

## Identity

| | |
|---|---|
| **Production contract** | `0x742210deAab5d1A45F68675b1Ed0be2f621671c5` (`1.0.1`, challenge window 604800 s) |
| Deployment tx | `0x27023d8d63f08f5359a6b688b02c87fd8d0c026d64909c7557e161b795ca3c00` |
| Source commit | `e070d2ee9e95cfd8ffa05252c9aeaaa41232ff72` |
| Source sha256 | `32f6a82e0d46362d8c51bf584aa1eb89823e21f91c9e9540336c558e968a864b` — equal to the on-chain code (`gen_getContractCode`) |
| **Legacy V1 (untouched)** | `0x6B340D9C6230b31652aAbDC08acDAd763635A82b` (`1.0.0`, records 1–4) |
| **TEST-ONLY short-window fixture** | `0xae821b3495b3D6422A7f6a98C11159EFA7f2aB78` (`1.0.1-TEST-SHORT-WINDOW`, window 600 s) |
| Fixture deployment tx | `0x556d266bc6111e21834663db220f79cf330b1956264aa428288315f60b8d5dbc` |
| Fixture source sha256 | `e6479f4d104ea0632586b8389f5b45463cbab138f4f7a4d73398d38e0204da1c` — derived by `scripts/make-test-fixture-source.mjs`, differs from production in exactly two lines |

The test-only contract is a throwaway. It is not configured anywhere and never serves the app.

## The fixture

A synthetic, labelled promise ("Meridian Labs", fictional) whose pages are served from this
deployment's own origin under `/fixtures/<run>/`, so validator fetches appear in the web server
log. Four neutral evidence items are stored **first**, then three drift items (two relevant, one
unrelated). Under the 1.0.0 rule (first three stored evidence URLs) the original source, every
drift source and the challenge would all have been excluded.

| Evaluation | 1.0.0 rule would fetch | 1.0.1 must fetch |
|---|---|---|
| `request_resolution` | `ev-d`, `ev-c`, `ev-b` | `announcement` (original), `invite-beta`, `partner-update` (newest relevant drift first) |
| `re_evaluate` | `ev-d`, `ev-c`, `ev-b` | `announcement` (original), `release-notes` (newest challenge), `invite-beta` |

`tests/contract/test_live_fixture_replay.py` fixes the 1.0.1 prediction in Direct Mode, and an
A/B against the exact legacy source confirmed the 1.0.0 column.

## Short-window test contract — full lifecycle, FINAL

Promise 1, signed with a disposable key through the SDK.

| Step | Tx | Before → after |
|---|---|---|
| `request_resolution` | `0xb2db2f10d666a0ab9f6fa1e045b529034a9b63ac9c357ce09ff85de1a86983fc` | `OPEN` → `CHALLENGE_WINDOW`, **NOT_KEPT / NARROWED** |
| `challenge` | `0x42c377f5a5bd56015771cd602370c3e5e97d1cf3c0f588950265457c66523b41` | `CHALLENGE_WINDOW` → `RESOLVING`, 1 challenge, 5 evidence |
| `re_evaluate` | `0x502111229ef5f39808b2dfab5588b06a9b0b2efac11125ea2bb2ed3f8b8c749d` | `RESOLVING` → `CHALLENGE_WINDOW`, **KEPT / UNCHANGED**, `deadline_met` true |
| `finalize` | `0x5dfcc34f1bd3c566a053aa676a477363361540b964a4cfc882e3cb9bf068b465` | `CHALLENGE_WINDOW` → **`FINAL`**, final result KEPT / UNCHANGED |

Validator fetches (user agent `Mozilla/5.0`, from the web server log): `request_resolution` →
announcement, invite-beta, partner-update; `re_evaluate` → announcement, release-notes,
invite-beta, 6 each. No `ev-*` or `offsite` page was fetched by a validator.

## Production contract — through the public app

Promise 2 (a second, disposable fixture; promise 1 was a partly seeded attempt abandoned after a
harness fault and is left as an unresolved `OPEN` record). Production keeps its real 7-day
window: `request_resolution` decided at 1791334099 for the first window, and `re_evaluate`
decided at 1791336760 set `challenge_closes_at` to 1791941560 (exactly +604800 s). `finalize`
is not reachable until then and was not attempted.

| Step | Tx | Before → after |
|---|---|---|
| `request_resolution` | `0xb3597e9076539f7a4337e0902a15adec5eb77a0781e39a2b070e54047cc56782` | `OPEN` → `CHALLENGE_WINDOW`, **NOT_KEPT / NARROWED** |
| `challenge` | `0x57875b466d3d420d01c4cffb2b9ea2267b1894a82843f3184f713f1ea624974d` | `CHALLENGE_WINDOW` → `RESOLVING`, 1 challenge, 5 evidence |
| `re_evaluate` | `0xffd1c9671fbc77127c91ed534699e8be3cf6b87518fd26d7e05711c265064714` | `RESOLVING` → `CHALLENGE_WINDOW`, **KEPT / UNCHANGED**, `deadline_met` true |

Provisional explanation: *"…evidence shows only invited/selected partners access after the
deadline with broader release deferred."* Fresh explanation: *"The release notes confirm Aurora
SDK v2.0.0 was published … before the deadline … The earlier invite-beta notices predate the full
public release."* Validator fetches matched the table above (`request_resolution`: announcement,
invite-beta, partner-update; `re_evaluate`: announcement, release-notes, invite-beta).

The wallet is a key-backed EIP-1193 provider in headless Chromium: the page asks it to
`eth_signTransaction`, the signature is made in a separate Node process (the key never enters the
page), and the app's own SDK path broadcasts it. The challenge and re-evaluation were initiated
by clicking the app's buttons. Seeding (`create_promise`, `add_evidence`, `add_drift`) was signed
with the same wallet through the SDK, and `request_resolution` was also app-initiated (its panel
outcome was not captured by the harness; the chain state and hash are the evidence).

## Defects this run found and fixed

Both were in the web app, invisible to unit tests and to Direct Mode.

1. **String promise id.** The app passed `"2"`; the contract compared `str` with `int` and
   raised `TypeError`. Failed tx: `0x9953d0a7ee4da846eb8ccaf643b11685752cac76f200f84164c953c53fc29fda`
   (status `FINALIZED`, `execution_result: ERROR`, lifecycle stayed `OPEN`). The chain-state
   reads used the same string id. Fixed in `apps/web/src/lib/chain.ts` (`normalizeWriteArgs`,
   `toContractInt`).
2. **False success.** The panel reported "Confirmed" for that failed transaction because it
   only checked the transaction status. The app now reads the validators' `execution_result`
   and reports failure (with the reason) for `ERROR`, and does not report success when the
   result cannot be read. The progress track also no longer shows "Finalized on chain" until
   the execution result is confirmed.

## Limits of this evidence

- The Studio endpoint allows 500 requests per hour per IP, and this host's IP is shared. The
  harness backs off on that error and, for the browser only, re-issues a throttled identical
  request after a pause (37 retries in the final run). Nothing about a request or a signed
  transaction is altered by this.
- `finalize` on the production contract is unproven until 2026-10-14 by design.
- Validator output is non-deterministic: the verdicts above are what this run produced.
