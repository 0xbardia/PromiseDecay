"""Probe the read API the way a user (or a broken client) actually calls it.

Complements the happy-path certification: this is about what happens when a request is wrong,
hostile, or points at something that does not exist.
"""
import json
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4182"

CASES = [
    ("limit far above max", "/api/v1/promises?limit=999"),
    ("limit negative", "/api/v1/promises?limit=-5"),
    ("limit non-numeric", "/api/v1/promises?limit=abc"),
    ("cursor garbage", "/api/v1/promises?cursor=zzz"),
    ("promise that does not exist", "/api/v1/promises/pd-99999"),
    ("promise id not a number", "/api/v1/promises/not-a-number"),
    ("promise id negative", "/api/v1/promises/pd--1"),
    ("empty search", "/api/v1/search?q="),
    ("search sql-ish", "/api/v1/search?q=%27%3B%20DROP%20TABLE%20promises%3B--"),
    ("search wildcards", "/api/v1/search?q=%25%25%25"),
    ("search overlong", "/api/v1/search?q=" + "x" * 900),
    ("unknown project", "/api/v1/projects/does-not-exist"),
    ("project cursor garbage", "/api/v1/projects?cursor=%%%"),
    ("path traversal", "/api/v1/promises/..%2f..%2fetc%2fpasswd"),
    ("unknown route", "/api/v1/nonexistent"),
    ("unicode query", "/api/v1/search?q=%F0%9F%92%A9"),
]


def call(path):
    req = urllib.request.Request(BASE + path, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # connection level
        return None, str(e).encode()


print(f"{'case':30} {'http':5} {'error code':16} detail")
print("-" * 110)
issues = []
for label, path in CASES:
    status, raw = call(path)
    try:
        d = json.loads(raw)
        code = (d.get("error") or {}).get("code") if isinstance(d, dict) else None
        msg = (d.get("error") or {}).get("message") if isinstance(d, dict) else None
        detail = str(msg)[:58] if msg else "ok"
    except Exception:
        code, detail = None, raw[:58].decode("utf8", "replace")

    print(f"{label:30} {str(status):5} {str(code):16} {detail}")

    # A 5xx, a leaked stack trace, or SQL text coming back to the client is a real problem.
    if status is None or status >= 500:
        issues.append((label, status, "server error"))
    if any(t in detail for t in ("SELECT ", "postgres", "at Object.", "node_modules")):
        issues.append((label, status, "internal detail leaked"))

print()
print("table intact:", call("/api/v1/promises?limit=50")[0] == 200)
if issues:
    print("ISSUES:")
    for i in issues:
        print("  ", i)
else:
    print("no server errors, no leaked internals")