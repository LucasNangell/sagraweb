"""Testes das rotas/serviços admin de sync."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

from services.windows_service_control import (
    ALLOWED_SERVICES,
    ServiceControlError,
    control_windows_service,
)
from services.windows_service_status import read_sync_heartbeat


def test_allowed_services_strict():
    assert "SAGRA-SyncAndamentos" in ALLOWED_SERVICES
    assert "SAGRA-MonitorSyncAndamentos" in ALLOWED_SERVICES
    assert "SomeOtherService" not in ALLOWED_SERVICES


def test_control_rejects_unknown_service():
    with pytest.raises(ServiceControlError) as exc:
        control_windows_service("EvilService", "start")
    assert exc.value.status_code == 400


def test_control_rejects_bad_action(monkeypatch):
    monkeypatch.setattr(
        "services.windows_service_control.sys.platform", "win32"
    )
    with pytest.raises(ServiceControlError) as exc:
        control_windows_service("SAGRA-SyncAndamentos", "explode")
    assert exc.value.status_code == 400


def test_read_sync_heartbeat(tmp_path):
    now = datetime(2026, 3, 16, 12, 0, 0, tzinfo=timezone.utc)
    hb = {
        "phase": "idle",
        "cycles": 42,
        "consecutive_errors": 0,
        "last_cycle_at": "2026-03-16T11:59:30+00:00",
        "written_at": "2026-03-16T11:59:31+00:00",
        "stats": {"ins_m2y": 1},
        "tabandamento_bidi": True,
        "pid": 1234,
    }
    path = tmp_path / "sync_heartbeat.json"
    path.write_text(json.dumps(hb), encoding="utf-8")
    result = read_sync_heartbeat(path=path, now=now, stale_seconds=180)
    assert result["present"] is True
    assert result["phase"] == "idle"
    assert result["cycles"] == 42
    assert result["stale"] is False
    assert result["age_sec"] == 30.0


def test_read_sync_heartbeat_missing(tmp_path):
    result = read_sync_heartbeat(path=tmp_path / "missing.json")
    assert result["present"] is False
    assert result["stale"] is True
