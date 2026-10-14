"""Watchdog de disponibilidade do SAGRA Web.

Monitora separadamente:

* liveness da API (processo/event loop);
* readiness da API (inclui MySQL, apenas para diagnostico);
* estado e heartbeat do servico SAGRA-SyncAndamentos.

Somente falhas recuperaveis disparam uma acao. Indisponibilidade isolada de MySQL
ou MDB e reportada, mas nao causa restart em loop. O estado de recuperacao e
persistido para preservar cooldown e circuit breaker apos restart do watchdog.
"""

from __future__ import annotations

import ctypes
import hashlib
import json
import logging
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


WATCHDOG_SERVICE_NAME = "SAGRA-SystemWatchdog"
WATCHDOG_VERSION = "1.0.0"
DEFAULT_SYNC_SERVICE_NAME = "SAGRA-SyncAndamentos"
MUTEX_NAME = os.getenv("SYSTEM_WATCHDOG_MUTEX_NAME", r"Global\SagraSystemWatchdog")
SERVICE_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_service_name(value: str, *, field_name: str) -> str:
    value = value.strip()
    if not SERVICE_NAME_RE.fullmatch(value):
        raise ValueError(f"{field_name} invalido")
    return value


def _absolute_path(value: Any) -> Path:
    """Normaliza sem resolver junctions; `current` precisa acompanhar novos deploys."""
    return Path(os.path.abspath(os.path.expanduser(os.fspath(value))))


def _default_system_root(script_dir: Path) -> Path:
    configured = os.getenv("SYSTEM_WATCHDOG_ROOT", "").strip()
    if configured:
        return _absolute_path(configured)
    if script_dir.name.lower() == "current":
        return _absolute_path(script_dir.parent)
    return _absolute_path(script_dir)


def default_maintenance_file(script_dir: Path) -> Path:
    hint = os.getenv("SYSTEM_WATCHDOG_MAINTENANCE_FILE", "").strip()
    if hint:
        return _absolute_path(hint)
    system_root = _default_system_root(_absolute_path(script_dir))
    return _absolute_path(system_root / "shared" / "run" / "system-watchdog.maintenance")


