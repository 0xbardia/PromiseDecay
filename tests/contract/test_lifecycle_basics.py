"""Construction, reads, promise creation and immutability."""

from __future__ import annotations

import datetime as dt

import pytest

from conftest import CONTRACT, FUTURE, make_promise  # noqa: F401


def test_deploy_and_version(direct_deploy):
    c = direct_deploy(CONTRACT)
    assert c.get_version() == "1.0.0"


def test_config_exposes_bounds_and_enums(direct_deploy):
    c = direct_deploy(CONTRACT)
    cfg = c.get_config()
    assert cfg["contract_version"] == "1.0.0"
    assert cfg["max_quote"] == 1200
    assert cfg["challenge_window_seconds"] == 7 * 24 * 60 * 60
    assert "PARTIAL" in cfg["delivery_values"]
    assert "NARROWED" in cfg["integrity_values"]
    assert "FINAL" in cfg["lifecycle_values"]


def test_promise_count_starts_at_zero(direct_deploy):
    c = direct_deploy(CONTRACT)
    assert c.get_promise_count() == 0


def test_create_promise_returns_id_and_stores_dna(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)

    assert pid == 1
    assert c.get_promise_count() == 1

    dna = c.get_promise(pid)
    assert dna["project"] == "Acme Protocol"
    assert dna["original_quote"] == "Public mainnet will launch before September 30."
    assert dna["action"] == "launch"
    assert dna["scope"] == "public"
    assert int(dna["deadline_ts"]) == FUTURE
    assert dna["contract_version"] == "1.0.0"
    assert int(dna["created_ts"]) > 0
    assert dna["creator"] != ""


def test_promise_ids_never_collide(direct_deploy):
    c = direct_deploy(CONTRACT)
    ids = [make_promise(c, project="P%d" % i) for i in range(5)]
    assert len(set(ids)) == 5
    assert ids == sorted(ids)


def test_original_promise_is_immutable(direct_deploy):
    """The DNA must be byte-identical after later writes happen."""
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    before = dict(c.get_promise(pid))

    c.add_drift(pid, "Mainnet rollout begins in September", "https://acme.example/blog/rollout")
    c.add_evidence(pid, "https://acme.example/evidence/1", "Shipped to partners only.", "SOURCE")
    c.submit_response(pid, "We shipped a limited beta.", "https://acme.example/blog/beta")

    after = dict(c.get_promise(pid))
    assert after == before


def test_invalid_promise_id_fails_clearly(direct_deploy):
    c = direct_deploy(CONTRACT)
    with pytest.raises(Exception):
        c.get_promise(999)


def test_all_promise_ids(direct_deploy):
    c = direct_deploy(CONTRACT)
    ids = [make_promise(c, project="P%d" % i) for i in range(3)]
    listed = list(c.get_all_promise_ids())
    assert sorted(listed) == sorted(ids)


def test_timestamps_are_readable(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    assert int(c.get_created_at(pid)) == int(c.get_promise(pid)["created_ts"])
    assert int(c.get_deadline_at(pid)) == FUTURE


def test_challenge_window_defaults_to_closed(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    win = c.get_challenge_window(pid)
    assert int(win["challenge_closes_at"]) == 0
    assert win["window_seconds"] == 7 * 24 * 60 * 60