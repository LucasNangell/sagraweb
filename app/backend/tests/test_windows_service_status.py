"""Testes do status SCM SAGRA-SyncAndamentos."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import json

from services.windows_service_status import (
    build_sync_andamentos_service_status,
    parse_sc_query_output,
    read_divergencia_monitor_status,
    read_system_watchdog_sync_status,
    resolve_system_watchdog_status_path,
)


SC_RUNNING = """\
SERVICE_NAME: SAGRA-SyncAndamentos
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING
                                (STOPPABLE, NOT_PAUSABLE, ACCEPTS_SHUTDOWN)
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
        CHECKPOINT         : 0x0
        WAIT_HINT          : 0x0
"""

SC_STOPPED = """\
SERVICE_NAME: SAGRA-SyncAndamentos
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 1  STOPPED
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
        CHECKPOINT         : 0x0
        WAIT_HINT          : 0x0
"""

SC_PAUSED = """\
SERVICE_NAME: SAGRA-SyncAndamentos
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 7  PAUSED
        WIN32_EXIT_CODE    : 0  (0x0)
        SERVICE_EXIT_CODE  : 0  (0x0)
        CHECKPOINT         : 0x0
        WAIT_HINT          : 0x0
"""

SC_MISSING = """\
[SC] EnumQueryServicesStatus:OpenService FAILED 1060:

The specified service does not exist as an installed service.
"""


class TestParseScQueryOutput:
    def test_running(self):
        parsed = parse_sc_query_output(SC_RUNNING)
        assert parsed == {"exists": True, "status": "Running", "query_ok": True}

    def test_stopped(self):
        parsed = parse_sc_query_output(SC_STOPPED)
        assert parsed == {"exists": True, "status": "Stopped", "query_ok": True}

    def test_paused(self):
        parsed = parse_sc_query_output(SC_PAUSED)
        assert parsed == {"exists": True, "status": "Paused", "query_ok": True}

    def test_missing_service(self):
        parsed = parse_sc_query_output(SC_MISSING, returncode=1060)
        assert parsed == {"exists": False, "status": None, "query_ok": True}

    def test_generic_failure(self):
        parsed = parse_sc_query_output("", stderr="Access denied", returncode=5)
        assert parsed["exists"] is False
        assert parsed["query_ok"] is False


class TestBuildSyncAndamentosServiceStatus:
    def test_running_no_alert(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": True,
                "status": "Running",
                "query_ok": True,
            },
            divergencia={"data_stale": False, "mdb_count": None, "mysql_count": None},
        )
        assert payload["healthy"] is True
        assert payload["alert"] is False
        assert payload["data_stale"] is False

    def test_stopped_alerts_in_production(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": True,
                "status": "Stopped",
                "query_ok": True,
            },
            divergencia={"data_stale": False, "mdb_count": None, "mysql_count": None},
        )
        assert payload["healthy"] is False
        assert payload["alert"] is True

    def test_missing_alerts_in_production(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": False,
                "status": None,
                "query_ok": True,
            },
            divergencia={"data_stale": False, "mdb_count": None, "mysql_count": None},
        )
        assert payload["healthy"] is False
        assert payload["alert"] is True

    def test_no_alert_in_development(self):
        payload = build_sync_andamentos_service_status(
            is_development=True,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": False,
                "status": None,
                "query_ok": True,
            },
            divergencia={"data_stale": False, "mdb_count": None, "mysql_count": None},
        )
        assert payload["alert"] is False

    def test_query_failure_no_alert(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": False,
                "status": None,
                "query_ok": False,
            },
            divergencia={"data_stale": False, "mdb_count": None, "mysql_count": None},
        )
        assert payload["alert"] is False

    def test_data_stale_ors_into_alert_even_when_running(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": True,
                "status": "Running",
                "query_ok": True,
            },
            divergencia={
                "data_stale": True,
                "mdb_count": 100,
                "mysql_count": 95,
            },
        )
        assert payload["healthy"] is True
        assert payload["alert"] is True
        assert payload["data_stale"] is True
        assert payload["mdb_count"] == 100
        assert payload["mysql_count"] == 95

    def test_data_stale_alerts_in_development(self):
        payload = build_sync_andamentos_service_status(
            is_development=True,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": True,
                "status": "Running",
                "query_ok": True,
            },
            divergencia={"data_stale": True, "mdb_count": 1, "mysql_count": 2},
        )
        assert payload["alert"] is True
        assert payload["data_stale"] is True


class TestReadDivergenciaMonitorStatus:
    def test_missing_file(self, tmp_path: Path):
        result = read_divergencia_monitor_status(path=tmp_path / "missing.json")
        assert result["data_stale"] is False
        assert result["status_fresh"] is False

    def test_fresh_alert(self, tmp_path: Path):
        now = datetime(2026, 9, 4, 12, 0, 0, tzinfo=timezone.utc)
        path = tmp_path / "sync_divergencia_monitor.json"
        path.write_text(
            '{"alert": true, "count_mdb": 10, "count_mysql": 9, '
            '"checked_at": "2026-09-04T12:00:00+00:00", "phase": "alerting"}',
            encoding="utf-8",
        )
        result = read_divergencia_monitor_status(path=path, now=now, stale_seconds=300)
        assert result["data_stale"] is True
        assert result["mdb_count"] == 10
        assert result["mysql_count"] == 9
        assert result["status_fresh"] is True

    def test_stale_file_ignored(self, tmp_path: Path):
        now = datetime(2026, 9, 4, 12, 0, 0, tzinfo=timezone.utc)
        old = (now - timedelta(seconds=600)).isoformat()
        path = tmp_path / "sync_divergencia_monitor.json"
        path.write_text(
            f'{{"alert": true, "count_mdb": 10, "count_mysql": 9, "checked_at": "{old}"}}',
            encoding="utf-8",
        )
        result = read_divergencia_monitor_status(path=path, now=now, stale_seconds=300)
        assert result["data_stale"] is False
        assert result["status_fresh"] is False


NOW = datetime(2026, 10, 5, 8, 0, 0, tzinfo=timezone.utc)
RUNNING = {"service_name": "SAGRA-SyncAndamentos", "exists": True, "status": "Running", "query_ok": True}
NO_DIVERGENCE = {"data_stale": False, "mdb_count": None, "mysql_count": None}


def _write_watchdog_status(
    path: Path,
    *,
    healthy=False,
    unhealthy_for=0,
    circuit_for=0,
    last_action_ok=None,
    maintenance=False,
    checked_ago=10,
):
    now = NOW.timestamp()
    state = {
        "unhealthy_since": now - unhealthy_for if unhealthy_for else 0.0,
        "circuit_open_until": now + circuit_for if circuit_for else 0.0,
        "last_action_ok": last_action_ok,
        "last_action_detail": "status final=Stopped; C:\\nssm\\nssm.exe",
    }
    payload = {
        "checked_at": (NOW - timedelta(seconds=checked_ago)).isoformat(),
        "overall": "degraded",
        "maintenance": {"active": maintenance},
        "sync": {"healthy": healthy, "state": state},
    }
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


class TestSystemWatchdogSyncStatus:
    def test_missing_file_is_silent(self, tmp_path: Path):
        result = read_system_watchdog_sync_status(path=tmp_path / "x.json", now=NOW)
        assert result["available"] is False
        assert result["alert_reasons"] == []

    def test_sync_down_over_threshold(self, tmp_path: Path):
        path = _write_watchdog_status(tmp_path / "s.json", unhealthy_for=301)
        result = read_system_watchdog_sync_status(path=path, now=NOW, down_alert_seconds=300)
        assert result["alert_reasons"] == ["SYNC_DOWN"]

    def test_sync_down_under_threshold_does_not_alert(self, tmp_path: Path):
        path = _write_watchdog_status(tmp_path / "s.json", unhealthy_for=120)
        result = read_system_watchdog_sync_status(path=path, now=NOW, down_alert_seconds=300)
        assert result["alert_reasons"] == []

    def test_circuit_open_and_recovery_failed(self, tmp_path: Path):
        path = _write_watchdog_status(
            tmp_path / "s.json", circuit_for=600, last_action_ok=False
        )
        result = read_system_watchdog_sync_status(path=path, now=NOW)
        assert result["alert_reasons"] == ["CIRCUIT_OPEN", "RECOVERY_FAILED"]

    def test_recovery_failed_clears_when_sync_healthy(self, tmp_path: Path):
        path = _write_watchdog_status(tmp_path / "s.json", healthy=True, last_action_ok=False)
        assert read_system_watchdog_sync_status(path=path, now=NOW)["alert_reasons"] == []

    def test_maintenance_and_stale_status_do_not_alert(self, tmp_path: Path):
        maint = _write_watchdog_status(tmp_path / "m.json", unhealthy_for=900, maintenance=True)
        stale = _write_watchdog_status(tmp_path / "s.json", unhealthy_for=900, checked_ago=900)
        assert read_system_watchdog_sync_status(path=maint, now=NOW)["alert_reasons"] == []
        result = read_system_watchdog_sync_status(path=stale, now=NOW)
        assert result["fresh"] is False
        assert result["alert_reasons"] == []

    def test_unreadable_file_degrades(self, tmp_path: Path):
        path = tmp_path / "s.json"
        path.write_text("{nao json", encoding="utf-8")
        assert read_system_watchdog_sync_status(path=path, now=NOW)["available"] is False

    def test_resolve_finds_shared_run_above_current(self, tmp_path: Path, monkeypatch):
        status = tmp_path / "shared" / "run" / "system_watchdog_status.json"
        status.parent.mkdir(parents=True)
        status.write_text("{}", encoding="utf-8")
        backend = tmp_path / "current" / "app" / "backend"
        backend.mkdir(parents=True)
        monkeypatch.delenv("SYSTEM_WATCHDOG_STATUS_FILE", raising=False)
        monkeypatch.chdir(backend)
        assert resolve_system_watchdog_status_path() == status


class TestConsolidatedAlert:
    def test_watchdog_reason_raises_alert_with_running_scm(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result=RUNNING,
            divergencia=NO_DIVERGENCE,
            watchdog={"alert_reasons": ["CIRCUIT_OPEN"], "last_action_detail": "C:\\x"},
        )
        assert payload["alert"] is True
        assert payload["alert_reasons"] == ["CIRCUIT_OPEN"]
        assert "last_action_detail" not in payload["watchdog"]

    def test_reasons_combine_scm_and_divergence(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result={**RUNNING, "status": "Stopped"},
            divergencia={"data_stale": True, "mdb_count": 2, "mysql_count": 1},
            watchdog={"alert_reasons": ["SYNC_DOWN"]},
        )
        assert payload["alert_reasons"] == ["SCM_NOT_RUNNING", "DATA_DIVERGENCE", "SYNC_DOWN"]

    def test_watchdog_reasons_ignored_in_development(self):
        payload = build_sync_andamentos_service_status(
            is_development=True,
            query_result=RUNNING,
            divergencia=NO_DIVERGENCE,
            watchdog={"alert_reasons": ["SYNC_DOWN"]},
        )
        assert payload["alert"] is False
