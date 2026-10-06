"""Regression coverage for the shared, bounded GenLayer decision-input builder."""

from __future__ import annotations

import json

import pytest

from conftest import CONTRACT, make_promise
from test_resolution import advance_past_deadline, decision, jump_past_window


def _decision_with(delivery, integrity, *, deadline_met, scope_change, explanation):
    return json.dumps(
        {
            "delivery": delivery,
            "integrity": integrity,
            "deadline_met": deadline_met,
            "material_scope_change": scope_change,
            "explanation": explanation,
        }
    )


def _add_old_evidence(c, pid, rows):
    for url, quote in rows:
        c.add_evidence(pid, url, quote, "SOURCE")


@pytest.mark.parametrize(
    "order",
    [
        ("a", "b", "c", "d"),
        ("d", "c", "b", "a"),
    ],
)
def test_initial_decision_keeps_original_and_relevant_drift_outside_first_three(
    direct_deploy, direct_vm, order
):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    rows = {
        "a": ("https://evidence.example/a", "First unrelated source statement."),
        "b": ("https://evidence.example/b", "Second unrelated source statement."),
        "c": ("https://evidence.example/c", "Third unrelated source statement."),
        "d": ("https://evidence.example/d", "Fourth unrelated source statement."),
    }
    _add_old_evidence(c, pid, [rows[key] for key in order])
    c.add_drift(
        pid,
        "The launch moved to selected partners only.",
        "https://acme.example/blog/revised-scope",
    )

    direct_vm.mock_web(r".*", {"body": "RETRIEVED_FACT"})
    direct_vm.mock_llm(
        r"(?s)(?=.*\[ORIGINAL_SOURCE\].*Public mainnet will launch)"
        r"(?=.*\[ORIGINAL_SOURCE https://acme\.example/blog/mainnet\])"
        r"(?=.*\[DRIFT_OR_QUOTATION\].*selected partners only)"
        r"(?=.*\[DRIFT_OR_QUOTATION https://acme\.example/blog/revised-scope\]).*",
        decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True),
    )
    advance_past_deadline(direct_vm)

    c.request_resolution(pid)

    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"
    assert c.get_provisional_result(pid)["delivery"] == "PARTIAL"


def test_duplicate_supplemental_text_does_not_crowd_out_mandatory_inputs(
    direct_deploy, direct_vm
):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    _add_old_evidence(
        c,
        pid,
        [
            (f"https://evidence.example/copy-{i}", "Repeated supplemental finding.")
            for i in range(6)
        ],
    )
    c.add_drift(pid, "The public release narrowed to selected partners.", "https://acme.example/drift")
    direct_vm.mock_web(r".*", {"body": "Page text."})
    direct_vm.mock_llm(
        r"(?s)^(?=.*\[ORIGINAL_SOURCE\])(?=.*\[DRIFT_OR_QUOTATION\])"
        r"(?!.*(?:\[SUPPLEMENTAL_EVIDENCE\] Repeated supplemental finding\..*){2}).*$",
        decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True),
    )
    advance_past_deadline(direct_vm)

    c.request_resolution(pid)

    assert c.get_provisional_result(pid)["integrity"] == "NARROWED"


def test_full_prompt_stays_within_the_runtime_bound_with_mandatory_inputs(
    direct_deploy, direct_vm
):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    _add_old_evidence(
        c,
        pid,
        [
            (f"https://evidence.example/large-{i}", f"Evidence quote {i}: " + "x" * 100)
            for i in range(64)
        ],
    )
    c.add_drift(pid, "The launch narrowed to selected partners only.", "https://acme.example/drift")
    direct_vm.mock_web(r".*", {"body": "PAGE_FACT " + "x" * 4000})
    direct_vm.mock_llm(
        r"(?s)^(?![\s\S]{16001,})(?!.*\[CHALLENGE_EVIDENCE\])"
        r"(?=.*\[ORIGINAL_SOURCE\]).*$",
        decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True),
    )
    advance_past_deadline(direct_vm)
    c.request_resolution(pid)

    c.challenge(
        pid,
        "The newest postmortem proves the public launch happened after the deadline.",
        "https://evidence.example/latest-large-challenge",
    )
    direct_vm.clear_mocks()
    direct_vm.mock_web(
        r"https://evidence\.example/latest-large-challenge",
        {"body": "LATEST_CHALLENGE_FACT " + "x" * 4000},
    )
    direct_vm.mock_web(r".*", {"body": "PAGE_FACT " + "x" * 4000})
    direct_vm.mock_llm(
        r"(?s)^(?![\s\S]{16001,})"
        r"(?=.*\[CHALLENGE_EVIDENCE\] The newest postmortem)"
        r"(?=.*LATEST_CHALLENGE_FACT).*$",
        decision("KEPT_LATE", "UNCHANGED", deadline_met=False),
    )

    c.re_evaluate(pid)

    assert c.get_provisional_result(pid)["delivery"] == "KEPT_LATE"