@dataclass(frozen=True)
class WatchdogConfig:
    system_root: Path
    current_root: Path
    log_dir: Path
    maintenance_file: Path
    api_port: int
    api_service_name: str
    sync_service_name: str
    poll_seconds: int
    http_timeout_seconds: int
    failure_threshold: int
    cooldown_seconds: int
    max_actions: int
    action_window_seconds: int
    circuit_break_seconds: int
    startup_grace_seconds: int
    recovery_grace_seconds: int
    sync_stale_seconds: int
    maintenance_max_seconds: int
    sync_request_ttl_seconds: int = 600

    @classmethod
    def from_environment(cls, script_dir: Optional[Path] = None) -> "WatchdogConfig":
        script_dir = _absolute_path(script_dir or Path(__file__).absolute().parent)
        system_root = _default_system_root(script_dir)
        current_hint = os.getenv("SYSTEM_WATCHDOG_CURRENT_ROOT", "").strip()
        if current_hint:
            current_root = _absolute_path(current_hint)
        elif (system_root / "current").is_dir():
            current_root = _absolute_path(system_root / "current")
        else:
            current_root = script_dir

        log_hint = os.getenv("SYSTEM_WATCHDOG_LOG_DIR", "").strip()
        if log_hint:
            log_dir = _absolute_path(log_hint)
        elif (system_root / "shared").is_dir():
            log_dir = _absolute_path(system_root / "shared" / "logs" / "system")
        else:
            log_dir = _absolute_path(current_root / "logs" / "system")

        maintenance_hint = os.getenv("SYSTEM_WATCHDOG_MAINTENANCE_FILE", "").strip()
        maintenance_file = (
            _absolute_path(maintenance_hint)
            if maintenance_hint
            else _absolute_path(
                system_root / "shared" / "run" / "system-watchdog.maintenance"
            )
        )

        api_service = os.getenv("SYSTEM_WATCHDOG_API_SERVICE_NAME", "").strip()
        if api_service:
            api_service = _safe_service_name(
                api_service, field_name="SYSTEM_WATCHDOG_API_SERVICE_NAME"
            )
        sync_service = _safe_service_name(
            os.getenv("SYNC_ANDAMENTOS_SERVICE_NAME", DEFAULT_SYNC_SERVICE_NAME),
            field_name="SYNC_ANDAMENTOS_SERVICE_NAME",
        )

        api_port = _read_api_port(
            current_root / "config" / ".env",
            default=_env_int("SAGRA_SERVER_PORT", 8050, 1, 65535),
        )
        return cls(
            system_root=system_root,
            current_root=current_root,
            log_dir=log_dir,
            maintenance_file=maintenance_file,
            api_port=api_port,
            api_service_name=api_service,
            sync_service_name=sync_service,
            poll_seconds=_env_int("SYSTEM_WATCHDOG_POLL_SECONDS", 20, 5, 300),
            http_timeout_seconds=_env_int("SYSTEM_WATCHDOG_HTTP_TIMEOUT", 5, 1, 30),
            failure_threshold=_env_int("SYSTEM_WATCHDOG_FAILURE_THRESHOLD", 3, 1, 20),
            cooldown_seconds=_env_int("SYSTEM_WATCHDOG_COOLDOWN_SECONDS", 180, 30, 3600),
            max_actions=_env_int("SYSTEM_WATCHDOG_MAX_ACTIONS", 3, 1, 20),
            action_window_seconds=_env_int(
                "SYSTEM_WATCHDOG_ACTION_WINDOW_SECONDS", 900, 60, 86400
            ),
            circuit_break_seconds=_env_int(
                "SYSTEM_WATCHDOG_CIRCUIT_BREAK_SECONDS", 900, 60, 86400
            ),
            startup_grace_seconds=_env_int(
                "SYSTEM_WATCHDOG_STARTUP_GRACE_SECONDS", 90, 0, 1800
            ),
            recovery_grace_seconds=_env_int(
                "SYSTEM_WATCHDOG_RECOVERY_GRACE_SECONDS", 90, 10, 1800
            ),
            sync_stale_seconds=_env_int(
                "SYSTEM_WATCHDOG_SYNC_STALE_SECONDS", 180, 30, 3600
            ),
            maintenance_max_seconds=_env_int(
                "SYSTEM_WATCHDOG_MAINTENANCE_MAX_SECONDS", 1800, 60, 86400
            ),
            sync_request_ttl_seconds=_env_int(
                "SYSTEM_WATCHDOG_SYNC_REQUEST_TTL_SECONDS", 600, 60, 3600
            ),
        )


def _read_api_port(env_path: Path, default: int = 8050) -> int:
    """Le somente PORT; nunca carrega ou registra segredos do arquivo .env."""
    try:
        for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip().upper() == "PORT":
                port = int(value.strip().strip('"').strip("'"))
                return port if 1 <= port <= 65535 else default
    except (OSError, ValueError):
        pass
    return default


@dataclass
class RecoveryPolicy:
    failure_threshold: int = 3
    cooldown_seconds: int = 180
    max_actions: int = 3
    action_window_seconds: int = 900
    circuit_break_seconds: int = 900


@dataclass
class RecoveryState:
    consecutive_failures: int = 0
    last_action_at: float = 0.0
    action_history: List[float] = field(default_factory=list)
    circuit_open_until: float = 0.0
    last_reason: str = ""
    handled_request_id: str = ""
    unhealthy_since: float = 0.0
    last_action_ok: Optional[bool] = None
    last_action_detail: str = ""


@dataclass(frozen=True)
class RecoveryDecision:
    should_act: bool
    phase: str


def note_healthy(state: RecoveryState, now: float) -> None:
    state.consecutive_failures = 0
    state.last_reason = ""
    state.unhealthy_since = 0.0
    state.action_history = [t for t in state.action_history if t >= now - 86400]
    if state.circuit_open_until and now >= state.circuit_open_until:
        state.circuit_open_until = 0.0


