"""
Controle do motor sync_andamentos_v2 — DESABILITADO por padrão (MYSQL_ONLY).
O script em app/services/sync_andamentos_v2.py não é alterado; apenas não é
invocado por esta API quando SYNC_ANDAMENTOS_ENABLED=false.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
import subprocess
import os
import sys
import logging
from pathlib import Path
from typing import Optional

from security.api_auth import require_master_ip

logger = logging.getLogger(__name__)

router = APIRouter(dependencies=[Depends(require_master_ip)])

# Caminhos absolutos no layout reorganizado (Sagra Web)
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_SERVICES_DIR = _PROJECT_ROOT / "app" / "services"
_SCRIPT_PATH = _SERVICES_DIR / "sync_andamentos_v2.py"
_LOG_PATH = _PROJECT_ROOT / "logs" / "sync" / "sync_andamentos.log"

SYNC_PROCESS = None


class SyncStatus(BaseModel):
    running: bool
    pid: Optional[int] = None
    message: Optional[str] = None


def _script_exists() -> bool:
    return _SCRIPT_PATH.is_file()


@router.get("/sync/status", response_model=SyncStatus)
def get_sync_status():
    global SYNC_PROCESS

    running = False
    pid = None

    if SYNC_PROCESS and SYNC_PROCESS.poll() is None:
        running = True
        pid = SYNC_PROCESS.pid
    else:
        SYNC_PROCESS = None

    return SyncStatus(running=running, pid=pid)


@router.post("/sync/start", response_model=SyncStatus)
def start_sync():
    global SYNC_PROCESS

    if SYNC_PROCESS and SYNC_PROCESS.poll() is None:
        return SyncStatus(running=True, pid=SYNC_PROCESS.pid, message="Script já está rodando.")

    if not _script_exists():
        raise HTTPException(status_code=404, detail=f"Script não encontrado: {_SCRIPT_PATH}")

    try:
        _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        SYNC_PROCESS = subprocess.Popen(
            [sys.executable, str(_SCRIPT_PATH)],
            cwd=str(_SERVICES_DIR),
            creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0,
        )
        logger.info("Sync script iniciado. PID: %s", SYNC_PROCESS.pid)
        return SyncStatus(running=True, pid=SYNC_PROCESS.pid, message="Script iniciado com sucesso.")
    except Exception as e:
        logger.exception("Erro ao iniciar sync: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync/stop", response_model=SyncStatus)
def stop_sync():
    global SYNC_PROCESS

    if not SYNC_PROCESS:
        return SyncStatus(running=False, message="Script não está rodando.")

    try:
        SYNC_PROCESS.terminate()
        try:
            SYNC_PROCESS.wait(timeout=5)
        except subprocess.TimeoutExpired:
            SYNC_PROCESS.kill()
        SYNC_PROCESS = None
        logger.info("Sync script parado pelo usuário.")
        return SyncStatus(running=False, message="Script parado com sucesso.")
    except Exception as e:
        logger.exception("Erro ao parar sync: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sync/logs")
def get_sync_logs(lines: int = 100):
    try:
        if not _LOG_PATH.exists():
            return {"logs": ["Arquivo de log não encontrado. Inicie o serviço para gerar logs em logs/sync/."]}

        with open(_LOG_PATH, "r", encoding="utf-8", errors="ignore") as f:
            all_lines = f.readlines()

        last_lines = all_lines[-lines:]
        return {"logs": [line.rstrip() for line in last_lines]}
    except Exception as e:
        logger.exception("Erro lendo logs de sync: %s", e)
        return {"logs": [f"Erro ao ler logs: {str(e)}"]}
