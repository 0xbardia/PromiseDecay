# PromiseDecay — Engineering Constitution

**Version:** 1.0.0
**Ratified:** 2026-10-03
**Applies to:** every artifact in this repository (contracts, api, indexer, web, tests, docs, infra).

This document is binding. Any change to it must be a separate, explicit commit that
updates this file first, and must state which principle is being traded away and why.

---

## Principle I — The contract is the only authority

The GenLayer Intelligent Contract is the single source of truth for promise state,
delivery, integrity and resolution. The API and indexer are **derived, rebuildable
projections**. If the database is wiped, `pnpm db:reset && pnpm indexer` must restore
byte-identical derived state without a single user-facing write.

**Enforced by:** `docs/ARCHITECTURE.md` boundaries; the API contains no business rules
that also exist on-chain; indexer idempotency tests.

**Violation:** any API route that decides a delivery verdict, or any indexer step that
invents a field the contract never emitted.

---

## Principle II — Non-determinism never touches state directly

Every LLM judgment, semantic comparison, drift classification and resolution happens
inside a GenVM non-deterministic block under an explicit `gl.eq_principle`. Persistent
state is written **only after** consensus returns, in deterministic code, and only after
schema + enum validation passes.

**Enforced by:** GenVM lint; the non-det closure contains no storage reads or writes;
contract tests assert that malformed consensus output leaves state unchanged.

**Rationale:** a consensus result is an *input* to the state machine, never a shortcut
around it. A validator that wrongly agrees on garbage must still fail schema validation.

---

## Principle III — Hostile input is data, never instruction

All web pages and user text are untrusted. System policy, contract rules and evidence are
separated by explicit delimiters, and validators are instructed that delimited content
must never be obeyed. Prompt injection defense is layered:

1. deterministic pre-filter (scheme, host, IP literal, port, length, count);
2. delimiter separation + explicit validator instruction;
3. deterministic post-validation (closed enums, strict schema, decision fields only);
4. deterministic invariants re-checked after consensus.

**Enforced by:** `tests/contract/test_prompt_injection.py`, `tests/security/`.

**Violation:** ever exact-matching generated prose, or letting an LLM choose a method,
enum value, or permission.

---

## Principle IV — Immutability is a feature, not a limitation

An original promise record is never edited. Drift is added as a new linked record.
Final resolution never regresses. The API has no update/delete route for promises.

**Enforced by:** the contract exposes no mutator for a promise's original fields; the API
route table is reviewed in `docs/API.md`.

---

## Principle V — Users sign their own writes

Every production write is signed by the user's browser wallet. The server holds **no**
signing key for user actions, stores no private key, and never fabricates a successful
transaction. A transaction is "final" only when the chain says so.

**Enforced by:** no private-key material anywhere in the repo or server config; the UI
distinguishes submitted / consensus-pending / accepted / final / failed.

---

## Principle VI — Smallest robust architecture

No abstraction, dependency, table, or service without a measured reason. One API process,
one indexer process, one web process, one PostgreSQL database. No Redis, Kafka,
GraphQL or microservices in V1.

**Enforced by:** the Ponytail audit in the release checklist; `docs/ARCHITECTURE.md`
"what we deliberately did not build".

---

## Principle VII — Design is a correctness requirement

The frontend is the product. Living Glass is a material system that carries information,
not decoration. Color always encodes state and is always paired with text. Every
significant component has designed loading, empty, error, offline, stale and
transaction states. Reduced-motion users get an equally polished static experience.

**Enforced by:** visual QA screenshots at 1440px and 390px per route; Playwright across
Chromium/Firefox/WebKit; WCAG 2.2 AA contrast and keyboard checks.

**Violation:** shipping a route that works but reads as a template, a gray card grid, or a
generic AI dashboard.

---

## Principle VIII — Evidence over claims

Release status is asserted only against executed evidence: real tx hashes, real command
output, real screenshots, real scan results. Fabricated or inferred test results are a
constitution violation, not a shortcut. If something was not verified, it is reported as
PARTIAL or BLOCKED.

**Enforced by:** the final report format in the release brief; every claim carries its
evidence.

---

## Principle IX — Security review, honestly scoped

A security review is a self-review unless an independent audit actually occurred, and is
named accordingly. Before v1.0.0: zero open Critical, zero open High. Findings are
tracked in `docs/SECURITY_FINDINGS.md` with residual risk stated, not hidden.

---

## Working agreements

- Outcome first: state what will be true, then build it.
- Progressive disclosure: load only the context a change needs.
- Reuse existing project patterns over inventing new ones.
- Test proportionally while implementing; certify exhaustively at the end.
- No blind retries: a failure that repeats twice is a diagnosis task, not a retry task.
- Prefer the root cause over the bandaid, and cite file:line.