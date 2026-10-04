"""
Drift relationship classification.

`_classify_relation` is a deterministic UI hint — it never influences delivery or integrity,
which come from consensus. That makes it low-stakes by design, but also means a hint that
misreports a statement is simply wrong output with nothing to catch it.

These tests pin the behaviour that was actually wrong: plain substring matching, where "may"
fired on "dismay", "aim" on "reclaim", and "partner" on "counterpart".
"""

from __future__ import annotations

import json

from conftest import CONTRACT, make_promise

R_REVERSED = "REVERSED"
R_NARROWED = "NARROWED"
R_REFRAMED = "REFRAMED"
R_SOFTENED = "SOFTENED"
R_UNRELATED = "UNRELATED"


def relationship_for(c, statement: str) -> str:
    """Attach a drift statement and read back the classified relationship."""
    pid = make_promise(c)
    c.add_drift(pid, statement, "https://example.com/statement")
    entries = json.loads(c.get_drift(pid))
    return entries[-1]["relationship"]


def test_keyword_stemming_still_matches(direct_deploy):
    """Inflected forms must still be recognised — that is why stems are used at all."""
    c = direct_deploy(CONTRACT)
    assert relationship_for(c, "We have reversed the earlier announcement") == R_REVERSED
    assert relationship_for(c, "Access is now limited to partners") == R_NARROWED
    assert relationship_for(c, "We reframe what the audit covers") == R_REFRAMED
    assert relationship_for(c, "We hope to ship in the future") == R_SOFTENED


def test_multiword_markers_still_match(direct_deploy):
    c = direct_deploy(CONTRACT)
    assert relationship_for(c, "We will not deliver this") == R_REVERSED
    assert relationship_for(c, "Release is only for a few integrators") == R_NARROWED
    assert relationship_for(c, "Here is what we mean by done") == R_REFRAMED


def test_substrings_inside_unrelated_words_do_not_match(direct_deploy):
    """The regression that motivated word-boundary matching.

    Every statement below contains a marker only as a fragment of a longer word. Under plain
    substring matching each was mislabelled; all are genuinely unrelated to the promise's
    direction, so the honest answer is UNRELATED.
    """
    c = direct_deploy(CONTRACT)

    # "dismay" contains "may" — must not read as SOFTENED.
    assert relationship_for(c, "The delay did not dismay investors") == R_UNRELATED
    # "Mayfield" contains "may".
    assert relationship_for(c, "A note from the Mayfield office") == R_UNRELATED
    # "reclaim" contains "aim" — must not read as SOFTENED.
    assert relationship_for(c, "We will reclaim the abandoned funds") == R_UNRELATED
    # "counterpart" contains "partner".
    assert relationship_for(c, "Filed with the regulator as a counterpart filing") == R_UNRELATED
    # "clarified" is a stem and SHOULD match; "clarity" too. Guard against over-tightening.
    assert relationship_for(c, "We clarified the scope") == R_REFRAMED


def test_neutral_statements_are_unrelated(direct_deploy):
    c = direct_deploy(CONTRACT)
    assert relationship_for(c, "The audit report is now published on our site") == R_UNRELATED


def test_classification_is_ordered_most_specific_first(direct_deploy):
    """A reversal that also mentions narrowing is reported as a reversal.

    Order encodes severity, so the strongest signal wins. Pinned because reordering these
    blocks would silently change every verdict the UI shows.
    """
    c = direct_deploy(CONTRACT)
    statement = "We are reversing the launch and limiting access to selected partners"
    assert relationship_for(c, statement) == R_REVERSED
