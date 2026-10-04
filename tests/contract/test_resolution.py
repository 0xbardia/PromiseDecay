"""
Resolution, lifecycle transitions, challenge window and finalization.
"""

from __future__ import annotations

import datetime as dt
import json

import pytest

from conftest import CONTRACT, FUTURE, PAST, make_promise

WINDOW = 7 * 24 * 60 * 60


def ts(y: int, mo: int, d: int) -> int:
    return int(dt.datetime(y, mo, d, tzinfo=dt.timezone.utc).timestamp())


def advance_past_deadline(vm, seconds: int = 600):
    """
    Move GenVM transaction time forward.

    Promises are always created with a FUTURE deadline (the contract enforces it), so a
    test that needs an elapsed deadline must create first and then travel forward. This
    mirrors the real lifecycle rather than fabricating a past-dated promise.
    """
    now = dt.datetime.fromisoformat(vm._datetime.replace("Z", "+00:00"))
    vm.warp((now + dt.timedelta(seconds=seconds)).isoformat())


def jump_past_window(vm, window: int = WINDOW):
    """Travel beyond the challenge window so finalization becomes eligible."""
    now = dt.datetime.fromisoformat(vm._datetime.replace("Z", "+00:00"))
    vm.warp((now + dt.timedelta(seconds=window + 60)).isoformat())


def decision(delivery: str, integrity: str, **kw):
    payload = {
        "delivery": delivery,
        "integrity": integrity,
        "deadline_met": kw.get("deadline_met", True),
        "material_scope_change": kw.get("scope_change", False),
        "explanation": kw.get("explanation", "Evidence shows the launch reached partners only."),
    }
    return json.dumps(payload)


def mock_resolution(vm, payload: str, page: str = "Acme launched mainnet to partners."):
    """Mock web + LLM so a resolution can run without network access."""
    vm.mock_web(r".*", {"body": page, "status_code": 200})
    vm.mock_llm(r".*", payload)


# ---------------------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------------------


def test_resolution_blocked_before_deadline(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c, promise_deadline=FUTURE)
    with pytest.raises(Exception):
        c.request_resolution(pid)


def test_resolution_allowed_after_deadline(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("PARTIAL", "NARROWED", scope_change=True))
    c.request_resolution(pid)
    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"


def test_cannot_create_promise_with_deadline_in_the_past(direct_deploy):
    c = direct_deploy(CONTRACT)
    with pytest.raises(Exception):
        make_promise(c, promise_deadline=PAST)


def test_promise_starts_open(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    assert c.get_lifecycle_status(pid) == "OPEN"


def test_second_resolution_rejected(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)
    with pytest.raises(Exception):
        c.request_resolution(pid)


# ---------------------------------------------------------------------------------------
# Delivery / integrity enums
# ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "delivery,integrity,dm,sc",
    [
        ("KEPT", "UNCHANGED", True, False),
        # KEPT_LATE means the deadline was missed, so deadline_met must be false.
        # This row previously asserted `True`, which the contract accepted only because its
        # guard for this case was dead code (see PD-SEC-021). The old value encoded the bug,
        # so it was corrected rather than preserved.
        ("KEPT_LATE", "UNCHANGED", False, False),
        # NOT_KEPT with the deadline met is coherent: the date passed, nothing was delivered.
        ("NOT_KEPT", "UNCHANGED", True, False),
        ("PARTIAL", "NARROWED", False, True),
        ("NOT_KEPT", "REVERSED", False, False),
        ("UNRESOLVED", "UNKNOWN", False, False),
        ("PARTIAL", "REFRAMED", False, True),
        ("KEPT", "UNKNOWN", True, False),
    ],
)
def test_all_delivery_and_integrity_states(
    direct_deploy, direct_vm, delivery, integrity, dm, sc
):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(
        direct_vm,
        decision(delivery, integrity, deadline_met=dm, scope_change=sc),
    )
    c.request_resolution(pid)
    prov = c.get_provisional_result(pid)
    assert prov["delivery"] == delivery
    assert prov["integrity"] == integrity
    assert prov["deadline_met"] is dm
    assert prov["material_scope_change"] is sc