def test_re_evaluation_uses_the_shared_inputs_and_latest_challenge_for_a_fresh_verdict(
    direct_deploy, direct_vm
):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    _add_old_evidence(
        c,
        pid,
        [
            (f"https://evidence.example/old-{i}", f"Old source quote number {i}.")
            for i in range(64)
        ],
    )
    c.add_drift(pid, "The public release narrowed to selected partners.", "https://acme.example/drift")

    direct_vm.mock_web(
        r"https://evidence\.example/latest-challenge",
        {"body": "POSTMORTEM_FACT: the full public launch completed after the deadline."},
    )
    direct_vm.mock_web(r".*", {"body": "Earlier pages do not establish a public launch."})
    direct_vm.mock_llm(
        r"(?s)^(?!.*\[CHALLENGE_EVIDENCE\])"
        r"(?=.*\[ORIGINAL_SOURCE https://acme\.example/blog/mainnet\])"
        r"(?=.*\[DRIFT_OR_QUOTATION https://acme\.example/drift\]).*$",
        decision("UNRESOLVED", "UNKNOWN", deadline_met=False),
    )
    direct_vm.mock_llm(
        r"(?s)(?=.*\[CHALLENGE_EVIDENCE\] The postmortem confirms a public release.)"
        r"(?=.*\[CHALLENGE_EVIDENCE https://evidence\.example/latest-challenge\])"
        r"(?=.*POSTMORTEM_FACT: the full public launch completed after the deadline)"
        r"(?=.*\[ORIGINAL_SOURCE https://acme\.example/blog/mainnet\])"
        r"(?=.*\[DRIFT_OR_QUOTATION https://acme\.example/drift\]).*",
        _decision_with(
            "KEPT_LATE",
            "UNCHANGED",
            deadline_met=False,
            scope_change=False,
            explanation="The latest postmortem confirms the full public launch happened late.",
        ),
    )
    advance_past_deadline(direct_vm)
    c.request_resolution(pid)
    first = c.get_provisional_result(pid)
    assert first["delivery"] == "UNRESOLVED"

    c.challenge(
        pid,
        "The postmortem confirms a public release.",
        "https://evidence.example/latest-challenge",
    )
    assert c.get_lifecycle_status(pid) == "RESOLVING"
    assert c.get_evidence_count(pid) == 64  # challenge evidence lives in its own record at capacity
    with pytest.raises(Exception):
        c.finalize(pid)

    c.re_evaluate(pid)
    fresh = c.get_provisional_result(pid)
    assert fresh["delivery"] == "KEPT_LATE"
    assert fresh["integrity"] == "UNCHANGED"
    assert fresh != first
    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"

    jump_past_window(direct_vm)
    c.finalize(pid)
    assert c.get_lifecycle_status(pid) == "FINAL"
    assert c.get_final_result(pid)["delivery"] == "KEPT_LATE"


def test_second_challenge_evaluates_the_newest_evidence_not_the_first_round(
    direct_deploy, direct_vm
):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    direct_vm.mock_web(
        r"https://evidence\.example/second-round",
        {"body": "LATEST_FACT: the public mainnet launched after the deadline."},
    )
    direct_vm.mock_web(r".*", {"body": "No confirmed public launch."})
    direct_vm.mock_llm(
        r"(?s)^(?!.*\[CHALLENGE_EVIDENCE\]).*$",
        decision("UNRESOLVED", "UNKNOWN", deadline_met=False),
    )
    direct_vm.mock_llm(
        r"(?s)(?=.*\[CHALLENGE_EVIDENCE\] First round says only partners received access.)"
        r"(?!.*Second round proves the launch was public).*$",
        decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True),
    )
    direct_vm.mock_llm(
        r"(?s)(?=.*\[CHALLENGE_EVIDENCE\] Second round proves the launch was public)"
        r"(?=.*\[CHALLENGE_EVIDENCE https://evidence\.example/second-round\])"
        r"(?=.*LATEST_FACT: the public mainnet launched after the deadline).*",
        _decision_with(
            "KEPT_LATE",
            "UNCHANGED",
            deadline_met=False,
            scope_change=False,
            explanation="The newest evidence proves the promise was fulfilled after the deadline.",
        ),
    )
    c.request_resolution(pid)
    c.challenge(
        pid,
        "First round says only partners received access.",
        "https://evidence.example/first-round",
    )
    c.re_evaluate(pid)
    c.challenge(
        pid,
        "Second round proves the launch was public.",
        "https://evidence.example/second-round",
    )

    c.re_evaluate(pid)

    assert c.get_provisional_result(pid)["delivery"] == "KEPT_LATE"


def test_second_challenge_waits_until_the_pending_challenge_is_evaluated(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    direct_vm.mock_web(r".*", {"body": "Fact page."})
    direct_vm.mock_llm(
        r"(?s)^(?!.*\[CHALLENGE_EVIDENCE\]).*$",
        decision("UNRESOLVED", "UNKNOWN", deadline_met=False),
    )
    c.request_resolution(pid)
    c.challenge(
        pid,
        "A first challenge with distinct evidence is recorded.",
        "https://evidence.example/first-pending",
    )

    with pytest.raises(Exception):
        c.challenge(
            pid,
            "A second challenge cannot skip the pending re-evaluation.",
            "https://evidence.example/second-pending",
        )

    assert c.get_challenge_count(pid) == 1


def test_pending_challenge_can_be_evaluated_after_the_previous_window_closes(
    direct_deploy, direct_vm
):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    direct_vm.mock_web(r".*", {"body": "The public launch happened late."})
    direct_vm.mock_llm(
        r"(?s)^(?!.*\[CHALLENGE_EVIDENCE\]).*$",
        decision("UNRESOLVED", "UNKNOWN", deadline_met=False),
    )
    direct_vm.mock_llm(
        r"(?s)(?=.*\[CHALLENGE_EVIDENCE\] A source confirms the public launch happened late).*$",
        _decision_with(
            "KEPT_LATE",
            "UNCHANGED",
            deadline_met=False,
            scope_change=False,
            explanation="The evidence confirms delivery after the deadline.",
        ),
    )
    c.request_resolution(pid)
    c.challenge(
        pid,
        "A source confirms the public launch happened late.",
        "https://evidence.example/late-public-launch",
    )
    jump_past_window(direct_vm)

    c.re_evaluate(pid)

    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"
    assert c.get_provisional_result(pid)["delivery"] == "KEPT_LATE"
    with pytest.raises(Exception):
        c.finalize(pid)
