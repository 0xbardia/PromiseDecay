# PromiseDecay — Roadmap

Only V1 is marked shipped, and only because it is deployed and verified on chain. Everything
after it is labelled planned. No dates are implied, because implying them is how roadmaps
start lying.

---

## V1 — Public Promise Memory · SHIPPED

The complete promise lifecycle, deployed on GenLayer Studionet and verified.

- [x] Immutable promise records — original DNA written once, never edited
- [x] Promise Drift with a chronological lineage and precise removed/added highlighting
- [x] Evidence with on-chain deduplication
- [x] Public responses, attributed honestly to an unverified address
- [x] Semantic GenLayer resolution across two separate axes: delivery and integrity
- [x] A bounded 7-day challenge window with genuine re-evaluation
- [x] Project commitment history with aggregate counts
- [x] Search, filtering and cursor-paginated explore
- [x] Wallet-signed writes — no server signing key
- [x] Public documentation at `/docs` and a public `/roadmap`

### Verification behind that checkmark

- 146 Direct Mode contract tests green
- Real Studio Mode transactions on Studionet, each reported with its hash
- Deployed read-method certification: all PASS
- 44 backend tests, 74 frontend tests, 9 indexer tests, 217 Direct Mode, Playwright across three browsers
- Security Review: 0 open Critical, 0 open High

---

## V1.1 — Identity and follow-up · PLANNED

The biggest honest gap in V1: responses are labelled `Response from 0x…` because ownership
cannot be verified. That is correct for V1, but it is a real limitation.

- [ ] Project identity verification, so a verified project response can be labelled official
- [ ] Watchlists — follow a project or a single promise
- [ ] Richer evidence provenance: what a source showed when it was submitted
- [ ] Share cards for a promise record

---

## V1.2 — Keeping watch · PLANNED

- [ ] Notifications when drift is attached to a promise you follow
- [ ] Notifications when a deadline approaches
- [ ] Better organisation histories: grouping related commitments
- [ ] Source monitoring, so a page that changes after being cited is noticed

---

## V2 — Promise Graph · PLANNED

- [ ] A Promise Graph across projects
- [ ] Composable commitment history
- [ ] Downstream reputation primitives — built *on* the record, never replacing it

---

## Explicitly not planned

Stating these is as important as stating what is planned.

| Not planned | Why |
|---|---|
| A trust score or reputation number | It would replace the record with a number, which is the failure mode this product exists to stop |
| Social voting, likes, followers | Measures popularity, not delivery |
| A token, staking or prediction market | Different product, different risks |
| Deleting or editing an original promise | Would break the one guarantee that makes the record worth keeping |
| A DAO for moderation | No moderation is needed; the record is append-only and public |

---

## How this roadmap is kept honest

- V1 is marked shipped only after certification against a deployed contract.
- Future work is never implied as built.
- If a promise in this project's own roadmap is ever softened, the change would be visible
  here — because that is the behaviour the product enforces.

*Said. Tracked. Resolved.*