def test_explanation_is_bounded(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED", explanation="x" * 5000))
    c.request_resolution(pid)
    assert len(c.get_provisional_result(pid)["explanation"]) <= 600


# ---------------------------------------------------------------------------------------
# Malformed / invalid consensus output must NOT write state
# ---------------------------------------------------------------------------------------


BAD_OUTPUTS = {
    "not json": "this is definitely not json",
    "json array": "[1,2,3]",
    "invalid delivery enum": json.dumps(
        {"delivery": "MOSTLY_KEPT", "integrity": "UNCHANGED", "deadline_met": True,
         "material_scope_change": False, "explanation": "x"}
    ),
    "invalid integrity enum": json.dumps(
        {"delivery": "KEPT", "integrity": "SORT_OF", "deadline_met": True,
         "material_scope_change": False, "explanation": "x"}
    ),
    "missing field": json.dumps({"delivery": "KEPT", "integrity": "UNCHANGED"}),
    "non boolean flag": json.dumps(
        {"delivery": "KEPT", "integrity": "UNCHANGED", "deadline_met": "yes",
         "material_scope_change": False, "explanation": "x"}
    ),
    "empty string": "",
    "incoherent kept": json.dumps(
        {"delivery": "KEPT", "integrity": "UNCHANGED", "deadline_met": False,
         "material_scope_change": False, "explanation": "x"}
    ),
    "incoherent unchanged": json.dumps(
        {"delivery": "PARTIAL", "integrity": "UNCHANGED", "deadline_met": False,
         "material_scope_change": True, "explanation": "x"}
    ),
    # KEPT_LATE claims the deadline was met, which is self-refuting: being late is the entire
    # meaning of the enum. Previously accepted, because the guard that should have caught this
    # was written with a condition that contradicted itself and could never fire.
    "incoherent kept_late": json.dumps(
        {"delivery": "KEPT_LATE", "integrity": "UNCHANGED", "deadline_met": True,
         "material_scope_change": False, "explanation": "x"}
    ),
}


@pytest.mark.parametrize("label,payload", BAD_OUTPUTS.items())
def test_malformed_llm_output_never_writes_state(direct_deploy, direct_vm, label, payload):
    """
    The critical security property: a shared incorrect validator answer must not be able
    to corrupt state. Malformed output aborts the transaction before any write.
    """
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    before_count = c.get_promise_count()

    mock_resolution(direct_vm, payload)

    with pytest.raises(Exception):
        c.request_resolution(pid)

    # No provisional result, no lifecycle advance to a resolution state, DNA intact.
    with pytest.raises(Exception):
        c.get_provisional_result(pid)
    assert c.get_lifecycle_status(pid) != "FINAL"
    assert c.get_promise_count() == before_count
    assert c.get_promise(pid)["original_quote"] == (
        "Public mainnet will launch before September 30."
    )


def test_markdown_fenced_json_is_accepted(direct_deploy, direct_vm):
    """Real models wrap JSON in fences; that is formatting, not malformedness."""
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(
        direct_vm,
        # deadline_met is stated explicitly: the helper defaults it to True, which is correct
        # for KEPT but self-refuting for KEPT_LATE.
        '```json\n'
        + decision("KEPT_LATE", "UNCHANGED", deadline_met=False)
        + "\n```",
    )
    c.request_resolution(pid)
    assert c.get_provisional_result(pid)["delivery"] == "KEPT_LATE"


# ---------------------------------------------------------------------------------------
# Challenge + finalization
# ---------------------------------------------------------------------------------------


def test_challenge_inside_window_records_and_reopens(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)

    c.challenge(
        pid,
        "The stated deadline was missed; the launch happened after September 30.",
        "https://evidence.example/new-postmortem",
    )
    assert c.get_challenge_count(pid) == 1
    assert c.get_lifecycle_status(pid) == "RESOLVING"
    assert len(json.loads(c.get_challenges(pid))) == 1


def test_challenge_requires_materially_new_evidence(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    c.add_evidence(pid, "https://evidence.example/report", "Launch completed on time.", "SOURCE")
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)

    with pytest.raises(Exception):
        c.challenge(
            pid,
            "Repeating the same evidence should not be allowed as a challenge.",
            "https://evidence.example/report",
        )


def test_challenge_requires_substantial_reason(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)
    with pytest.raises(Exception):
        c.challenge(pid, "no", "https://evidence.example/another-source")


def test_challenge_after_window_is_rejected(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)

    jump_past_window(direct_vm)

    with pytest.raises(Exception):
        c.challenge(
            pid,
            "Late challenge arriving after the window has already closed.",
            "https://evidence.example/late-arrival",
        )


def test_finalize_before_window_closes_is_rejected(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)

    with pytest.raises(Exception):
        c.finalize(pid)


def test_finalize_after_window_closes(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True))
    c.request_resolution(pid)

    jump_past_window(direct_vm)
    c.finalize(pid)

    assert c.get_lifecycle_status(pid) == "FINAL"
    final = c.get_final_result(pid)
    assert final["delivery"] == "PARTIAL"
    assert final["integrity"] == "NARROWED"


