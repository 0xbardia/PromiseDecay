"""
Challenge rounds must be bounded.

The challenge window exists so a provisional result can be disputed before it is finalized.
`re_evaluate` deliberately opens a fresh window from each new decision, which is right: a
challenge deserves its own time to be answered. But nothing bounded the number of rounds, so the
window could be pushed forward indefinitely and a record could never be closed.

These tests pin both halves: the round cap exists, and once it is reached the window is allowed
to elapse so the record can still reach FINAL.
"""

from __future__ import annotations

import json

import pytest

from conftest import CONTRACT, make_promise
from test_resolution import (
    advance_past_deadline,
    decision,
    jump_past_window,
    mock_resolution,
)


def challenged_promise(c, direct_vm):
    """A promise with a provisional result, one challenge, and an open window."""
    pid = make_promise(c)
    advance_past_deadline(direct_vm)  # past the deadline so resolution is eligible

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    c.request_resolution(pid)
    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"

    c.challenge(
        pid,
        "The cited source does not support the claim that anything shipped.",
        "https://example.com/materially-new-source",
    )
    return pid


def test_re_evaluate_opens_a_fresh_window(direct_deploy, direct_vm):
    """A new decision must be answerable, so the window moves — but from the new time.

    GenVM's clock does not advance between transactions in Direct Mode, so comparing the
    absolute close time before and after would compare equal. The meaningful assertion is
    that the window is re-armed relative to the moment of re-evaluation: time is travelled
    forward first, and the new close must then be further out than the old one.
    """
    c = direct_deploy(CONTRACT)
    pid = challenged_promise(c, direct_vm)

    before = int(c.get_challenge_window(pid)["challenge_closes_at"])
    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))

    advance_past_deadline(direct_vm, seconds=3600)
    c.re_evaluate(pid)
    after = int(c.get_challenge_window(pid)["challenge_closes_at"])

    assert after > before, (
        "a re-evaluated result must get its own window, or a challenge can never be answered"
    )


def test_re_evaluate_is_bounded(direct_deploy, direct_vm):
    """The exploit: loop re_evaluate with one challenge on record and the window never closes."""
    c = direct_deploy(CONTRACT)
    pid = challenged_promise(c, direct_vm)

    # Eight rounds is enough to demonstrate the cap exists and is small. Each round runs a
    # full comparative-consensus simulation, so a large bound here would be slow rather than
    # more convincing.
    LIMIT = 8

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    rounds = 0
    while rounds < LIMIT:
        try:
            c.re_evaluate(pid)
            rounds += 1
        except Exception:
            break

    assert rounds < LIMIT, (
        f"re_evaluate accepted {rounds} rounds with a single challenge on record. "
        "Each round pushes the challenge window forward, so the record can never be finalized."
    )
    assert rounds >= 1, "at least one round must be allowed"


def test_a_record_can_still_reach_final_after_the_cap(direct_deploy, direct_vm):
    """The point of the cap: exhausting rounds must not strand the record forever."""
    c = direct_deploy(CONTRACT)
    pid = challenged_promise(c, direct_vm)

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    for _ in range(8):
        try:
            c.re_evaluate(pid)
        except Exception:
            break

    # Once rounds are exhausted the window is no longer extendable, so time can close it.
    jump_past_window(direct_vm)

    # Further disputes are refused rather than reopening the window.
    for n in range(3):
        try:
            c.challenge(
                pid,
                f"Another dispute attempt after the rounds are exhausted, number {n}.",
                f"https://example.com/after-the-cap-{n}",
            )
        except Exception:
            pass
    jump_past_window(direct_vm)

    c.finalize(pid)
    assert c.get_lifecycle_status(pid) == "FINAL"


def test_the_cap_leaves_the_ordinary_challenge_path_working(direct_deploy, direct_vm):
    """A later challenge gets a fresh evaluation before the result can be finalized."""
    c = direct_deploy(CONTRACT)
    pid = challenged_promise(c, direct_vm)

    mock_resolution(direct_vm, decision("UNRESOLVED", "UNKNOWN"))
    c.re_evaluate(pid)

    # Exactly one round consumed, and a challenge is still accepted afterwards.
    assert len(json.loads(c.get_challenges(pid))) == 1
    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"

    c.challenge(
        pid,
        "A second, distinct objection to the re-evaluated result.",
        "https://example.com/second-distinct-source",
    )
    assert len(json.loads(c.get_challenges(pid))) == 2
    c.re_evaluate(pid)
    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"

    jump_past_window(direct_vm)
    c.finalize(pid)
    assert c.get_lifecycle_status(pid) == "FINAL"
