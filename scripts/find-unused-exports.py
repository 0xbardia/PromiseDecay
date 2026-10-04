#!/usr/bin/env python3
"""
Find exported symbols that nothing else imports.

A rough detector, deliberately: it reports candidates for a human to confirm rather than
deleting anything. Exported symbols are a maintenance cost even when unused -- they appear in
docs, invite callers, and mislead a reader into thinking a path is supported.

Run:  .venv/bin/python scripts/find-unused-exports.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {"node_modules", "dist", ".venv", ".git", ".qa", "test-results", "artifacts",
             "__pycache__", "playwright-report", ".pytest_cache"}

SOURCE_SUFFIXES = {".ts", ".tsx", ".mjs"}

# Names that are legitimately unreferenced from source: framework entry points, test-only
# exports, and things referenced only from HTML or config.
ALWAYS_KEEP = {
    "main", "default", "App",
}

def source_files() -> list[Path]:
    out = []
    for p in ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix in SOURCE_SUFFIXES:
            out.append(p)
    return out

EXPORT_PATTERNS = [
    re.compile(r"^export\s+(?:async\s+)?function\s+(\w+)"),
    re.compile(r"^export\s+(?:const|let|var)\s+(\w+)"),
    re.compile(r"^export\s+class\s+(\w+)"),
    re.compile(r"^export\s+(?:type|interface)\s+(\w+)"),
    re.compile(r"^export\s+\{([^}]*)\}"),
]

def exported_names(path: Path) -> set[str]:
    names: set[str] = set()
    try:
        text = path.read_text(encoding="utf8", errors="replace")
    except Exception:
        return names
    for line in text.splitlines():
        line = line.strip()
        for pat in EXPORT_PATTERNS:
            m = pat.match(line)
            if not m:
                continue
            raw = m.group(1)
            for part in raw.split(","):
                part = part.strip()
                if not part:
                    continue
                # `export { a as b }` — the exported name is b.
                if " as " in part:
                    part = part.split(" as ")[-1].strip()
                part = part.replace("type ", "").strip()
                if re.fullmatch(r"\w+", part):
                    names.add(part)
            break
    return names

def main() -> int:
    files = source_files()
    all_text = "\n".join(
        p.read_text(encoding="utf8", errors="replace") for p in files
    )

    # Also count references from markdown, since docs legitimately mention symbols.
    doc_text = "\n".join(
        p.read_text(encoding="utf8", errors="replace")
        for p in ROOT.rglob("*.md")
        if not any(part in SKIP_DIRS for part in p.parts)
    )

    candidates: list[tuple[str, str]] = []
    for f in files:
        rel = str(f.relative_to(ROOT))
        if "/scripts/" in rel or rel.startswith("scripts/"):
            continue  # scripts are entry points
        for name in exported_names(f):
            if name in ALWAYS_KEEP or len(name) <= 2:
                continue
            # Count references everywhere except the exporting line itself.
            uses = len(re.findall(rf"\b{re.escape(name)}\b", all_text))
            decls = len(re.findall(rf"^export\b.*\b{re.escape(name)}\b", all_text, re.M))
            if uses <= decls:
                in_docs = bool(re.search(rf"\b{re.escape(name)}\b", doc_text))
                candidates.append((rel, name, "documented" if in_docs else "no references"))

    if not candidates:
        print("no unused exports found")
        return 0

    print(f"{len(candidates)} export(s) with no references outside their own declaration:\n")
    for rel, name, why in sorted(candidates):
        print(f"  {rel:52} {name:28} {why}")
    return 0

if __name__ == "__main__":
    sys.exit(main())