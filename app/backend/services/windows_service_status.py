"""Consulta status de serviços Windows via `sc query` (sem pywin32)."""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

SYNC_ANDAMENTOS_SERVICE_NAME = "SAGRA-SyncAndamentos"
MONITOR_SYNC_SERVICE_NAME = "SAGRA-MonitorSyncAndamentos"
DIVERGENCIA_STATUS_FILENAME = "sync_divergencia_monitor.json"
HEARTBEAT_FILENAME = "sync_heartbeat.json"
# Status do monitor mais antigo que isto não alimenta alert de dados.
DIVERGENCIA_STATUS_STALE_SECONDS = int(
    os.getenv("MONITOR_SYNC_STATUS_STALE_SECONDS", "300")
)
HEARTBEAT_STALE_SECONDS = int(os.getenv("SYNC_HEARTBEAT_STALE_SECONDS", "180"))


_STATE_RE = re.compile(
    r"STATE\s*:\s*\d+\s+(\w+)",
    re.IGNORECASE,
)
_NOT_FOUND_MARKERS = (
    "1060",
    "does not exist",
    "não existe",
    "nao existe",
    "specified service does not exist",
)


def parse_sc_query_output(stdout: str, stderr: str = "", returncode: int = 0) -> dict:
    """
    Interpreta saída de `sc query <name>`.

    Retorna dict com: exists (bool), status (str|None), query_ok (bool).
    """
    combined = f"{stdout or ''}\n{stderr or ''}"
    state_match = _STATE_RE.search(stdout or "")
    if state_match:
        status = state_match.group(1).strip().capitalize()
        # sc usa RUNNING / STOPPED / PAUSED em maiúsculas
        raw = state_match.group(1).strip().upper()
        if raw == "RUNNING":
            status = "Running"
        elif raw == "STOPPED":
            status = "Stopped"
        elif raw == "PAUSED":
            status = "Paused"
        elif raw in ("START_PENDING", "STARTPENDING"):
            status = "StartPending"
        elif raw in ("STOP_PENDING", "STOPPENDING"):
            status = "StopPending"
        else:
            status = raw.title().replace("_", "")
        return {"exists": True, "status": status, "query_ok": True}

    lower = combined.lower()
    if returncode != 0 or any(marker in lower for marker in _NOT_FOUND_MARKERS):
        # Código 1060 = serviço inexistente; outras falhas também tratamos como não encontrado
        # quando não há STATE parseável.
        if any(marker in lower for marker in _NOT_FOUND_MARKERS) or returncode == 1060:
            return {"exists": False, "status": None, "query_ok": True}
        return {"exists": False, "status": None, "query_ok": False}

    return {"exists": False, "status": None, "query_ok": False}


