"""
URL admissibility and storage bounds.

The URL screen runs BEFORE any LLM is involved, so a rejected URL never reaches prompt
construction. These tests pin every rejection class, plus the boundaries that must still be
accepted — a screen that rejects too much is as broken as one that rejects too little.
"""

from __future__ import annotations

import pytest

from conftest import CONTRACT, FUTURE, make_promise

# --- must be rejected -------------------------------------------------------------------

REJECTED = [
    ("ftp://example.com/x", "scheme"),
    ("javascript:alert(1)", "scheme"),
    ("file:///etc/passwd", "scheme"),
    ("data:text/html,<script>", "scheme"),
    ("vbscript:msgbox", "scheme"),
    ("example.com/no-scheme", "scheme"),
    ("https://user:pass@example.com/x", "credentials"),
    ("https://user@example.com/x", "credentials"),
    ("http://localhost/x", "localhost"),
    ("http://foo.localhost/x", "localhost"),
    ("http://LOCALHOST:8080/x", "localhost"),
    ("http://127.0.0.1/x", "ip-literal"),
    ("http://127.0.0.1:8080/x", "ip-literal"),
    ("http://10.0.0.5/x", "ip-literal"),
    ("http://172.16.0.1/x", "ip-literal"),
    ("http://192.168.1.1/x", "ip-literal"),
    ("http://169.254.169.254/latest/meta-data", "ip-literal"),
    # Leading-zero octets are still addresses, and can be read as octal. Must be rejected.
    ("http://010.0.0.1/x", "ip-literal"),
    ("http://192.168.001.1/x", "ip-literal"),
    ("http://[::1]/x", "ip-literal"),
    ("http://[fe80::1]/x", "ip-literal"),
    ("https://example.com:22/", "unusual-port"),
    ("https://example.com:21/", "unusual-port"),
    ("https://example.com:99999/", "range"),
    ("https://example.com:0/", "range"),
    ("https://example.com:abc/", "invalid port"),
]

# --- must be accepted -------------------------------------------------------------------

ACCEPTED = [
    "https://example.com",
    "http://example.com",
    "https://example.com/blog/post",
    "https://example.com:443/x",
    "http://example.com:80/x",
    "https://example.com:8443/x",
    "https://sub.domain.example.co.uk/deep/path",
    "https://example.com/path?query=1&x=2#fragment",
    "https://example.com:8080",
]


def create_with_url(deployed, url: str):
    return deployed.create_promise(
        "Acme Protocol",
        "Acme Foundation",
        "A promise that will be recorded against this source.",
        "deliver",
        "something",
        "public",
        FUTURE,
        "none",
        url,
    )


@pytest.mark.parametrize("url", [u for u, _ in REJECTED])
def test_rejected_urls_are_refused(direct_deploy, url):
    c = direct_deploy(CONTRACT)
    with pytest.raises(Exception):
        create_with_url(c, url)


@pytest.mark.parametrize("url", ACCEPTED)
def test_accepted_urls_are_recorded_verbatim(direct_deploy, url):
    c = direct_deploy(CONTRACT)
    pid = create_with_url(c, url)
    assert c.get_promise(pid)["source_url"] == url


def test_over_long_url_is_refused(direct_deploy):
    c = direct_deploy(CONTRACT)
    long_url = "https://example.com/" + "a" * 600
    with pytest.raises(Exception):
        create_with_url(c, long_url)


def test_url_bounds_apply_to_evidence_and_drift_too(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)

    with pytest.raises(Exception):
        c.add_evidence(pid, "http://127.0.0.1/x", "evidence quote", "SOURCE")
    with pytest.raises(Exception):
        c.add_drift(pid, "a later statement here", "http://10.0.0.1/x")
    with pytest.raises(Exception):
        c.submit_response(pid, "a response here", "ftp://example.com/x")
    with pytest.raises(Exception):
        c.challenge(pid, "a sufficiently long challenge reason", "http://localhost/x")


# ---------------------------------------------------------------------------------------
# String and collection bounds
# ---------------------------------------------------------------------------------------


