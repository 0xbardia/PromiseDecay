# PromiseDecay — Product

## The problem

Public commitments are made in prose, quietly revised, then partially delivered. The
history gets rewritten by the people who wrote it.

Social voting measures popularity, not truth. Reputation scores collapse nuance into a
number. Prediction markets require money and a position. On-chain oracles verify data
points, not the meaning of a promise over time.

## The thesis

**A public memory layer for promises.**

PromiseDecay preserves public commitments, tracks how they change, and uses GenLayer
consensus to determine what was actually delivered.

Three things are kept **separately**:

| Dimension | Question | Authority |
|---|---|---|
| Original Promise | What was actually said? | Immutable on-chain record |
| Promise Drift | How did later statements change wording, scope or intent? | Linked, append-only chain |
| Resolution | What evidence shows what was delivered? | GenLayer semantic consensus |

*Said. Tracked. Resolved.*

## What this is deliberately not

Not a reputation score. There is no `78/100` composite anywhere in the data model. Not
social voting, not a popularity ranking, not a token, not staking, not a prediction market,
not a DAO, not a generic AI chat interface.

A project that keeps every promise badly is not scored better or worse. The record simply
shows what happened. That restraint is the product.

## The three concepts

### Promise DNA

The minimum authoritative record, fixed at creation and never mutated: `promise_id`,
project, actor, original quote, action, object, scope, deadline, conditions, source URL,
creator, created timestamp, contract version. Every string and collection is bounded.

### Two axes, not one verdict

**Delivery** — was it delivered? `KEPT` · `KEPT_LATE` · `PARTIAL` · `NOT_KEPT` ·
`UNRESOLVED`

**Integrity** — did the promise keep its meaning? `UNCHANGED` · `NARROWED` · `REFRAMED` ·
`REVERSED` · `UNKNOWN`

The canonical example:

> Original: "Public mainnet will launch before September 30."
> Later: "Selected ecosystem partners receive access in September."
> Result: `delivery = PARTIAL`, `integrity = NARROWED`

That is a first-class correct answer, not a hedge. The system never reduces this to true or
false, because that reduction is exactly the information loss the product exists to avoid.

### Promise Drift

Later statements attach to an existing promise and are never merged into it. Each entry
retains the promise id, the exact statement, a source URL, a timestamp, the submitter, a
semantic relationship and a drift classification.

Relationships: `SOFTENED` · `NARROWED` · `REFRAMED` · `REVERSED` · `FULFILLED_EARLY` ·
`UNRELATED`

The lineage renders chronologically:

```
Original → Softened → Narrowed → Reframed → Reversed → Deadline → Resolution
```

Only states actually supported by evidence are shown. A step never appears unless it was
recorded.

## Lifecycle

```
OPEN → DUE → RESOLVING → PROVISIONAL → CHALLENGE_WINDOW → FINAL
```

- Resolution may not begin before the deadline.
- A challenge must be inside the window and must bring materially new evidence.
- A challenge is permanently recorded; a separate public transaction runs genuine re-evaluation.
- Finalization may not happen before the window closes.
- A final result never regresses.

## Who can do what

| Actor | Right |
|---|---|
| Anyone | Browse, search and read every promise, its lineage, its evidence and its verdict — no wallet |
| Anyone | Record a promise, add evidence, attach a later statement, submit a response — signed by their own wallet |
| Anyone, inside the window | Challenge a provisional result with materially new evidence |
| No one, after finalization | Reverse a final result, or edit an original promise |

### The right to respond is not the right to rewrite history

Any address may submit a public response. Because ownership is **not** verified in V1, the
UI always says `Response from 0x1234…` — never "Official Project Response". A response is a
separate permanent record that cannot alter the promise or the verdict.

Verified project identity is a V1.1 roadmap item, deliberately not smuggled into V1.

## Design language — Living Glass

A material system, not decoration.

**Glass carries information. Colour carries state. Motion carries history.**

- Deep ink grounds (`#07090D` → `#111822`), never dead black.
- Glass is translucent and layered, with crisp edge highlights — but stacking is capped at
  three blurred layers.
- Colour encodes a real product state and is **always paired with text or an icon**, so
  meaning never depends on hue alone.
- Motion communicates state and history, 150–350ms, and is fully removable under
  `prefers-reduced-motion` — which still produces a finished, static page.

Status colours: KEPT green · KEPT_LATE amber · PARTIAL sky · NOT_KEPT red · UNRESOLVED
silver · NARROWED coral · REFRAMED orange · REVERSED red.

Purple is not the brand colour. There is no pink-purple-blue AI gradient.

### Signature components

1. **Promise Lens** (hero) — an interactive reconstruction of a real promise: original
   wording, later wording, which words were dropped and added, and the resulting verdict.
   Real product state, not an abstract visual.
2. **Promise Card** — a status-coloured edge refraction, an editorial quote block, a
   monospace promise id, and a metadata rail. Designed to be screenshot-worthy.
3. **Drift Rail** — the chronological lineage with a chromatic progression and precise
   removed/added term highlighting. One of the product's recognisable components.

## Acceptance

V1 ships only when the full lifecycle works end-to-end on a deployed contract, Direct Mode
and Studio Mode are green, every public read method returns the expected value on the final
deployment, the landing and promise pages pass visual review, public docs and `/roadmap`
exist, the security review has zero open Critical and zero open High, and the production URL
serves the built app.

Roadmap items are marked shipped only when built and verified.
