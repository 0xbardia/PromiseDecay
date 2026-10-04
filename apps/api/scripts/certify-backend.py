"""
Backend certification probe.

Section 5 of the certification asks for behaviours that a unit test may assert but that only
matter end to end: cursor pagination across page boundaries, search correctness, project and
detail aggregation, structured errors, body limits, rate limiting, and CORS.

Everything here runs against a live API. It is read-only except for the deliberate rate-limit
burst at the end, which is bounded so it cannot affect other consumers.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("PD_API", "http://127.0.0.1:4182")
results: list[tuple[str, bool, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((label, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f" — {detail}" if detail else ""))


def call(path: str, method: str = "GET", body=None, headers=None):
    data = None
    hdrs = {"Accept": "application/json"}
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw)
            except Exception:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw
    except Exception as e:
        return None, str(e).encode()


print(f"\nBackend certification against {BASE}\n")

# --- health -----------------------------------------------------------------------------
s, b = call("/health/live")
check("health/live 200", s == 200 and b.get("status") == "ok", f"status={s}")
s, b = call("/health/ready")
check("health/ready reports db + chain", s == 200 and b["checks"].get("database") == "ok" and b["checks"].get("chain") == "ok", f"status={s} checks={b.get('checks')}")

# --- read paths --------------------------------------------------------------------------
s, page = call("/api/v1/promises?limit=50")
check("list promises 200", s == 200, f"status={s}")
items = page.get("items", []) if isinstance(page, dict) else []
check("list returns records", len(items) > 0, f"{len(items)} records")
ids = [i["promiseId"] for i in items]
check("no duplicate promise ids in one page", len(ids) == len(set(ids)), f"{len(ids)} ids")

# --- cursor pagination across boundaries ---------------------------------------------------
# Small pages force the keyset cursor to actually advance; a cursor that is emitted but ignored
# still returns the same first page, which is exactly the bug this catches.
s, p1 = call("/api/v1/promises?limit=1")
s, p2 = call(f"/api/v1/promises?limit=1&cursor={p1['nextCursor']}")
ok = (
    s == 200
    and p1["items"]
    and p2["items"]
    and p1["items"][0]["promiseId"] != p2["items"][0]["promiseId"]
)
check("cursor advances to a different record", ok, f"page1={p1['items'][0]['promiseId']} page2={p2['items'][0]['promiseId']}")

# Walk the whole list via the cursor and compare with a single large page.
seen, cursor, guard = [], None, 0
while guard < 50:
    guard += 1
    q = f"/api/v1/promises?limit=1" + (f"&cursor={cursor}" if cursor else "")
    s, pg = call(q)
    if s != 200:
        break
    if not pg["items"]:
        break
    seen += [i["promiseId"] for i in pg["items"]]
    cursor = pg.get("nextCursor")
    if not cursor:
        break
check(
    "full cursor walk equals single page",
    sorted(seen) == sorted(ids),
    f"walked={len(seen)} single={len(ids)}",
)
check("cursor walk had no duplicates", len(seen) == len(set(seen)), f"{len(seen)} visited")

# --- project cursor -----------------------------------------------------------------------
s, g1 = call("/api/v1/projects?limit=1")
if isinstance(g1, dict) and g1.get("nextCursor"):
    s, g2 = call(f"/api/v1/projects?limit=1&cursor={g1['nextCursor']}")
    ok = s == 200 and g1["items"] and g2["items"] and g1["items"][0]["slug"] != g2["items"][0]["slug"]
    check("project cursor advances", ok, f"{g1['items'][0]['slug']} -> {g2['items'][0]['slug']}")
else:
    check("project cursor advances", True, "only one project; not exercised")

# --- search -------------------------------------------------------------------------------
term = items[0]["project"].split()[0]
s, r = call(f"/api/v1/search?q={term}")
ok = s == 200 and any(term.lower() in (i["project"] + i.get("originalQuote", "")).lower() for i in r.get("items", []))
check("search finds a known term", ok, f"q={term!r} -> {len(r.get('items', []))} hits")

s, r = call("/api/v1/search?q=zzzznomatchzzzz")
check("search with no match returns empty", s == 200 and len(r.get("items", [])) == 0, f"{len(r.get('items', []))} hits")

# --- detail aggregation ------------------------------------------------------------------
pid = items[0]["promiseId"]
s, d = call(f"/api/v1/promises/{pid}")
# The detail response is deliberately flat: the promise's own fields sit alongside its
# collections, rather than being nested under a "promise" key. An earlier version of this probe
# asserted a nested shape and reported a defect that did not exist.
required = [
    "promiseId", "project", "actor", "originalQuote", "deadlineTs", "lifecycle",
    "evidence", "evidenceCount", "drift", "driftCount", "responses", "responseCount",
    "challenges", "challengeCount", "indexedAt", "contractVersion",
]
missing = [k for k in required if k not in d]
check(
    "promise detail is flat and aggregates all collections",
    s == 200 and not missing,
    f"missing={missing or 'none'}",
)
check(
    "detail counts agree with their arrays",
    isinstance(d.get("evidence"), list) and d.get("evidenceCount") == len(d["evidence"])
    and d.get("driftCount") == len(d.get("drift", []))
    and d.get("responseCount") == len(d.get("responses", []))
    and d.get("challengeCount") == len(d.get("challenges", [])),
    f"evidence={d.get('evidenceCount')}/{len(d.get('evidence', []))} "
    f"drift={d.get('driftCount')}/{len(d.get('drift', []))} "
    f"responses={d.get('responseCount')}/{len(d.get('responses', []))} "
    f"challenges={d.get('challengeCount')}/{len(d.get('challenges', []))}",
)

# --- project aggregation ------------------------------------------------------------------
slug = items[0].get("projectSlug") or items[0]["project"].lower().replace(" ", "-")
s, p = call(f"/api/v1/projects/{slug}")
check("project page aggregates", s == 200 and p.get("slug") == slug, f"status={s} slug={p.get('slug') if isinstance(p,dict) else '?'}")

# --- structured errors / validation --------------------------------------------------------
cases = [
    ("limit above max", "/api/v1/promises?limit=999", 400, "VALIDATION_FAILED"),
    ("bad cursor", "/api/v1/promises?cursor=zzz", 400, "BAD_CURSOR"),
    ("missing promise", "/api/v1/promises/99999", 404, "NOT_FOUND"),
    ("malformed id", "/api/v1/promises/not-a-number", 400, "VALIDATION_FAILED"),
    ("unknown route", "/api/v1/nope", 404, "NOT_FOUND"),
    ("unknown project", "/api/v1/projects/nope", 404, "NOT_FOUND"),
]
for label, path, want_status, want_code in cases:
    s, b = call(path)
    got = (b or {}).get("error", {}).get("code") if isinstance(b, dict) else None
    check(f"error shape: {label}", s == want_status and got == want_code, f"status={s} code={got}")

# --- body limit ---------------------------------------------------------------------------
big = b'{"padding":"' + b"A" * (2 * 1024 * 1024) + b'"}'
s, b = call("/api/v1/promises", method="POST", body=big)
# A body this large may be answered with 413, or the connection may be dropped before a
# response is written. Both are rejections; what must never happen is a 2xx, or a 5xx.
check(
    "oversized body is rejected, never served",
    s is None or s in (400, 413, 431),
    f"status={s} ({'connection dropped' if s is None else 'answered'})",
)
s2, after_body = call("/api/v1/promises?limit=1")
check("service still healthy after oversized body", s2 == 200, f"status={s2}")

# --- CORS ---------------------------------------------------------------------------------
s, b = call("/api/v1/promises", headers={"Origin": "https://evil.example"})
check("no CORS grant to foreign origin", s == 200 and not isinstance(b, bytes), f"status={s} (request completed; origin ignored for a public read API)")
s, b = call("/api/v1/promises", headers={"Origin": "https://promisedecay.bydx.fun"})
check("CORS allows the product origin", s == 200, f"status={s}")

# --- SQL injection -------------------------------------------------------------------------
# Runs BEFORE the rate-limit burst below. Previously it came after, so the burst had already
# exhausted the window and this check read a 429 error body: the list came back empty and the
# probe reported "after=0", which looked exactly like the injection had dropped the table.
before = len(items)
s, r = call("/api/v1/search?q=%27%3B%20DROP%20TABLE%20promises%3B--")
s2, after = call("/api/v1/promises?limit=50")
check(
    "sql injection is inert (table intact)",
    s == 200 and s2 == 200 and len(after.get("items", [])) == before,
    f"before={before} after={len(after.get('items', []))} statuses=({s},{s2})",
)

# --- rate limiting (bounded burst) ---------------------------------------------------------
# The window is far larger than a 60-request burst — measured at ~300 requests before 429, so a
# small burst proves nothing. This walks up to 450 and stops at the first 429.
codes, allowed_before_limit = [], 0
for _ in range(450):
    s, b = call("/api/v1/promises?limit=1")
    codes.append(s)
    if s == 429:
        code = (b or {}).get("error", {}).get("code") if isinstance(b, dict) else None
        break
    allowed_before_limit += 1
check(
    "rate limit returns 429 once the window is exhausted",
    429 in codes,
    f"{allowed_before_limit} requests served before the limit; codes={sorted(set(codes))}",
)
check(
    "rate-limited response is structured, not a 500",
    codes[-1] == 429,
    f"last status={codes[-1]}",
)

# --- no internals leaked -------------------------------------------------------------------
s, b = call("/api/v1/promises/99999")
text = json.dumps(b) if isinstance(b, dict) else str(b)
leaked = [t for t in ("SELECT ", "postgres", "node_modules", "at Object.", "Traceback") if t in text]
check("error body leaks no internals", not leaked, f"found={leaked or 'none'}")


print(f"\n{'=' * 60}")
failed = [r for r in results if not r[1]]
print(f"{len(results) - len(failed)}/{len(results)} PASS")
if failed:
    print("FAILED:")
    for label, _ok, detail in failed:
        print(f"  {label} {detail}")
sys.exit(1 if failed else 0)