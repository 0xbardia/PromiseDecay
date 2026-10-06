"""The TEST-ONLY short-window fixture must differ from production in exactly two lines."""

from __future__ import annotations

import subprocess
from pathlib import Path

from conftest import CONTRACT

ROOT = Path(__file__).resolve().parents[2]


def _derive(tmp_path, seconds="600"):
    out = tmp_path / "PromiseDecayTestFixture.py"
    subprocess.run(
        ["node", str(ROOT / "scripts/make-test-fixture-source.mjs"), str(out), seconds],
        check=True,
        capture_output=True,
        cwd=ROOT,
    )
    return out


def test_fixture_differs_from_production_in_exactly_two_lines(tmp_path):
    fixture = _derive(tmp_path)
    prod = (ROOT / CONTRACT).read_text().split("\n")
    test = fixture.read_text().split("\n")
    assert len(prod) == len(test)
    changed = [t for p, t in zip(prod, test) if p != t]
    assert len(changed) == 2
    assert any(line.startswith("CHALLENGE_WINDOW_SECONDS = 600") for line in changed)
    assert any(line.endswith('-TEST-SHORT-WINDOW"') for line in changed)


def test_fixture_deploys_with_short_window(direct_deploy, tmp_path):
    fixture = direct_deploy(str(_derive(tmp_path)))
    cfg = fixture.get_config()
    assert cfg["challenge_window_seconds"] == 600
    assert cfg["contract_version"].endswith("-TEST-SHORT-WINDOW")


def test_fixture_refuses_out_of_range_window(tmp_path):
    out = tmp_path / "x.py"
    result = subprocess.run(
        ["node", str(ROOT / "scripts/make-test-fixture-source.mjs"), str(out), "5"],
        capture_output=True,
        cwd=ROOT,
    )
    assert result.returncode != 0
    assert not out.exists()


def test_production_contract_keeps_seven_day_window_and_no_test_label(direct_deploy):
    prod = direct_deploy(CONTRACT)
    assert prod.get_config()["challenge_window_seconds"] == 7 * 24 * 60 * 60
    assert not prod.get_version().endswith("TEST-SHORT-WINDOW")