def test_quote_length_bounds(direct_deploy):
    c = direct_deploy(CONTRACT)
    with pytest.raises(Exception):
        make_promise(c, quote="x" * 1300)
    # Exactly at the bound is fine.
    pid = make_promise(c, quote="y" * 1200)
    assert len(c.get_promise(pid)["original_quote"]) == 1200


def test_short_field_bounds(direct_deploy):
    c = direct_deploy(CONTRACT)
    with pytest.raises(Exception):
        c.create_promise(
            "P" * 300,
            "Actor",
            "A valid quote for the promise.",
            "act",
            "obj",
            "scope",
            FUTURE,
            "none",
            "https://example.com/x",
        )


def test_empty_required_fields_rejected(direct_deploy):
    c = direct_deploy(CONTRACT)
    with pytest.raises(Exception):
        c.create_promise(
            "   ",  # project
            "Actor",
            "A valid quote for the promise.",
            "act",
            "obj",
            "scope",
            FUTURE,
            "none",
            "https://example.com/x",
        )


def test_evidence_quote_minimum(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    with pytest.raises(Exception):
        c.add_evidence(pid, "https://example.com/x", "ab", "SOURCE")


def test_invalid_evidence_kind_rejected(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    with pytest.raises(Exception):
        c.add_evidence(pid, "https://example.com/x", "a valid quote", "SOMETHING_ELSE")


def test_drift_statement_minimum(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    with pytest.raises(Exception):
        c.add_drift(pid, "short", "https://example.com/x")


def test_response_statement_minimum(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    with pytest.raises(Exception):
        c.submit_response(pid, "no", "https://example.com/x")


def test_evidence_collection_bound(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    for i in range(64):
        c.add_evidence(pid, f"https://example.com/ev/{i}", f"quote number {i}", "SOURCE")
    assert c.get_evidence_count(pid) == 64
    with pytest.raises(Exception):
        c.add_evidence(pid, "https://example.com/ev/overflow", "one too many", "SOURCE")


def test_drift_collection_bound(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    for i in range(64):
        c.add_drift(pid, f"later statement number {i}", f"https://example.com/d/{i}")
    assert c.get_drift_count(pid) == 64
    with pytest.raises(Exception):
        c.add_drift(pid, "one statement too many", "https://example.com/d/overflow")


def test_response_collection_bound(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    for i in range(32):
        c.submit_response(pid, f"response number {i}", f"https://example.com/r/{i}")
    assert c.get_response_count(pid) == 32
    with pytest.raises(Exception):
        c.submit_response(pid, "one response too many", "https://example.com/r/overflow")


def test_duplicate_evidence_rejected(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    c.add_evidence(pid, "https://example.com/dup", "exactly the same quote", "SOURCE")
    with pytest.raises(Exception):
        c.add_evidence(pid, "https://example.com/dup", "exactly the same quote", "SOURCE")
    # A different quote at the same URL is not a duplicate.
    c.add_evidence(pid, "https://example.com/dup", "a different quote entirely", "SOURCE")
    assert c.get_evidence_count(pid) == 2


def test_duplicate_detection_is_url_case_insensitive(direct_deploy):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    c.add_evidence(pid, "https://Example.com/Dup", "the same quote text", "SOURCE")
    with pytest.raises(Exception):
        c.add_evidence(pid, "https://example.com/dup", "the same quote text", "SOURCE")


# ---------------------------------------------------------------------------------------
# Relationship classification hints
# ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "statement,expected",
    [
        ("We will no longer ship this feature.", "REVERSED"),
        ("Access is limited to a few selected partners.", "NARROWED"),
        ("Let us clarify what we mean by mainnet.", "REFRAMED"),
        ("This may ship later in the year.", "SOFTENED"),
        ("The launch happened today.", "UNRELATED"),
    ],
)
def test_drift_relationship_classification(direct_deploy, statement, expected):
    c = direct_deploy(CONTRACT)
    pid = make_promise(c)
    c.add_drift(pid, statement, "https://example.com/statement")
    import json as _json

    entry = _json.loads(c.get_drift(pid))[0]
    assert entry["relationship"] == expected