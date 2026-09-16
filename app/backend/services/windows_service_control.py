"""Controle de serviços Windows (NSSM/sc) com allowlist estrita."""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

ALLOWED_SERVICES = frozenset(
    {
        "SAGRA-SyncAndamentos",
        "SAGRA-MonitorSyncAndamentos",
    }
)


class ServiceControlError(Exception):
    def __init__(self, message: str, *, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


def _resolve_nssm() -> Optional[str]:
    env = (os.getenv("NSSM_PATH") or "").strip()
    candidates = []
    if env:
        candidates.append(env)
    # app/backend/services → repo root
    here = Path(__file__).resolve()
    root = here.parents[3]
    candidates.append(str(root / "deploy" / "tools" / "nssm.exe"))
    candidates.append(str(root / "tools" / "nssm.exe"))
    which = shutil.which("nssm") or shutil.which("nssm.exe")
    if which:
        candidates.append(which)
    for c in candidates:
        if c and Path(c).is_file():
            return str(Path(c).resolve())
    return None


def _run(cmd: list[str], timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def control_windows_service(service_name: str, action: str) -> dict:
    """
    action: start | stop | restart
    """
    if sys.platform != "win32":
        raise ServiceControlError(
            "Controle de serviço só disponível no Windows Server.",
            status_code=501,
        )
    if service_name not in ALLOWED_SERVICES:
        raise ServiceControlError(
            f"Serviço não permitido: {service_name}",
            status_code=400,
        )
    if action not in ("start", "stop", "restart"):
        raise ServiceControlError(f"Ação inválida: {action}", status_code=400)

    nssm = _resolve_nssm()
    try:
        if nssm:
            completed = _run([nssm, action, service_name], timeout=45)
        else:
            sc_action = {
                "start": "start",
                "stop": "stop",
                "restart": "stop",  # stop then start
            }[action]
            if action == "restart":
                _run(["sc", "stop", service_name], timeout=30)
                completed = _run(["sc", "start", service_name], timeout=30)
            else:
                completed = _run(["sc", sc_action, service_name], timeout=30)
    except subprocess.TimeoutExpired as exc:
        raise ServiceControlError(
            f"Timeout ao executar {action} em {service_name}",
            status_code=504,
        ) from exc
    except PermissionError as exc:
        raise ServiceControlError(
            "Acesso negado ao SCM. Conceda ACL com conceder-controle-servico.ps1.",
            status_code=403,
        ) from exc

    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()
    combined = f"{stdout}\n{stderr}".lower()
    if completed.returncode != 0:
        if "access is denied" in combined or "acesso negado" in combined:
            raise ServiceControlError(
                "Acesso negado ao SCM. Conceda ACL com conceder-controle-servico.ps1.",
                status_code=403,
            )
        raise ServiceControlError(
            f"Falha {action} {service_name}: {stderr or stdout or completed.returncode}",
            status_code=500,
        )

    return {
        "service_name": service_name,
        "action": action,
        "ok": True,
        "via": "nssm" if nssm else "sc",
        "stdout": stdout[:500],
    }
