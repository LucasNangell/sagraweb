"""Reinício assíncrono dos serviços Windows SAGRA (produção)."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

STATUS_FILENAME = "system_restart_status.json"
LOG_FILENAME = "system_restart.log"
SCRIPT_NAME = "reiniciar-servicos-sagra.ps1"
COOLDOWN_SECONDS = 180
IN_PROGRESS_MAX_AGE_SECONDS = 600
# Helper que nunca atualizou o status (só "helper iniciado") é abandonado cedo.
ABANDONED_HELPER_SECONDS = 90
DEFAULT_SERVICES = (
    "SAGRA-SyncAndamentos",
    "SAGRA-MonitorSyncAndamentos",
    "SAGRA-OrganizadorEmailSepim",
    "SAGRA-Api",
)

# Evita que o job object do NSSM mate o helper quando a API for reiniciada.
_CREATE_BREAKAWAY_FROM_JOB = 0x01000000


class SystemRestartError(Exception):
    def __init__(self, message: str, *, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(value: Any) -> Optional[float]:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def resolve_system_root() -> Optional[Path]:
    env = (os.getenv("SAGRA_SYSTEM_ROOT") or "").strip()
    if env:
        path = Path(env)
        if path.is_dir():
            return path.resolve()
    starts = (Path.cwd(), Path(__file__).resolve().parent)
    for start in starts:
        for ancestor in (start, *list(start.parents)[:6]):
            try:
                if (ancestor / "shared").is_dir() and (
                    (ancestor / "current").is_dir() or (ancestor / "releases").is_dir()
                ):
                    return ancestor.resolve()
            except OSError:
                continue
    return None


def resolve_status_path(*, system_root: Optional[Path] = None) -> Path:
    env = (os.getenv("SAGRA_SYSTEM_RESTART_STATUS_FILE") or "").strip()
    if env:
        return Path(env)
    root = system_root or resolve_system_root()
    if root is not None:
        return root / "shared" / "run" / STATUS_FILENAME
    return Path.cwd() / "shared" / "run" / STATUS_FILENAME


def resolve_log_path(*, system_root: Optional[Path] = None) -> Path:
    env = (os.getenv("SAGRA_SYSTEM_RESTART_LOG_FILE") or "").strip()
    if env:
        return Path(env)
    root = system_root or resolve_system_root()
    if root is not None:
        return root / "shared" / "logs" / "system" / LOG_FILENAME
    return Path.cwd() / "shared" / "logs" / "system" / LOG_FILENAME


def resolve_restart_script(*, system_root: Optional[Path] = None) -> Optional[Path]:
    env = (os.getenv("SAGRA_SYSTEM_RESTART_SCRIPT") or "").strip()
    if env:
        path = Path(env)
        return path if path.is_file() else None
    root = system_root or resolve_system_root()
    candidates: list[Path] = []
    if root is not None:
        candidates.extend(
            [
                root / "current" / SCRIPT_NAME,
                root / SCRIPT_NAME,
            ]
        )
    here = Path(__file__).resolve()
    repo_root = here.parents[3]
    candidates.extend(
        [
            repo_root / "deploy" / "templates" / SCRIPT_NAME,
            repo_root / SCRIPT_NAME,
            Path.cwd() / SCRIPT_NAME,
        ]
    )
    for path in candidates:
        try:
            if path.is_file():
                return path.resolve()
        except OSError:
            continue
    return None


def read_restart_status(*, path: Optional[Path] = None) -> dict[str, Any]:
    status_path = path or resolve_status_path()
    empty: dict[str, Any] = {
        "request_id": None,
        "phase": "idle",
        "ok": None,
        "reason": None,
        "started_at": None,
        "finished_at": None,
        "services": [],
        "detail": None,
        "path": str(status_path),
        "log_file": None,
    }
    try:
        if not status_path.is_file():
            return empty
        raw = status_path.read_text(encoding="utf-8-sig")
        data = json.loads(raw) if raw.strip() else {}
        if not isinstance(data, dict):
            return empty
        out = dict(empty)
        out.update(
            {
                "request_id": data.get("request_id"),
                "phase": data.get("phase") or "idle",
                "ok": data.get("ok"),
                "reason": data.get("reason"),
                "started_at": data.get("started_at"),
                "finished_at": data.get("finished_at"),
                "services": data.get("services") if isinstance(data.get("services"), list) else [],
                "detail": data.get("detail"),
                "pid": data.get("pid"),
                "log_file": data.get("log_file"),
            }
        )
        return out
    except OSError as exc:
        logger.warning("Falha ao ler status de reinício %s: %s", status_path, exc)
        return empty
    except json.JSONDecodeError as exc:
        logger.warning("Status de reinício inválido em %s: %s", status_path, exc)
        return empty


def write_restart_status(payload: dict[str, Any], *, path: Optional[Path] = None) -> Path:
    status_path = path or resolve_status_path()
    status_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = status_path.with_suffix(status_path.suffix + f".{os.getpid()}.tmp")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(status_path)
    return status_path


def _is_abandoned_helper(status: dict[str, Any], *, now_ts: float) -> bool:
    """True quando o helper nunca reportou progresso (status ficou em 'helper iniciado')."""
    phase = str(status.get("phase") or "")
    if phase not in ("running", "queued"):
        return False
    started = _parse_iso(status.get("started_at"))
    if started is None:
        return False
    age = now_ts - started
    if age < ABANDONED_HELPER_SECONDS:
        return False
    services = status.get("services") or []
    detail = str(status.get("detail") or "").lower()
    if services:
        return age >= IN_PROGRESS_MAX_AGE_SECONDS
    return detail in {
        "helper iniciado",
        "solicitação aceita; iniciando helper",
        "solicitacao aceita; iniciando helper",
        "",
    }


def _assert_can_start(status: dict[str, Any], *, now: Optional[float] = None) -> None:
    now_ts = time.time() if now is None else now
    phase = str(status.get("phase") or "idle")
    started = _parse_iso(status.get("started_at"))
    finished = _parse_iso(status.get("finished_at"))

    if phase in ("running", "queued") and started is not None:
        if _is_abandoned_helper(status, now_ts=now_ts):
            logger.warning(
                "Ignorando reinício abandonado id=%s detail=%s age=%.0fs",
                status.get("request_id"),
                status.get("detail"),
                now_ts - started,
            )
        else:
            age = now_ts - started
            if age < IN_PROGRESS_MAX_AGE_SECONDS:
                raise SystemRestartError(
                    "Já existe um reinício em andamento. Aguarde a conclusão.",
                    status_code=409,
                )

    last_done = finished or (started if phase == "done" else None)
    if last_done is not None and phase == "done":
        elapsed = now_ts - last_done
        if elapsed < COOLDOWN_SECONDS:
            wait = int(COOLDOWN_SECONDS - elapsed) + 1
            raise SystemRestartError(
                f"Aguarde {wait}s antes de solicitar outro reinício.",
                status_code=429,
            )


def request_system_restart(
    *,
    reason: str = "reinicio via UI",
    requested_by: str = "",
    system_root: Optional[Path] = None,
    status_path: Optional[Path] = None,
    script_path: Optional[Path] = None,
    log_path: Optional[Path] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    if sys.platform != "win32":
        raise SystemRestartError(
            "Reinício de serviços só disponível no Windows Server.",
            status_code=501,
        )

    root = system_root or resolve_system_root()
    script = script_path if script_path is not None else resolve_restart_script(system_root=root)
    if script is None or not script.is_file():
        raise SystemRestartError(
            f"Script {SCRIPT_NAME} não encontrado na release.",
            status_code=503,
        )

    status_file = status_path or resolve_status_path(system_root=root)
    log_file = log_path or resolve_log_path(system_root=root)
    current = read_restart_status(path=status_file)
    _assert_can_start(current)

    request_id = uuid.uuid4().hex
    started_at = _utc_now_iso()
    payload: dict[str, Any] = {
        "request_id": request_id,
        "phase": "queued",
        "ok": None,
        "reason": reason[:200],
        "started_at": started_at,
        "finished_at": None,
        "services": [],
        "detail": "solicitação aceita; iniciando helper",
        "requested_by": requested_by or None,
        "pid": None,
        "log_file": str(log_file),
    }
    write_restart_status(payload, path=status_file)

    if dry_run:
        payload["phase"] = "done"
        payload["ok"] = True
        payload["finished_at"] = _utc_now_iso()
        payload["detail"] = "dry_run"
        write_restart_status(payload, path=status_file)
        return payload

    root_arg = str(root) if root is not None else ""
    ps_args = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-RequestId",
        request_id,
        "-StatusFile",
        str(status_file),
        "-LogFile",
        str(log_file),
        "-Reason",
        reason[:200],
    ]
    if root_arg:
        ps_args.extend(["-Root", root_arg])

    creationflags = 0
    if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        creationflags |= subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    if hasattr(subprocess, "DETACHED_PROCESS"):
        creationflags |= subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        creationflags |= subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
    creationflags |= _CREATE_BREAKAWAY_FROM_JOB

    log_file.parent.mkdir(parents=True, exist_ok=True)
    try:
        # append mode: o .ps1 também escreve neste arquivo via Add-Content
        log_handle = open(log_file, "a", encoding="utf-8", errors="replace")
        log_handle.write(
            f"\n{_utc_now_iso()} API spawn helper id={request_id} by={requested_by} "
            f"script={script}\n"
        )
        log_handle.flush()
    except OSError as exc:
        payload["phase"] = "done"
        payload["ok"] = False
        payload["finished_at"] = _utc_now_iso()
        payload["detail"] = f"falha ao abrir log do helper: {exc}"
        write_restart_status(payload, path=status_file)
        raise SystemRestartError(
            f"Não foi possível iniciar o reinício (log): {exc}",
            status_code=500,
        ) from exc

    try:
        proc = subprocess.Popen(
            ps_args,
            cwd=str(script.parent),
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=log_handle,
            close_fds=False,
            creationflags=creationflags,
        )
    except OSError as exc:
        try:
            log_handle.close()
        except OSError:
            pass
        payload["phase"] = "done"
        payload["ok"] = False
        payload["finished_at"] = _utc_now_iso()
        payload["detail"] = f"falha ao iniciar helper: {exc}"
        write_restart_status(payload, path=status_file)
        raise SystemRestartError(
            f"Não foi possível iniciar o reinício: {exc}",
            status_code=500,
        ) from exc
    finally:
        # O filho herda o handle; fechar no pai não corta o pipe no Windows com DETACHED.
        try:
            log_handle.close()
        except OSError:
            pass

    payload["phase"] = "running"
    payload["pid"] = proc.pid
    payload["detail"] = "helper iniciado"
    write_restart_status(payload, path=status_file)
    logger.warning(
        "Reinício de sistema solicitado id=%s by=%s pid=%s log=%s services=%s",
        request_id,
        requested_by,
        proc.pid,
        log_file,
        ",".join(DEFAULT_SERVICES),
    )
    return payload