def test_final_result_never_regresses(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True))
    c.request_resolution(pid)
    jump_past_window(direct_vm)
    c.finalize(pid)

    settled = c.get_final_result(pid)

    # Every mutating path is closed after FINAL.
    with pytest.raises(Exception):
        c.finalize(pid)
    with pytest.raises(Exception):
        c.request_resolution(pid)
    with pytest.raises(Exception):
        c.re_evaluate(pid)
    with pytest.raises(Exception):
        c.add_evidence(pid, "https://evidence.example/post-final", "Late evidence.", "SOURCE")
    with pytest.raises(Exception):
        c.add_drift(pid, "A later statement after finalization.", "https://acme.example/late")

    assert c.get_final_result(pid) == settled


def test_re_evaluate_requires_a_challenge(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)
    with pytest.raises(Exception):
        c.re_evaluate(pid)


def test_re_evaluate_after_challenge_runs_consensus_again(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)

    c.challenge(
        pid,
        "The public launch did not reach the public; only partners got access.",
        "https://evidence.example/partner-only",
    )

    direct_vm.clear_mocks()
    mock_resolution(direct_vm, decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True))
    c.re_evaluate(pid)

    prov = c.get_provisional_result(pid)
    assert prov["delivery"] == "PARTIAL"
    assert prov["integrity"] == "NARROWED"
    assert c.get_lifecycle_status(pid) == "CHALLENGE_WINDOW"


def test_challenge_window_exposed(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    assert int(c.get_challenge_window(pid)["challenge_closes_at"]) == 0
    advance_past_deadline(direct_vm)
    mock_resolution(direct_vm, decision("KEPT", "UNCHANGED"))
    c.request_resolution(pid)
    win = c.get_challenge_window(pid)
    assert int(win["challenge_closes_at"]) > 0
    assert win["window_seconds"] == WINDOW


def test_finalize_without_provisional_rejected(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    with pytest.raises(Exception):
        c.finalize(pid)

def test_extra_fields_in_model_output_are_ignored(direct_deploy, direct_vm):
    """
    An attacker-shaped payload with extra keys must not gain any capability.

    Unknown keys are dropped: the stored result is assembled only from the five known
    decision fields, so `admin`, `storage_wipe` or any other injected key is inert.
    """
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    advance_past_deadline(direct_vm)

    mock_resolution(
        direct_vm,
        json.dumps(
            {
                "delivery": "KEPT",
                "integrity": "UNCHANGED",
                "deadline_met": True,
                "material_scope_change": False,
                "explanation": "Delivered on time.",
                "admin": True,
                "next_promise_id": 999,
                "grant_role": "owner",
            }
        ),
    )
    c.request_resolution(pid)

    prov = c.get_provisional_result(pid)
    assert prov["delivery"] == "KEPT"
    assert prov["integrity"] == "UNCHANGED"
    assert "admin" not in prov
    assert "grant_role" not in prov
    # The privileged keys had no effect on the contract's own counter.
    assert c.get_promise_count() == 1
