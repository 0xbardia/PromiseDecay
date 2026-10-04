"""Unknown-id handling across every public read.

The contract is deliberately inconsistent here, and this test documents why.

Two kinds of read exist, and they answer different questions:

  * Identity reads (``get_promise``, ``get_created_at``, ``get_deadline_at``,
    ``get_lifecycle_status``, ``get_challenge_window``) answer "does this promise exist?".
    For those, an unknown id MUST fail clearly. Returning a default would let a caller mistake
    a non-existent record for a real one with empty fields — the specific confusion this product
    cannot afford.

  * Projection reads (``get_drift``, ``get_evidence``, ``get_responses``, ``get_challenges``
    and their counts) answer "how much of this does the promise have?". Zero is truthful for a
    promise with no drift AND for a promise that does not exist, so they return empty. This is a
    deliberate contract choice, not an oversight: it keeps a bulk read of many ids cheap, and it
    is not user-reachable, because the API resolves a promise through the projection and returns
    404 before ever reading children off-chain.

Both halves are asserted below so that neither can drift silently.
"""

from __future__ import annotations

import pytest

from conftest import CONTRACT, make_promise  # noqa: F401

# Reads that establish existence. These must raise a clear user error.
IDENTITY_READS = [
    ("get_promise", "Unknown promise id"),
    ("get_created_at", "Unknown promise id"),
    ("get_deadline_at", "Unknown promise id"),
    ("get_lifecycle_status", "Unknown promise id"),
    ("get_challenge_window", "Unknown promise id"),
]

# Reads that count a collection. These return empty for an unknown id, by design.
PROJECTION_COUNT_READS = ["get_drift_count", "get_evidence_count", "get_response_count", "get_challenge_count"]
PROJECTION_LIST_READS = ["get_drift", "get_evidence", "get_responses", "get_challenges"]


def _raises(function, *args) -> Exception:
    """Call `function` and require that it refuses.

    A note on what cannot be asserted here. The contract raises
    `gl.vm.UserError("Unknown promise id")`, but genlayer-test surfaces that as a bare
    `KeyError()` with no arguments, and the live RPC wraps it as "Missing or invalid
    parameters". The message text is therefore not observable through *either* harness.

    So these tests assert what is genuinely verifiable — that the read refuses rather than
    returning a default — and the message itself is verified by reading the contract source
    (`_require_promise`, line 549) rather than by pretending a harness surfaced it. Asserting
    on `KeyError` specifically would pin the wrapper rather than the behaviour, so the
    assertion stays on "an error was raised".
    """
    with pytest.raises(Exception) as exc:
        function(*args)
    return exc.value


@pytest.mark.parametrize("method,_expected", IDENTITY_READS)
def test_identity_read_refuses_unknown_id(direct_deploy, method, _expected):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)

    _raises(getattr(c, method), pid + 9999)


@pytest.mark.parametrize("method", PROJECTION_COUNT_READS)
def test_projection_count_is_zero_for_unknown_id(direct_deploy, method):
    c = direct_deploy(CONTRACT)
    make_promise(c)
    assert getattr(c, method)(9999) == 0


@pytest.mark.parametrize("method", PROJECTION_LIST_READS)
def test_projection_list_is_empty_for_unknown_id(direct_deploy, method):
    c = direct_deploy(CONTRACT)
    make_promise(c)

    value = getattr(c, method)(9999)
    # These return JSON strings so they are calldata-encodable.
    parsed = __import__("json").loads(value) if isinstance(value, str) else value
    assert parsed == []


def test_identity_read_rejects_zero(direct_deploy):
    """Zero is never a valid promise id, even on an empty contract."""
    c = direct_deploy(CONTRACT)
    _raises(c.get_promise, 0)


def test_unresolved_promise_has_no_provisional_or_final(direct_deploy):
    """A promise with no resolution raises rather than inventing one.

    This is the behaviour the deployed read certification observes as well: on a live node the
    read fails, which is why the certifier records this as a PASS rather than a fault.
    """
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)

    _raises(c.get_provisional_result, pid)
    _raises(c.get_final_result, pid)
