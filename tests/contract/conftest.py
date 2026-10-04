"""
Shared Direct Mode fixtures and helpers.

Deadlines are expressed relative to the current (VM) time rather than as fixed calendar
dates, because the contract correctly refuses to accept a promise whose deadline has
already passed. Tests that need an elapsed deadline create first, then travel forward
with `advance_past_deadline`.
"""

from __future__ import annotations

import datetime as dt

import pytest

CONTRACT = "contracts/PromiseDecay.py"

NOW = int(dt.datetime.now(dt.timezone.utc).timestamp())

# Just ahead of now: far enough to create, close enough that a short time-travel
# in `advance_past_deadline` makes the deadline elapse.
FUTURE = NOW + 60

# Comfortably in the past: must be rejected at creation time.
PAST = NOW - 86400


def make_promise(
    deployed,
    promise_deadline: int = FUTURE,
    project: str = "Acme Protocol",
    quote: str = "Public mainnet will launch before September 30.",
    url: str = "https://acme.example/blog/mainnet",
):
    """Create a promise with valid DNA. Returns the allocated promise id."""
    return deployed.create_promise(
        project,
        "Acme Foundation",
        quote,
        "launch",
        "public mainnet",
        "public",
        promise_deadline,
        "subject to final audit",
        url,
    )


@pytest.fixture
def promise_id(direct_deploy):
    """A deployed contract with one promise created. Returns (contract, promise_id)."""
    contract = direct_deploy(CONTRACT)
    return contract, make_promise(contract)