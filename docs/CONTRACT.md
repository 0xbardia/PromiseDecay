# PromiseDecay — Contract

The authoritative record. Source: [`contracts/PromiseDecay.py`](../contracts/PromiseDecay.py).

## Runtime pin

```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
```

Verified against the official GenLayer documentation. The pin is mandatory and is never
removed or guessed.

## Storage

```python
promises:        TreeMap[u256, PromiseDNA]          # immutable original record
evidence:        TreeMap[u256, DynArray[EvidenceItem]]
drift:           TreeMap[u256, DynArray[DriftItem]]
responses:       TreeMap[u256, DynArray[ResponseItem]]
challenges:      TreeMap[u256, DynArray[ChallengeItem]]
provisional:     TreeMap[u256, ResolutionResult]
final_result:    TreeMap[u256, ResolutionResult]
lifecycle:       TreeMap[u256, str]
challenge_closes_at: TreeMap[u256, u256]
promise_ids:     DynArray[u256]
next_promise_id: u256
version:         str
```

Two storage notes learned from Studio Mode rather than from documentation:

- **Sized integers only.** Bare `int` is rejected by the storage generator. Timestamps are
  `u256`.
- **`TreeMap.keys()` is not calldata-encodable.** Returning it from a view fails on chain
  even though it works in Direct Mode. `promise_ids` is therefore stored explicitly and
  returned as a real `DynArray[u256]`.
- **Child collections cannot be `DynArray[dict]` locally.** A `DynArray` created inside a
  view raises `TypeError: this class can't be instantiated by user`. Collections are read
  back as JSON strings and parsed by the client.

## Time

Time inside GenVM is deterministic and pinned to the transaction timestamp, so
`datetime.now(timezone.utc)` is identical for every validator re-executing the transaction.
`gl.message` in this SDK version does **not** expose `datetime`; the standard-library clock
is the supported source.

## Bounds

| Field | Bound |
|---|---|
| original_quote, drift statement, evidence quote | ≤ 1200 chars |
| project, actor, action, object, scope, conditions | ≤ 200 chars |
| source_url | ≤ 500 chars, http/https, screened |
| explanation | ≤ 600 chars |
| evidence per promise | ≤ 64 |
| drift entries per promise | ≤ 64 |
| responses per promise | ≤ 32 |
| challenges per promise | ≤ 16 |
| URLs fetched per resolution | ≤ 3 |
| extracted text per fetch | ≤ 4000 chars |
| prompt size | ≤ 16000 chars |
| challenge window | 7 days |

## Write methods

| Method | Preconditions |
|---|---|
| `create_promise` | All fields validated and bounded; deadline in the future; allocates a non-colliding id |
| `add_evidence` | Promise exists, not final, kind valid, not a duplicate, collection not full |
| `add_drift` | Promise exists, not final, statement ≥ 8 chars, collection not full |
| `submit_response` | Promise exists, statement ≥ 4 chars, collection not full |
| `request_resolution` | Promise exists, not final, no prior result, deadline passed |
| `challenge` | Provisional result exists, lifecycle is `CHALLENGE_WINDOW`, inside window, rounds remain, evidence URL not already used |
| `re_evaluate` | A challenge exists, the current window is open or a new challenge is pending, and rounds remain |
| `finalize` | Provisional exists, no pending challenge, lifecycle is `CHALLENGE_WINDOW`, challenge window closed |

## Read methods

All public, all inspectable, all certified after deployment:

`get_version` · `get_config` · `get_promise_count` · `get_all_promise_ids` ·
`get_promise` · `get_evidence_count` · `get_evidence` · `get_drift_count` · `get_drift` ·
`get_response_count` · `get_responses` · `get_lifecycle_status` ·
`get_provisional_result` · `get_final_result` · `get_challenge_count` · `get_challenges` ·
`get_created_at` · `get_deadline_at` · `get_challenge_window`

## Invariants

Guaranteed and tested:

1. Promise ids never collide.
2. Original promise records are immutable — no mutator exists.
3. Invalid ids fail with a clear user error, not a raw VM crash.
4. Final resolution cannot regress.
5. Resolution cannot begin before the deadline.
6. Challenges cannot arrive after the window closes.
7. Finalization cannot happen before the window closes.
8. Invalid enum or malformed model output cannot corrupt state.
9. Collection and string bounds are enforced on write.
10. Duplicate evidence is rejected rather than stored twice.
11. Transaction time comes from the deterministic GenVM context.
12. Caller identity is preserved from `gl.message.sender_address`.
13. Non-determinism cannot bypass state rules: all guards run before the block, all
    validation runs after it.

## Drift classification

`_classify_relation` is a deterministic first pass that sets a UI hint on the stored record.
It never affects delivery or integrity — semantic authority stays with consensus.

`SOFTENED` · `NARROWED` · `REFRAMED` · `REVERSED` · `FULFILLED_EARLY` · `UNRELATED`

## What the contract does not do

- No trust score, reputation number, or ranking.
- No voting, likes, followers or popularity metric.
- No access control or roles — anyone may write, and every write is attributed.
- No token, staking or payment.
- No method that deletes or edits an original promise.
