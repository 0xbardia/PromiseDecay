"""
Replay of the live-certification fixture (apps/web/scripts/live-fixture.mjs) in Direct Mode.

The live run is judged against this prediction: four neutral evidence items are stored before
anything else, so the pre-1.0.1 "first three evidence URLs" rule would have fetched only those.
The corrected rule must instead reach the original source, the newest relevant drift sources
and, on re-evaluation, the newest challenge, whatever the insertion order.
"""

from __future__ import annotations

import datetime as dt

from conftest import CONTRACT, make_promise
from test_resolution import advance_past_deadline, decision

BASE = "https://promisedecay.bydx.fun/fixtures/replay"


def _tick(vm, seconds=7):
    now = dt.datetime.fromisoformat(vm._datetime.replace("Z", "+00:00"))
    vm.warp((now + dt.timedelta(seconds=seconds)).isoformat())


def _seed(c, vm):
    pid = make_promise(
        c,
        quote="Meridian Labs will make the Aurora SDK v2 publicly available to all developers before the deadline.",
        url=f"{BASE}/announcement.html",
    )
    for key in ("d", "c", "b", "a"):
        c.add_evidence(pid, f"{BASE}/ev-{key}.html", f"Neutral changelog item {key.upper()}.", "SOURCE")
    for statement, page in (
        ("Meridian Labs update: Aurora SDK v2 is currently available to selected design partners only.", "partner-update"),
        ("Meridian Labs shared photographs from its team offsite.", "offsite"),
        ("Meridian Labs beta notice: the Aurora SDK v2 beta is limited to invited partners.", "invite-beta"),
    ):
        _tick(vm)
        c.add_drift(pid, statement, f"{BASE}/{page}.html")
    return pid


def test_fixture_drift_is_classified_as_the_live_run_expects(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = _seed(c, direct_vm)
    import json

    relations = {d["source_url"].rsplit("/", 1)[1]: d["relationship"] for d in json.loads(c.get_drift(pid))}
    assert relations == {
        "partner-update.html": "NARROWED",
        "offsite.html": "UNRELATED",
        "invite-beta.html": "NARROWED",
    }


def test_fixture_selects_mandatory_sources_under_insertion_order_pressure(direct_deploy, direct_vm):
    c = direct_deploy(CONTRACT)
    pid = _seed(c, direct_vm)

    direct_vm.mock_web(r".*", {"body": "PAGE_TEXT"})
    # Initial evaluation: original, then the two relevant drift sources newest-first.
    # No neutral evidence page is fetched, and the unrelated drift source never is.
    direct_vm.mock_llm(
        r"(?s)^(?=.*\[ORIGINAL_SOURCE " + BASE + r"/announcement\.html\])"
        r"(?=.*\[DRIFT_OR_QUOTATION " + BASE + r"/invite-beta\.html\])"
        r"(?=.*\[DRIFT_OR_QUOTATION " + BASE + r"/partner-update\.html\])"
        r"(?!.*" + BASE + r"/ev-)(?!.*" + BASE + r"/offsite\.html\]).*$",
        decision("PARTIAL", "NARROWED", deadline_met=False, scope_change=True),
    )
    advance_past_deadline(direct_vm)
    c.request_resolution(pid)
    assert c.get_provisional_result(pid)["delivery"] == "PARTIAL"

    c.challenge(
        pid,
        "Aurora SDK v2.0.0 was published to the public package registry before the deadline.",
        f"{BASE}/release-notes.html",
    )
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"body": "PAGE_TEXT"})
    # Re-evaluation: original, the newest challenge, then the newest relevant drift only.
    direct_vm.mock_llm(
        r"(?s)^(?=.*\[ORIGINAL_SOURCE " + BASE + r"/announcement\.html\])"
        r"(?=.*\[CHALLENGE_EVIDENCE " + BASE + r"/release-notes\.html\])"
        r"(?=.*\[CHALLENGE_EVIDENCE\] Aurora SDK v2\.0\.0 was published)"
        r"(?=.*\[DRIFT_OR_QUOTATION " + BASE + r"/invite-beta\.html\])"
        r"(?!.*\[DRIFT_OR_QUOTATION " + BASE + r"/partner-update\.html\])"
        r"(?!.*" + BASE + r"/ev-).*$",
        decision("KEPT", "UNCHANGED", deadline_met=True),
    )
    c.re_evaluate(pid)
    fresh = c.get_provisional_result(pid)
    assert fresh["delivery"] == "KEPT"
    assert fresh["delivery"] != "PARTIAL"