def query_windows_service(service_name: str) -> dict:
    """Consulta o SCM. Fora de Windows devolve query_ok=False."""
    if sys.platform != "win32":
        return {
            "service_name": service_name,
            "exists": False,
            "status": None,
            "query_ok": False,
        }

    try:
        completed = subprocess.run(
            ["sc", "query", service_name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            check=False,
        )
        parsed = parse_sc_query_output(
            completed.stdout or "",
            completed.stderr or "",
            completed.returncode,
        )
        return {
            "service_name": service_name,
            "exists": parsed["exists"],
            "status": parsed["status"],
            "query_ok": parsed["query_ok"],
        }
    except Exception as exc:
        logger.warning("Falha ao consultar serviço %s: %s", service_name, exc)
        return {
            "service_name": service_name,
            "exists": False,
            "status": None,
            "query_ok": False,
        }


def resolve_sync_log_dir() -> Path:
    """Diretório de logs do sync/monitor (SYNC_LOG_DIR ou logs/sync sob a raiz)."""
    env = (os.getenv("SYNC_LOG_DIR") or "").strip()
    if env:
        return Path(env).resolve()

    cwd_candidate = Path.cwd() / "logs" / "sync"
    if cwd_candidate.is_dir():
        return cwd_candidate.resolve()

    # app/backend/services → repo root (3 níveis acima)
    here = Path(__file__).resolve()
    repo_root = here.parents[3]
    return (repo_root / "logs" / "sync").resolve()


def _parse_iso_utc(value: Any) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def read_divergencia_monitor_status(
    *,
    path: Optional[Path] = None,
    now: Optional[datetime] = None,
    stale_seconds: int = DIVERGENCIA_STATUS_STALE_SECONDS,
) -> dict:
    """
    Lê sync_divergencia_monitor.json.

    Retorna dict com:
      data_stale (bool), mdb_count, mysql_count, checked_at, status_fresh, phase
    """
    empty = {
        "data_stale": False,
        "mdb_count": None,
        "mysql_count": None,
        "checked_at": None,
        "status_fresh": False,
        "phase": None,
    }
    status_path = path or (resolve_sync_log_dir() / DIVERGENCIA_STATUS_FILENAME)
    if not status_path.is_file():
        return empty

    try:
        data = json.loads(status_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Falha ao ler %s: %s", status_path, exc)
        return empty

    if not isinstance(data, dict):
        return empty

    checked = _parse_iso_utc(data.get("checked_at") or data.get("written_at"))
    now_utc = now or datetime.now(timezone.utc)
    fresh = False
    if checked is not None:
        age = (now_utc - checked).total_seconds()
        fresh = age <= stale_seconds

    alert_flag = bool(data.get("alert"))
    data_stale = bool(fresh and alert_flag)

    return {
        "data_stale": data_stale,
        "mdb_count": data.get("count_mdb"),
        "mysql_count": data.get("count_mysql"),
        "checked_at": data.get("checked_at") or data.get("written_at"),
        "status_fresh": fresh,
        "phase": data.get("phase"),
    }


def read_sync_heartbeat(
    *,
    path: Optional[Path] = None,
    now: Optional[datetime] = None,
    stale_seconds: int = HEARTBEAT_STALE_SECONDS,
) -> dict:
    """
    Lê logs/sync/sync_heartbeat.json.

    Retorna: phase, age_sec, cycles, consecutive_errors, last_error, last_cycle_at,
    written_at, stats, stale, present.
    """
    empty = {
        "present": False,
        "phase": None,
        "age_sec": None,
        "cycles": None,
        "consecutive_errors": None,
        "last_error": None,
        "last_cycle_at": None,
        "written_at": None,
        "stats": None,
        "stale": True,
        "tabandamento_bidi": None,
    }
    hb_path = path or (resolve_sync_log_dir() / HEARTBEAT_FILENAME)
    if not hb_path.is_file():
        return empty
    try:
        data = json.loads(hb_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Falha ao ler %s: %s", hb_path, exc)
        return empty
    if not isinstance(data, dict):
        return empty

    ref = _parse_iso_utc(data.get("last_cycle_at")) or _parse_iso_utc(
        data.get("written_at")
    )
    now_utc = now or datetime.now(timezone.utc)
    age = None
    stale = True
    if ref is not None:
        age = (now_utc - ref).total_seconds()
        stale = age > stale_seconds

    return {
        "present": True,
        "phase": data.get("phase"),
        "age_sec": round(age, 1) if age is not None else None,
        "cycles": data.get("cycles"),
        "consecutive_errors": data.get("consecutive_errors"),
        "last_error": data.get("last_error"),
        "last_cycle_at": data.get("last_cycle_at"),
        "written_at": data.get("written_at"),
        "stats": data.get("stats"),
        "stale": stale,
        "tabandamento_bidi": data.get("tabandamento_bidi"),
        "pid": data.get("pid"),
    }


def build_sync_andamentos_service_status(
    *,
    is_development: bool,
    query_result: Optional[dict] = None,
    divergencia: Optional[dict] = None,
) -> dict:
    """Monta payload da API a partir do SCM + status do monitor de divergência."""
    result = query_result or query_windows_service(SYNC_ANDAMENTOS_SERVICE_NAME)
    exists = bool(result.get("exists"))
    status = result.get("status")
    query_ok = bool(result.get("query_ok"))
    healthy = exists and status == "Running"
    # Em desenvolvimento não alerta SCM (máquina local sem NSSM).
    # Se a query falhou sem STATE claro, também não alerta (evita falso positivo).
    scm_alert = (not is_development) and query_ok and (not healthy)

    div = divergencia if divergencia is not None else read_divergencia_monitor_status()
    data_stale = bool(div.get("data_stale"))
    # Divergência de dados alerta também em development (é sinal do monitor, não do SCM).
    alert = scm_alert or data_stale

    return {
        "service_name": result.get("service_name") or SYNC_ANDAMENTOS_SERVICE_NAME,
        "exists": exists,
        "status": status,
        "query_ok": query_ok,
        "healthy": healthy,
        "alert": alert,
        "data_stale": data_stale,
        "mdb_count": div.get("mdb_count"),
        "mysql_count": div.get("mysql_count"),
    }


def build_admin_sync_status(*, is_development: bool) -> dict:
    """Payload enriquecido para a aba Sincronização."""
    sync_svc = build_sync_andamentos_service_status(is_development=is_development)
    monitor = query_windows_service(MONITOR_SYNC_SERVICE_NAME)
    hb = read_sync_heartbeat()
    div = read_divergencia_monitor_status()
    return {
        "services": {
            "sync_andamentos": {
                **sync_svc,
                "heartbeat": hb,
            },
            "monitor_sync": {
                "service_name": MONITOR_SYNC_SERVICE_NAME,
                "exists": bool(monitor.get("exists")),
                "status": monitor.get("status"),
                "query_ok": bool(monitor.get("query_ok")),
                "healthy": bool(monitor.get("exists"))
                and monitor.get("status") == "Running",
            },
        },
        "divergencia": div,
    }