def note_failure(
    state: RecoveryState,
    *,
    now: float,
    reason: str,
    policy: RecoveryPolicy,
) -> RecoveryDecision:
    state.last_reason = reason[:500]
    state.consecutive_failures += 1
    if not state.unhealthy_since:
        state.unhealthy_since = now
    state.action_history = [
        t for t in state.action_history if t >= now - policy.action_window_seconds
    ]

    if state.circuit_open_until > now:
        return RecoveryDecision(False, "circuit_open")
    if state.circuit_open_until:
        state.circuit_open_until = 0.0
    if state.consecutive_failures < policy.failure_threshold:
        return RecoveryDecision(False, "confirming_failure")
    if state.last_action_at and now - state.last_action_at < policy.cooldown_seconds:
        return RecoveryDecision(False, "cooldown")
    if len(state.action_history) >= policy.max_actions:
        state.circuit_open_until = now + policy.circuit_break_seconds
        state.consecutive_failures = 0
        return RecoveryDecision(False, "circuit_opened")

    state.last_action_at = now
    state.action_history.append(now)
    state.consecutive_failures = 0
    return RecoveryDecision(True, "recovery_requested")


class StateStore:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> Dict[str, RecoveryState]:
        result = {"api": RecoveryState(), "sync": RecoveryState()}
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                return result
            now = time.time()
            for key in result:
                value = raw.get(key) or {}
                if not isinstance(value, dict):
                    continue
                history = [
                    float(item)
                    for item in value.get("action_history", [])
                    if _valid_timestamp(item) and float(item) <= now + 300
                ][-100:]
                result[key] = RecoveryState(
                    consecutive_failures=max(
                        0, min(1000, int(value.get("consecutive_failures", 0)))
                    ),
                    last_action_at=_timestamp_or_zero(
                        value.get("last_action_at"), now=now
                    ),
                    action_history=history,
                    circuit_open_until=_timestamp_or_zero(
                        value.get("circuit_open_until"), now=now
                    ),
                    last_reason=str(value.get("last_reason", ""))[:500],
                    handled_request_id=str(value.get("handled_request_id", ""))[:64],
                    unhealthy_since=_timestamp_or_zero(
                        value.get("unhealthy_since"), now=now
                    ),
                    last_action_ok=value.get("last_action_ok")
                    if isinstance(value.get("last_action_ok"), bool)
                    else None,
                    last_action_detail=str(value.get("last_action_detail") or "")[:500],
                )
        except (OSError, ValueError, TypeError, AttributeError, json.JSONDecodeError):
            pass
        return result

    def write(self, states: Dict[str, RecoveryState]) -> None:
        body = {key: asdict(value) for key, value in states.items()}
        _atomic_json_write(self.path, body)


def _valid_timestamp(value: Any) -> bool:
    try:
        number = float(value)
        return math.isfinite(number) and number >= 0
    except (TypeError, ValueError):
        return False


def _timestamp_or_zero(value: Any, *, now: Optional[float] = None) -> float:
    if not _valid_timestamp(value):
        return 0.0
    number = float(value)
    if now is not None and number > now + 300:
        return 0.0
    return number


