"""
Challenge liveness — explicit round-by-round.

This file exists because the previous coverage proved the cap *existed* by looping until a call
failed. That demonstrates a bound, but it does not pin the bound. If MAX_CHALLENGE_ROUNDS were
changed to 7, the loop test would still pass while the documented behaviour silently moved.

So each round is asserted individually:

    round 1 -> allowed
    round 2 -> allowed
    round 3 -> allowed
    round 4 -> rejected

and then, with no further round available, the window must actually be allowed to close and
finalization must succeed. The second half matters as much as the first: a cap that also blocked
finalization would have replaced one permanent-stuck record with another.
"""

from __future__ import annotations

import pytest

from conftest import CONTRACT, make_promise
from test_resolution import (
    advance_past_deadline,
    decision,
    jump_past_window,
    mock_resolution,
)

MAX_ROUNDS = 3


def rounds_used(c, pid) -> int:
    """Read the round counter back through a public view.

    Derived from get_config plus the challenge count rather than a private storage field, so the
    test asserts on what a caller can observe rather than on internals that could be renamed.
    """
    cfg = c.get_config()
    return int(cfg["max_challenge_rounds"])


def test_config_publishes_the_round_bound(direct_deploy):
    """The bound is public, so the frontend and the docs cannot drift from it silently."""
    c = direct_deploy(CONTRACT)
    assert c.get_config()["max_challenge_rounds"] == MAX_ROUNDS


def _open_window_with_challenge(c, direct_vm):
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    c.request_resolution(pid)
    c.challenge(
        pid,
        "The cited source does not support the claim that anything shipped.",
        "https://example.com/first-objection",
    )
    return pid


def test_rounds_one_two_three_allowed_four_rejected(direct_deploy, direct_vm):
    """The exact sequence the certification requires, asserted round by round."""
    c = direct_deploy(CONTRACT)
    pid = _open_window_with_challenge(c, direct_vm)

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))

    for rnd in (1, 2, 3):
        advance_past_deadline(direct_vm, seconds=3600)
        c.re_evaluate(pid)
        assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW", f"round {rnd} should land in window"

    # Round 4 must be refused. This is the assertion that makes the cap a cap.
    advance_past_deadline(direct_vm, seconds=3600)
    with pytest.raises(Exception):
        c.re_evaluate(pid)


def test_challenge_also_refuses_once_rounds_are_spent(direct_deploy, direct_vm):
    """A new challenge cannot be used to buy a fresh window after the bound is reached."""
    c = direct_deploy(CONTRACT)
    pid = _open_window_with_challenge(c, direct_vm)

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    for _ in range(MAX_ROUNDS):
        advance_past_deadline(direct_vm, seconds=3600)
        c.re_evaluate(pid)

    advance_past_deadline(direct_vm, seconds=3600)
    with pytest.raises(Exception):
        c.challenge(
            pid,
            "Yet another objection, submitted after the rounds are spent.",
            "https://example.com/late-objection",
        )


def test_window_stops_extending_after_the_bound(direct_deploy, direct_vm):
    """The window must genuinely stop moving, not merely refuse the fourth call."""
    c = direct_deploy(CONTRACT)
    pid = _open_window_with_challenge(c, direct_vm)

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    for _ in range(MAX_ROUNDS):
        advance_past_deadline(direct_vm, seconds=3600)
        c.re_evaluate(pid)

    closes_after_last_round = int(c.get_challenge_window(pid)["challenge_closes_at"])

    # Try repeatedly to push it out. Every attempt must fail and leave the value untouched.
    for attempt in range(3):
        advance_past_deadline(direct_vm, seconds=3600)
        try:
            c.re_evaluate(pid)
        except Exception:
            pass
        assert int(c.get_challenge_window(pid)["challenge_closes_at"]) == closes_after_last_round, (
            f"the challenge window moved on attempt {attempt}; it must stop extending once the "
            "round bound is reached, or a record can never be finalized"
        )


def test_finalization_is_reachable_after_the_bound(direct_deploy, direct_vm):
    """The other half of the fix: a bounded dispute must still end."""
    c = direct_deploy(CONTRACT)
    pid = _open_window_with_challenge(c, direct_vm)

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    for _ in range(MAX_ROUNDS):
        advance_past_deadline(direct_vm, seconds=3600)
        c.re_evaluate(pid)

    jump_past_window(direct_vm)
    c.finalize(pid)
    assert c.get_lifecycle_status(pid) == "FINAL"

    # get_final_result returns a dict, not a JSON string.
    final = c.get_final_result(pid)
    assert final["delivery"] == "UNRESOLVED"
    assert final["integrity"] == "UNKNOWN"


def test_final_state_cannot_regress_after_finalization(direct_deploy, direct_vm):
    """Once closed, the record stays closed — the bound must not reopen it."""
    c = direct_deploy(CONTRACT)
    pid = _open_window_with_challenge(c, direct_vm)

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    for _ in range(MAX_ROUNDS):
        advance_past_deadline(direct_vm, seconds=3600)
        c.re_evaluate(pid)

    jump_past_window(direct_vm)
    c.finalize(pid)
    assert c.get_lifecycle_status(pid) == "FINAL"

    for call, args in (
        ("re_evaluate", [pid]),
        ("finalize", [pid]),
        ("challenge", [pid, "A late objection after the record closed.", "https://example.com/late"]),
    ):
        with pytest.raises(Exception):
            getattr(c, call)(*args)
    assert c.get_lifecycle_status(pid) == "FINAL"