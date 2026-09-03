"""Testes do status SCM SAGRA-SyncAndamentos."""
from __future__ import annotations

from services.windows_service_status import (
    build_sync_andamentos_service_status,
    parse_sc_query_output,
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
        )
        assert payload["healthy"] is True
        assert payload["alert"] is False

    def test_stopped_alerts_in_production(self):
        payload = build_sync_andamentos_service_status(
            is_development=False,
            query_result={
                "service_name": "SAGRA-SyncAndamentos",
                "exists": True,
                "status": "Stopped",
                "query_ok": True,
            },
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
        )
        assert payload["alert"] is False