def _atomic_json_write(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class InstanceMutex:
    ERROR_ALREADY_EXISTS = 183

    def __init__(self, name: str = MUTEX_NAME):
        self.name = name
        self._handle = None

    def acquire(self) -> bool:
        if sys.platform != "win32":
            return True
        handle = ctypes.windll.kernel32.CreateMutexW(None, False, self.name)
        if not handle:
            return False
        self._handle = handle
        if ctypes.windll.kernel32.GetLastError() == self.ERROR_ALREADY_EXISTS:
            ctypes.windll.kernel32.CloseHandle(handle)
            self._handle = None
            return False
        return True

    def release(self) -> None:
        if self._handle is not None:
            try:
                ctypes.windll.kernel32.CloseHandle(self._handle)
            finally:
                self._handle = None


def setup_logging(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("sagra_system_watchdog")
    logger.handlers.clear()
    logger.setLevel(logging.INFO)
    logger.propagate = False
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    file_handler = RotatingFileHandler(
        log_dir / "system_watchdog.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    if sys.stdout is not None:
        stream = logging.StreamHandler(sys.stdout)
        stream.setFormatter(formatter)
        logger.addHandler(stream)
    return logger


def probe_http_json(url: str, timeout_seconds: int) -> Dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "SAGRA-SystemWatchdog/1"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            body = response.read(65536)
            payload = json.loads(body.decode("utf-8")) if body else {}
            return {
                "ok": response.status == 200,
                "status_code": response.status,
                "payload": payload if isinstance(payload, dict) else {},
                "error": None,
            }
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(65536)
            payload = json.loads(body.decode("utf-8")) if body else {}
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            payload = {}
        return {
            "ok": False,
            "status_code": int(exc.code),
            "payload": payload if isinstance(payload, dict) else {},
            "error": f"HTTP {exc.code}",
        }
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return {
            "ok": False,
            "status_code": 0,
            "payload": {},
            "error": f"{type(exc).__name__}: {exc}"[:500],
        }


SERVICE_STATES = {
    1: "Stopped",
    2: "StartPending",
    3: "StopPending",
    4: "Running",
    5: "ContinuePending",
    6: "PausePending",
    7: "Paused",
}
SERVICE_TRANSITION_STATES = frozenset(
    {"StartPending", "StopPending", "ContinuePending", "PausePending"}
)
SERVICE_SETTLE_TIMEOUT_SECONDS = 45.0


def query_windows_service(service_name: str) -> Dict[str, Any]:
    if sys.platform != "win32":
        return {"exists": False, "status": None, "query_ok": False, "error": "not_windows"}
    try:
        completed = subprocess.run(
            [_system_executable("sc.exe"), "query", service_name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        output = f"{completed.stdout}\n{completed.stderr}"
        match = re.search(r"(?:STATE|ESTADO)\s*:\s*(\d+)", output, re.IGNORECASE)
        if match:
            code = int(match.group(1))
            return {
                "exists": True,
                "status": SERVICE_STATES.get(code, f"State{code}"),
                "query_ok": True,
                "error": None,
            }
        missing = "1060" in output or "does not exist" in output.lower() or "n\u00e3o existe" in output.lower()
        return {
            "exists": not missing,
            "status": None,
            "query_ok": False,
            "error": f"sc query exit={completed.returncode}",
        }
    except (OSError, subprocess.SubprocessError) as exc:
        return {
            "exists": False,
            "status": None,
            "query_ok": False,
            "error": f"{type(exc).__name__}: {exc}"[:500],
        }


def resolve_nssm_path(roots: List[Path]) -> Optional[Path]:
    candidates: List[Path] = []
    hint = os.getenv("SYSTEM_WATCHDOG_NSSM_PATH", "").strip()
    if hint:
        candidates.append(Path(hint))
    for root in roots:
        candidates.append(root / "deploy" / "tools" / "nssm.exe")
        candidates.append(root / "tools" / "nssm.exe")
    found = shutil.which("nssm.exe") or shutil.which("nssm")
    if found:
        candidates.append(Path(found))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def _resolve_nssm(config: WatchdogConfig) -> Optional[Path]:
    return resolve_nssm_path([config.current_root, config.system_root])


def _system_executable(name: str) -> str:
    if sys.platform != "win32":
        return name
    system_root = Path(os.environ.get("SystemRoot") or r"C:\Windows")
    candidate = system_root / "System32" / name
    return str(candidate) if candidate.is_file() else name


def _run_command(args: List[str], timeout: int = 120) -> Tuple[bool, str]:
    try:
        completed = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        detail = (completed.stderr or completed.stdout or "").strip()[:500]
        return completed.returncode == 0, detail
    except (OSError, subprocess.SubprocessError) as exc:
        return False, f"{type(exc).__name__}: {exc}"[:500]


def wait_service_settled(
    service_name: str,
    timeout_seconds: float = SERVICE_SETTLE_TIMEOUT_SECONDS,
    poll_seconds: float = 1.0,
) -> Optional[str]:
    """Aguarda o servico sair de *Pending e devolve o estado final (ou None)."""
    deadline = time.monotonic() + timeout_seconds
    status = query_windows_service(service_name).get("status")
    while status in SERVICE_TRANSITION_STATES and time.monotonic() < deadline:
        time.sleep(poll_seconds)
        status = query_windows_service(service_name).get("status")
    return status


def control_service(
    service_name: str,
    nssm: Optional[Path],
    *,
    start_only: bool = False,
) -> Tuple[bool, str]:
    if nssm:
        verb = "start" if start_only else "restart"
        return _run_command([str(nssm), verb, service_name])
    if not start_only:
        _run_command([_system_executable("sc.exe"), "stop", service_name], timeout=60)
        if wait_service_settled(service_name, timeout_seconds=30) != "Stopped":
            return False, "sc stop nao concluiu; start nao enviado"
    return _run_command([_system_executable("sc.exe"), "start", service_name], timeout=60)


def recover_service(
    service_name: str,
    nssm: Optional[Path],
    *,
    start_only: bool = False,
) -> Tuple[bool, str]:
    """Inicia/reinicia e confirma Running; uma parada lenta nao deixa o servico Stopped."""
    _ok, detail = control_service(service_name, nssm, start_only=start_only)
    status = wait_service_settled(service_name)
    if status == "Stopped":
        _ok, retry_detail = control_service(service_name, nssm, start_only=True)
        detail = f"{detail} | start apos parada: {retry_detail}"
        status = wait_service_settled(service_name)
    if status == "Running":
        return True, (detail or "Running")[:500]
    return False, f"status final={status}; {detail}"[:500]


def control_windows_service(
    config: WatchdogConfig,
    service_name: str,
    *,
    start_only: bool = False,
) -> Tuple[bool, str]:
    return recover_service(service_name, _resolve_nssm(config), start_only=start_only)


def _path_is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def restart_api(config: WatchdogConfig) -> Tuple[bool, str]:
    if config.api_service_name:
        service = query_windows_service(config.api_service_name)
        if not service.get("exists"):
            return False, f"servico API nao encontrado: {config.api_service_name}"
        return control_windows_service(
            config,
            config.api_service_name,
            start_only=service.get("status") == "Stopped",
        )

    launcher = config.current_root / "iniciar-api-detached.ps1"
    if not launcher.is_file() or not _path_is_within(launcher, config.current_root):
        return False, f"launcher seguro nao encontrado: {launcher}"
    return _run_command(
        [
            _system_executable(r"WindowsPowerShell\v1.0\powershell.exe"),
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(launcher),
            "-Root",
            str(config.current_root),
        ],
        timeout=120,
    )


def resolve_sync_root(config: WatchdogConfig) -> Path:
    configured = os.getenv("SYSTEM_WATCHDOG_SYNC_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    nssm = _resolve_nssm(config)
    if nssm and sys.platform == "win32":
        ok, output = _run_command(
            [str(nssm), "get", config.sync_service_name, "AppDirectory"], timeout=15
        )
        if ok and output:
            candidate = Path(output.splitlines()[-1].strip().strip('"'))
            if candidate.is_dir():
                return candidate.resolve()
    fixed = config.system_root / "sync-runtime"
    return fixed.resolve() if fixed.is_dir() else config.current_root


def _parse_iso_timestamp(value: Any) -> Optional[float]:
    if not value or not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except ValueError:
        return None


def probe_sync_heartbeat(path: Path, now: float, stale_seconds: int) -> Dict[str, Any]:
    if not path.is_file():
        return {"healthy": False, "phase": "missing", "age_seconds": None, "error": "heartbeat ausente"}
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(payload, dict):
            raise ValueError("JSON nao e objeto")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return {
            "healthy": False,
            "phase": "invalid",
            "age_seconds": None,
            "error": f"heartbeat invalido: {exc}"[:500],
        }

    phase = str(payload.get("phase") or "unknown")[:100]
    cycle_reference = _parse_iso_timestamp(payload.get("last_cycle_at"))
    if cycle_reference is None:
        return {
            "healthy": False,
            "phase": phase,
            "age_seconds": None,
            "error": "last_cycle_at ausente/invalido",
        }
    if cycle_reference > now + 60:
        return {
            "healthy": False,
            "external_dependency": False,
            "phase": phase,
            "age_seconds": None,
            "error": "last_cycle_at esta no futuro",
        }
    age = max(0.0, now - cycle_reference)
    if phase == "mdb_unavailable":
        # mark_skip_cycle atualiza last_cycle_at a cada tentativa mesmo sem MDB.
        # Logo, phase=mdb_unavailable so e dependencia externa se o ciclo continua vivo.
        return {
            "healthy": age <= stale_seconds,
            "external_dependency": age <= stale_seconds,
            "phase": phase,
            "age_seconds": round(age, 1),
            "error": None if age <= stale_seconds else "heartbeat stale em mdb_unavailable",
        }
    return {
        "healthy": age <= stale_seconds,
        "external_dependency": False,
        "phase": phase,
        "age_seconds": round(age, 1),
        "error": None if age <= stale_seconds else "heartbeat stale",
    }


MONITOR_STATUS_FILENAME = "sync_divergencia_monitor.json"
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def read_sync_recovery_request(path: Path, now: float, ttl_seconds: int) -> Optional[Dict[str, Any]]:
    """Pedido do monitor de divergencia; so vale se recente e bem formado."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None
    request = payload.get("recovery_request") if isinstance(payload, dict) else None
    if not isinstance(request, dict):
        return None
    request_id = request.get("id")
    if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id):
        return None
    requested_at = _parse_iso_timestamp(request.get("requested_at"))
    if requested_at is None or requested_at > now + 60 or now - requested_at > ttl_seconds:
        return None
    return {
        "id": request_id,
        "reason": str(request.get("reason") or "divergencia MDB/MySQL")[:200],
        "age_seconds": round(max(0.0, now - requested_at), 1),
    }


def maintenance_status(path: Path, now: float, max_age_seconds: int) -> Dict[str, Any]:
    if not path.is_file():
        return {"active": False, "stale": False, "age_seconds": None, "reason": None}
    try:
        modified_at = path.stat().st_mtime
        if modified_at > now + 60:
            return {
                "active": False,
                "stale": True,
                "age_seconds": None,
                "reason": "mtime do lock esta no futuro",
            }
        age = max(0.0, now - modified_at)
        reason = ""
        effective_max_age = max_age_seconds
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            if isinstance(payload, dict):
                reason = str(payload.get("reason") or payload.get("owner") or "")[:200]
                requested_minutes = payload.get("requested_minutes")
                if requested_minutes is not None:
                    requested_seconds = max(60, int(requested_minutes) * 60)
                    effective_max_age = min(max_age_seconds, requested_seconds)
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        return {
            "active": age <= effective_max_age,
            "stale": age > effective_max_age,
            "age_seconds": round(age, 1),
            "reason": reason or None,
        }
    except OSError as exc:
        return {
            "active": False,
            "stale": False,
            "age_seconds": None,
            "reason": f"erro ao ler lock: {exc}"[:200],
        }


class SystemWatchdog:
    def __init__(self, config: WatchdogConfig, log: logging.Logger):
        self.config = config
        self.log = log
        self._stop = threading.Event()
        self._started_at = _utc_now()
        try:
            self._code_sha256 = _file_sha256(Path(__file__).absolute())
        except OSError:
            self._code_sha256 = "unavailable"
        self._control_dir = config.maintenance_file.parent
        self._state_store = StateStore(self._control_dir / "system_watchdog_state.json")
        self._states = self._state_store.load()
        now = time.time()
        self._grace_until = {
            "api": now + config.startup_grace_seconds,
            "sync": now + config.startup_grace_seconds,
        }
        self._maintenance_was_active = False
        self._last_summary = ""
        self._policy = RecoveryPolicy(
            failure_threshold=config.failure_threshold,
            cooldown_seconds=config.cooldown_seconds,
            max_actions=config.max_actions,
            action_window_seconds=config.action_window_seconds,
            circuit_break_seconds=config.circuit_break_seconds,
        )

    def request_stop(self, *_args: Any) -> None:
        self._stop.set()

    def _recover(
        self,
        component: str,
        reason: str,
        now: float,
        maintenance: bool,
        action,
    ) -> Dict[str, Any]:
        state = self._states[component]
        if maintenance:
            state.consecutive_failures = 0
            return {"phase": "maintenance", "attempted": False, "ok": None}
        if now < self._grace_until[component]:
            state.consecutive_failures = 0
            return {
                "phase": "grace",
                "attempted": False,
                "ok": None,
                "grace_remaining_seconds": round(self._grace_until[component] - now, 1),
            }
        decision = note_failure(state, now=now, reason=reason, policy=self._policy)
        if decision.phase == "circuit_opened":
            self.log.error(
                "CIRCUIT_OPEN component=%s ate=%s reason=%s",
                component,
                datetime.fromtimestamp(state.circuit_open_until, timezone.utc).isoformat(),
                reason,
            )
        result: Dict[str, Any] = {
            "phase": decision.phase,
            "attempted": decision.should_act,
            "ok": None,
        }
        if decision.should_act:
            self.log.warning("RECOVERY component=%s reason=%s", component, reason)
            ok, detail = action()
            result.update({"ok": ok, "detail": detail[:500] if detail else None})
            state.last_action_ok = bool(ok)
            state.last_action_detail = (detail or "")[:500]
            if ok:
                self._grace_until[component] = now + self.config.recovery_grace_seconds
                self.log.info("RECOVERY_OK component=%s", component)
            else:
                self.log.error("RECOVERY_FAILED component=%s detail=%s", component, detail)
        return result

    def run_once(self, now: Optional[float] = None) -> Dict[str, Any]:
        now = time.time() if now is None else now
        maintenance = maintenance_status(
            self.config.maintenance_file,
            now,
            self.config.maintenance_max_seconds,
        )
        if self._maintenance_was_active and not maintenance["active"]:
            self._grace_until = {
                "api": now + self.config.startup_grace_seconds,
                "sync": now + self.config.startup_grace_seconds,
            }
        self._maintenance_was_active = bool(maintenance["active"])

        base = f"http://127.0.0.1:{self.config.api_port}"
        live = probe_http_json(f"{base}/health/live", self.config.http_timeout_seconds)
        live_ok = bool(live["ok"] and live["payload"].get("status") == "ok")
        ready = probe_http_json(f"{base}/health", self.config.http_timeout_seconds)
        ready_ok = bool(
            ready["ok"]
            and ready["payload"].get("status") == "ok"
            and ready["payload"].get("db") == "ok"
        )
        if live_ok:
            note_healthy(self._states["api"], now)
            api_recovery = {"phase": "healthy", "attempted": False, "ok": None}
        else:
            api_recovery = self._recover(
                "api",
                live.get("error") or "liveness invalido",
                now,
                bool(maintenance["active"]),
                lambda: restart_api(self.config),
            )

        sync_service = query_windows_service(self.config.sync_service_name)
        sync_root = resolve_sync_root(self.config)
        heartbeat_path = sync_root / "logs" / "sync" / "sync_heartbeat.json"
        heartbeat: Dict[str, Any] = {
            "healthy": False,
            "phase": "not_checked",
            "age_seconds": None,
            "error": None,
        }
        sync_status = sync_service.get("status")
        sync_state = self._states["sync"]
        request = read_sync_recovery_request(
            sync_root / "logs" / "sync" / MONITOR_STATUS_FILENAME,
            now,
            self.config.sync_request_ttl_seconds,
        )
        pending_request = (
            request if request and request["id"] != sync_state.handled_request_id else None
        )
        if sync_service.get("exists") and sync_status == "Running":
            heartbeat = probe_sync_heartbeat(
                heartbeat_path, now, self.config.sync_stale_seconds
            )
            if heartbeat["healthy"] and pending_request:
                sync_recovery = self._recover(
                    "sync",
                    f"pedido do monitor: {pending_request['reason']}",
                    now,
                    bool(maintenance["active"]),
                    lambda: control_windows_service(
                        self.config, self.config.sync_service_name
                    ),
                )
            elif heartbeat["healthy"]:
                note_healthy(self._states["sync"], now)
                sync_recovery = {
                    "phase": "external_dependency"
                    if heartbeat.get("external_dependency")
                    else "healthy",
                    "attempted": False,
                    "ok": None,
                }
            else:
                sync_recovery = self._recover(
                    "sync",
                    heartbeat.get("error") or "heartbeat invalido",
                    now,
                    bool(maintenance["active"]),
                    lambda: control_windows_service(
                        self.config, self.config.sync_service_name
                    ),
                )
        elif sync_service.get("exists") and sync_status in {
            "StartPending",
            "StopPending",
            "ContinuePending",
            "PausePending",
        }:
            sync_recovery = self._recover(
                "sync",
                f"servico preso em transicao status={sync_status}",
                now,
                bool(maintenance["active"]),
                lambda: control_windows_service(
                    self.config, self.config.sync_service_name
                ),
            )
        elif sync_service.get("exists"):
            sync_recovery = self._recover(
                "sync",
                f"servico status={sync_status}",
                now,
                bool(maintenance["active"]),
                lambda: control_windows_service(
                    self.config,
                    self.config.sync_service_name,
                    start_only=sync_status == "Stopped",
                ),
            )
        else:
            sync_state.last_reason = "servico nao instalado ou consulta indisponivel"
            sync_state.consecutive_failures = min(
                1000, sync_state.consecutive_failures + 1
            )
            sync_recovery = {"phase": "not_installed", "attempted": False, "ok": None}
        if pending_request and sync_recovery["attempted"]:
            # Qualquer acao sobre o sync atende o pedido; nao repetir no mesmo episodio.
            sync_state.handled_request_id = pending_request["id"]

        api_view = {
            "healthy": live_ok and ready_ok,
            "liveness": {**live, "payload": _health_payload(live.get("payload"))},
            "readiness": {**ready, "payload": _health_payload(ready.get("payload"))},
            "dependency_degraded": live_ok and not ready_ok,
            "recovery": api_recovery,
            "state": asdict(self._states["api"]),
        }
        sync_view = {
            "healthy": bool(
                sync_service.get("exists")
                and sync_status == "Running"
                and heartbeat.get("healthy")
            ),
            "service": sync_service,
            "heartbeat": heartbeat,
            "heartbeat_path": str(heartbeat_path),
            "recovery_request": pending_request,
            "recovery": sync_recovery,
            "state": asdict(self._states["sync"]),
        }

        action_attempted = bool(api_recovery["attempted"] or sync_recovery["attempted"])
        if maintenance["active"]:
            overall = "maintenance"
        elif action_attempted:
            overall = "recovering"
        elif live_ok and ready_ok and sync_view["healthy"]:
            overall = "ok"
        elif live_ok and (
            api_view["dependency_degraded"] or heartbeat.get("external_dependency")
        ):
            overall = "external_dependency"
        else:
            overall = "degraded"

        payload = {
            "pid": os.getpid(),
            "service_name": WATCHDOG_SERVICE_NAME,
            "version": WATCHDOG_VERSION,
            "code_sha256": self._code_sha256,
            "started_at": self._started_at,
            "checked_at": _utc_now(),
            "overall": overall,
            "maintenance": {**maintenance, "path": str(self.config.maintenance_file)},
            "api": api_view,
            "sync": sync_view,
        }
        self._state_store.write(self._states)
        _atomic_json_write(self._control_dir / "system_watchdog_status.json", payload)

        summary = (
            f"overall={overall} api_live={live_ok} api_ready={ready_ok} "
            f"sync={sync_status} heartbeat={heartbeat.get('phase')}"
        )
        if summary != self._last_summary or overall not in {"ok", "external_dependency"}:
            self.log.info(summary)
            self._last_summary = summary
        return payload

    def run(self) -> int:
        self.log.info(
            "Watchdog iniciado root=%s current=%s api_port=%s sync=%s",
            self.config.system_root,
            self.config.current_root,
            self.config.api_port,
            self.config.sync_service_name,
        )
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:
                self.log.exception("Erro nao tratado no ciclo do watchdog")
            self._stop.wait(self.config.poll_seconds)
        self.log.info("Watchdog encerrado")
        return 0


def _health_payload(payload: Any) -> Dict[str, Any]:
    """Mantem somente campos operacionais, sem refletir conteudo arbitrario."""
    if not isinstance(payload, dict):
        return {}
    allowed = ("status", "db", "release", "deployed_at")
    return {key: payload[key] for key in allowed if key in payload}


def main() -> int:
    try:
        config = WatchdogConfig.from_environment()
    except Exception as exc:
        print(f"Configuracao invalida do watchdog: {exc}", file=sys.stderr)
        return 1
    log = setup_logging(config.log_dir)
    mutex = InstanceMutex()
    if not mutex.acquire():
        log.error("Outra instancia do watchdog ja esta em execucao")
        return 2
    watchdog = SystemWatchdog(config, log)

    def handle_signal(*_args: Any) -> None:
        watchdog.request_stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, handle_signal)
        except (OSError, ValueError):
            pass
    if hasattr(signal, "SIGBREAK"):
        try:
            signal.signal(signal.SIGBREAK, handle_signal)  # type: ignore[attr-defined]
        except (OSError, ValueError):
            pass
    try:
        return watchdog.run()
    finally:
        mutex.release()


if __name__ == "__main__":
    raise SystemExit(main())
