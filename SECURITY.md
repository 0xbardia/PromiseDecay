# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Security reports are public the moment an issue is filed,
and a proof of concept for an accountability tool is worth more to an attacker than it is to us.

Email **security@promisedecay.bydx.fun**, or use GitHub's private reporting on
[the repository](https://github.com/0xbardia/PromiseDecay) if it is enabled.

Please include:

- what an attacker can do, concretely;
- steps to reproduce, and the request or transaction that triggers it;
- which component is involved (contract, API, indexer, frontend, deployment);
- the contract address and network if it is chain-related.

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement | 2 business days |
| Triage and severity | 5 business days |
| Fix or mitigation plan | 14 days |
| Disclosure | Coordinated with you, after a fix ships |

We will tell you plainly if a report is out of scope, and we will credit you in the advisory
unless you would rather we did not.

## Supported versions

V1.x is the only supported line. There is no LTS branch — this is a small project and a
long support matrix would be a promise we cannot keep.

## Threat model in brief

The system has three trust boundaries, and it is worth being explicit about which side of each
one a component sits on.

**1. Untrusted web content and user text → contract non-determinism.**
A source page is attacker-controlled. Consensus is *not* a defence here: a hostile page can
manipulate every validator identically, so a majority agreement can still be a shared mistake.
All injection defences are therefore deterministic and run *before* any non-determinism — scheme
allow-listing, rejection of credential-bearing URLs and of loopback/private/link-local literals
(including the octal `010.0.0.1` form), port and length bounds, redirect limits, and strict
separation of untrusted evidence from contract policy inside every prompt.

**2. Browser → contract (writes).**
Writes are signed by the user's own wallet. The backend holds no signing key and cannot write.
Caller identity comes from the transaction, not from request data.

**3. Contract → indexer/API (reads).**
The API is strictly read-only and holds no authority. It cannot resolve a promise, change a
status, or influence an outcome. If the database is deleted and rebuilt from chain, the product is
identical.

Known and accepted risks are listed with their residual risk in
[`docs/SECURITY_FINDINGS.md`](docs/SECURITY_FINDINGS.md).

## Scope

**In scope:** the contract, the API, the indexer, the web client, the deployment configuration.

**Out of scope:** vulnerabilities in GenLayer itself (report upstream), and attacks on the
Ethereum wallet extension or the browser itself.

## About our security review

`docs/SECURITY_FINDINGS.md` is an **internal review of our own code**. It is not an independent
audit, and we do not describe it as one — no third party has examined this codebase.
