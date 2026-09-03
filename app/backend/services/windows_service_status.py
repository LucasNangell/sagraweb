"""Consulta status de serviços Windows via `sc query` (sem pywin32)."""
from __future__ import annotations

import logging
import re
import subprocess
import sys
from typing import Optional

logger = logging.getLogger(__name__)

SYNC_ANDAMENTOS_SERVICE_NAME = "SAGRA-SyncAndamentos"

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


def build_sync_andamentos_service_status(
    *,
    is_development: bool,
    query_result: Optional[dict] = None,
) -> dict:
    """Monta payload da API a partir do SCM (ou resultado já consultado)."""
    result = query_result or query_windows_service(SYNC_ANDAMENTOS_SERVICE_NAME)
    exists = bool(result.get("exists"))
    status = result.get("status")
    query_ok = bool(result.get("query_ok"))
    healthy = exists and status == "Running"
    # Em desenvolvimento não alerta (máquina local sem NSSM).
    # Se a query falhou sem STATE claro, também não alerta (evita falso positivo).
    alert = (not is_development) and query_ok and (not healthy)
    return {
        "service_name": result.get("service_name") or SYNC_ANDAMENTOS_SERVICE_NAME,
        "exists": exists,
        "status": status,
        "query_ok": query_ok,
        "healthy": healthy,
        "alert": alert,
    }
