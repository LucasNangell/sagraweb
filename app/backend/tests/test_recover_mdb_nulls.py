"""Testes da recuperação de NULLs no MDB a partir de backup."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from recover_mdb_nulls_from_backup import find_recoverable_cells, is_blank  # noqa: E402


def test_is_blank():
    assert is_blank(None)
    assert is_blank("")
    assert is_blank("  ")
    assert not is_blank(0)
    assert not is_blank("4x4")


def test_find_recoverable_only_fills_current_nulls():
    backup = [
        {
            "NroProtocoloLinkDet": 84,
            "AnoProtocoloLinkDet": 2026,
            "CalcPgs1": 12,
            "CalcCor1": "4x4",
            "Titulo": "Backup",
        }
    ]
    current = [
        {
            "NroProtocoloLinkDet": 84,
            "AnoProtocoloLinkDet": 2026,
            "CalcPgs1": None,
            "CalcCor1": "1x1",
            "Titulo": None,
        }
    ]
    hits = find_recoverable_cells(
        backup,
        current,
        ("NroProtocoloLinkDet", "AnoProtocoloLinkDet"),
        ("CalcPgs1", "CalcCor1", "Titulo"),
    )
    recovered = {(item["column"], item["backup_value"]) for item in hits}
    assert recovered == {("CalcPgs1", 12), ("Titulo", "Backup")}


def test_find_recoverable_ignores_missing_current_row():
    hits = find_recoverable_cells(
        [{"NroProtocoloLinkDet": 1, "AnoProtocoloLinkDet": 2026, "CalcPgs1": 3}],
        [],
        ("NroProtocoloLinkDet", "AnoProtocoloLinkDet"),
        ("CalcPgs1",),
    )
    assert hits == []
