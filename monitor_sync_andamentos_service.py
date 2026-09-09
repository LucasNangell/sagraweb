"""
SAGRA — Monitor de divergência MDB ↔ MySQL (somente leitura)
============================================================
Compara COUNT(CodStatus) de tabandamento (últimos 10 dias) nos MDBs
OS Atual + Papelaria Atual versus MySQL.

Se a diferença persistir >30s → reinicia o serviço SAGRA-SyncAndamentos.
Se após 60s do restart a divergência continuar → grava alert=true no JSON
lido pela API (header vermelho no sistema / painel setor).

Nunca altera dados em Access nem MySQL (apenas SELECT/COUNT).
"""

from __future__ import annotations

import ctypes
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Optional, Tuple

# ---------------------------------------------------------------------------
# Bootstrap de path
# ---------------------------------------------------------------------------
_ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)
_BACKEND_DIR = os.path.join(_ROOT_DIR, "app", "backend")
if os.path.isdir(_BACKEND_DIR) and _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# ---------------------------------------------------------------------------
# Configuração via ambiente
# ---------------------------------------------------------------------------
SYNC_ANDAMENTOS_SERVICE_NAME = os.getenv(
    "SYNC_ANDAMENTOS_SERVICE_NAME", "SAGRA-SyncAndamentos"
)
MONITOR_MUTEX_NAME = os.getenv(
    "MONITOR_SYNC_MUTEX_NAME", r"Global\SagraMonitorSyncAndamentos"
)
SYNC_LOG_DIR = os.getenv("SYNC_LOG_DIR", "").strip()
SYNC_LOG_MAX_BYTES = int(os.getenv("SYNC_LOG_MAX_BYTES", str(10 * 1024 * 1024)))
SYNC_LOG_BACKUP_COUNT = int(os.getenv("SYNC_LOG_BACKUP_COUNT", "5"))

MONITOR_POLL_SECONDS = float(os.getenv("MONITOR_SYNC_POLL_SECONDS", "10"))
MONITOR_DAYS = int(os.getenv("MONITOR_SYNC_DAYS", "10"))
MONITOR_DIVERGE_SECONDS = float(os.getenv("MONITOR_SYNC_DIVERGE_SECONDS", "30"))
MONITOR_ALERT_AFTER_RESTART_SECONDS = float(
    os.getenv("MONITOR_SYNC_ALERT_AFTER_RESTART_SECONDS", "60")
)
MONITOR_CONNECT_TIMEOUT = int(os.getenv("MONITOR_SYNC_CONNECT_TIMEOUT", "30"))
MONITOR_QUERY_TIMEOUT = int(os.getenv("MONITOR_SYNC_QUERY_TIMEOUT", "60"))

STATUS_FILENAME = "sync_divergencia_monitor.json"
STATUS_PHASE_IDLE = "idle"
STATUS_PHASE_DIVERGED = "diverged"
STATUS_PHASE_RESTARTED = "restarted"
STATUS_PHASE_ALERTING = "alerting"
STATUS_PHASE_READ_ERROR = "read_error"


# ===========================================================================
# State machine (pura — testável sem I/O)
# ===========================================================================


@dataclass
class MonitorState:
    phase: str = STATUS_PHASE_IDLE
    first_diverged_mono: Optional[float] = None
    restarted_mono: Optional[float] = None
    alert_active: bool = False
    restart_done_this_episode: bool = False


@dataclass
class TickResult:
    state: MonitorState
    should_restart: bool = False


def tick_monitor(
    state: MonitorState,
    *,
    counts_equal: Optional[bool],
    now_mono: float,
    diverge_seconds: float = MONITOR_DIVERGE_SECONDS,
    alert_after_restart_seconds: float = MONITOR_ALERT_AFTER_RESTART_SECONDS,
) -> TickResult:
    """
    Avança a máquina de estados.

    counts_equal:
      - True  → contagens iguais (recupera)
      - False → divergente
      - None  → falha de leitura (não reinicia / não alerta dados)
    """
    if counts_equal is None:
        # Mantém episódio em curso; só marca fase de erro de leitura se estava idle.
        if state.phase == STATUS_PHASE_IDLE:
            return TickResult(state=replace(state, phase=STATUS_PHASE_READ_ERROR))
        return TickResult(state=state)

    if counts_equal:
        return TickResult(
            state=MonitorState(
                phase=STATUS_PHASE_IDLE,
                first_diverged_mono=None,
                restarted_mono=None,
                alert_active=False,
                restart_done_this_episode=False,
            )
        )

    # Divergente
    if state.first_diverged_mono is None:
        return TickResult(
            state=MonitorState(
                phase=STATUS_PHASE_DIVERGED,
                first_diverged_mono=now_mono,
                restarted_mono=None,
                alert_active=False,
                restart_done_this_episode=False,
            )
        )

    elapsed_diverge = now_mono - state.first_diverged_mono

    if not state.restart_done_this_episode and elapsed_diverge >= diverge_seconds:
        return TickResult(
            state=MonitorState(
                phase=STATUS_PHASE_RESTARTED,
                first_diverged_mono=state.first_diverged_mono,
                restarted_mono=now_mono,
                alert_active=False,
                restart_done_this_episode=True,
            ),
            should_restart=True,
        )

    if state.restart_done_this_episode and state.restarted_mono is not None:
        elapsed_after = now_mono - state.restarted_mono
        if elapsed_after >= alert_after_restart_seconds:
            return TickResult(
                state=MonitorState(
                    phase=STATUS_PHASE_ALERTING,
                    first_diverged_mono=state.first_diverged_mono,
                    restarted_mono=state.restarted_mono,
                    alert_active=True,
                    restart_done_this_episode=True,
                )
            )
        return TickResult(
            state=MonitorState(
                phase=STATUS_PHASE_RESTARTED,
                first_diverged_mono=state.first_diverged_mono,
                restarted_mono=state.restarted_mono,
                alert_active=False,
                restart_done_this_episode=True,
            )
        )

    return TickResult(
        state=MonitorState(
            phase=STATUS_PHASE_DIVERGED,
            first_diverged_mono=state.first_diverged_mono,
            restarted_mono=None,
            alert_active=False,
            restart_done_this_episode=False,
        )
    )


# ===========================================================================
# Logging / mutex / status file
# ===========================================================================


def resolve_log_dir() -> str:
    if SYNC_LOG_DIR:
        log_dir = os.path.abspath(SYNC_LOG_DIR)
    else:
        log_dir = os.path.join(_ROOT_DIR, "logs", "sync")
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


def setup_logging(log_dir: str) -> logging.Logger:
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    path = os.path.join(log_dir, "monitor_sync_andamentos.log")
    handler = RotatingFileHandler(
        path,
        maxBytes=SYNC_LOG_MAX_BYTES,
        backupCount=SYNC_LOG_BACKUP_COUNT,
        encoding="utf-8",
    )
    handler.setFormatter(fmt)
    root.addHandler(handler)
    if sys.stdout is not None and hasattr(sys.stdout, "write"):
        try:
            stream = logging.StreamHandler(sys.stdout)
            stream.setFormatter(fmt)
            root.addHandler(stream)
        except Exception:
            pass
    return logging.getLogger("monitor_sync_andamentos")


class InstanceMutex:
    ERROR_ALREADY_EXISTS = 183

    def __init__(self, name: str = MONITOR_MUTEX_NAME):
        self.name = name
        self._handle = None
        self.already_running = False

    def acquire(self) -> bool:
        if sys.platform != "win32":
            return True
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.CreateMutexW(None, False, self.name)
        if not handle:
            return False
        self._handle = handle
        if kernel32.GetLastError() == self.ERROR_ALREADY_EXISTS:
            self.already_running = True
            kernel32.CloseHandle(handle)
            self._handle = None
            return False
        return True

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            ctypes.windll.kernel32.CloseHandle(self._handle)
        except Exception:
            pass
        self._handle = None


@dataclass
class StatusWriter:
    path: str
    pid: int = field(default_factory=os.getpid)
    started_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    lock: threading.Lock = field(default_factory=threading.Lock)

    def write(self, payload: Dict[str, Any]) -> None:
        body = {
            "pid": self.pid,
            "started_at": self.started_at,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "written_at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        tmp = self.path + ".tmp"
        with self.lock:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(body, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)


# ===========================================================================
# Contagens read-only
# ===========================================================================

_COUNT_SQL_MYSQL = """
SELECT COUNT(*) AS cnt
FROM `{table}`
WHERE `Data` >= %s
  AND CodStatus IS NOT NULL
  AND AnoProtocoloLink >= 2024
"""

_COUNT_SQL_MDB = """
SELECT COUNT(*) AS cnt
FROM tabandamento
WHERE Data >= ?
  AND CodStatus IS NOT NULL
  AND AnoProtocoloLink >= 2024
"""


def _data_limite(days: int = MONITOR_DAYS) -> datetime:
    return datetime.now() - timedelta(days=days)


def resolve_andamento_table(cursor) -> str:
    """Prefere a tabela com mais linhas (mesmo critério do backend)."""
    candidates = ("tabAndamento", "tabandamento")
    best = "tabandamento"
    best_n = -1
    for name in candidates:
        try:
            cursor.execute(f"SELECT COUNT(*) AS c FROM `{name}`")
            row = cursor.fetchone()
            n = int(row["c"] if isinstance(row, dict) else row[0])
            if n > best_n:
                best_n = n
                best = name
        except Exception:
            continue
    return best


def count_mysql(mysql_cfg: Dict[str, Any], data_limite: datetime, log: logging.Logger) -> Optional[int]:
    import mysql.connector

    conn = None
    try:
        conn = mysql.connector.connect(
            host=mysql_cfg["host"],
            port=int(mysql_cfg.get("port") or 3306),
            user=mysql_cfg["user"],
            password=mysql_cfg.get("password") or "",
            database=mysql_cfg["database"],
            connection_timeout=MONITOR_CONNECT_TIMEOUT,
        )
        cursor = conn.cursor(dictionary=True)
        table = resolve_andamento_table(cursor)
        cursor.execute(
            _COUNT_SQL_MYSQL.format(table=table),
            (data_limite,),
        )
        row = cursor.fetchone()
        cursor.close()
        return int(row["cnt"] if isinstance(row, dict) else row[0])
    except Exception as exc:
        log.warning("Falha COUNT MySQL: %s", exc)
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _resolve_mdb_path(path: str) -> str:
    from config_manager import config_manager

    return config_manager.resolve_mdb_path(path) or path


def _mdb_conn_str_like_sync(resolved_path: str) -> str:
    """
    Mesma connection string do sync_andamentos_service.ResilientConnectionManager.
    Sem Exclusive=/ReadOnly= — atributos extras no ACE geram -1032 '(unknown)'.
    """
    return (
        f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};"
        f"DBQ={resolved_path};"
    )


def _log_mdb_access_hint(path: str, resolved: str, log: logging.Logger) -> None:
    try:
        exists = os.path.isfile(resolved)
    except Exception:
        exists = False
    log.warning(
        "MDB inacessivel via ODBC (path=%s resolved=%s exists=%s). "
        "ACE precisa gravar .ldb no share — use a MESMA conta do servico "
        "SAGRA-SyncAndamentos (nssm edit SAGRA-MonitorSyncAndamentos → Log on). "
        "LocalSystem so funciona se a conta de computador tiver Modify no DFS.",
        path,
        resolved,
        exists,
    )


class MdbCountSession:
    """Mantém conexões MDB abertas (como o sync), só SELECT/COUNT."""

    def __init__(self, log: logging.Logger):
        self.log = log
        self._os = None
        self._pap = None
        self._os_path = ""
        self._pap_path = ""
        self._hint_logged = False
        import pyodbc

        pyodbc.pooling = False
        self._pyodbc = pyodbc

    def close(self) -> None:
        for attr in ("_os", "_pap"):
            conn = getattr(self, attr)
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
                setattr(self, attr, None)

    def _connect(self, path: str):
        resolved = _resolve_mdb_path(path)
        conn_str = _mdb_conn_str_like_sync(resolved)
        conn = self._pyodbc.connect(
            conn_str,
            autocommit=True,
            timeout=MONITOR_CONNECT_TIMEOUT,
        )
        try:
            conn.timeout = MONITOR_QUERY_TIMEOUT
        except Exception:
            pass
        return conn, resolved

    def _get(self, which: str, path: str):
        if not path:
            return None
        current = self._os if which == "os" else self._pap
        stored_path = self._os_path if which == "os" else self._pap_path
        if current is not None and stored_path == path:
            return current
        if current is not None:
            try:
                current.close()
            except Exception:
                pass
        try:
            conn, resolved = self._connect(path)
            self.log.info("MDB %s conectado (resolved=%s)", which, resolved)
            if which == "os":
                self._os = conn
                self._os_path = path
            else:
                self._pap = conn
                self._pap_path = path
            return conn
        except Exception as exc:
            if which == "os":
                self._os = None
                self._os_path = ""
            else:
                self._pap = None
                self._pap_path = ""
            self.log.warning("Falha CONNECT MDB %s (%s): %s", which, path, exc)
            if not self._hint_logged:
                self._hint_logged = True
                _log_mdb_access_hint(path, _resolve_mdb_path(path), self.log)
            return None

    def count(self, which: str, path: str, data_limite: datetime) -> Optional[int]:
        conn = self._get(which, path)
        if conn is None:
            return None
        try:
            cursor = conn.cursor()
            cursor.execute(_COUNT_SQL_MDB, (data_limite,))
            row = cursor.fetchone()
            cursor.close()
            return int(row[0] if row else 0)
        except Exception as exc:
            self.log.warning("Falha COUNT MDB %s: %s — reconectando", which, exc)
            if which == "os":
                try:
                    if self._os:
                        self._os.close()
                except Exception:
                    pass
                self._os = None
                self._os_path = ""
            else:
                try:
                    if self._pap:
                        self._pap.close()
                except Exception:
                    pass
                self._pap = None
                self._pap_path = ""
            # Uma retentativa imediata
            conn2 = self._get(which, path)
            if conn2 is None:
                return None
            try:
                cursor = conn2.cursor()
                cursor.execute(_COUNT_SQL_MDB, (data_limite,))
                row = cursor.fetchone()
                cursor.close()
                return int(row[0] if row else 0)
            except Exception as exc2:
                self.log.warning("Falha COUNT MDB %s (retry): %s", which, exc2)
                return None


def fetch_counts(
    log: logging.Logger,
    mdb_session: Optional[MdbCountSession] = None,
) -> Tuple[Optional[int], Optional[int], Optional[int], Optional[int]]:
    """
    Retorna (count_mdb_os, count_mdb_pap, count_mdb_total, count_mysql).
    Qualquer None em MDB ou MySQL indica falha parcial.
    """
    from config_manager import config_manager

    paths = config_manager.get_mdb_paths()
    mysql_cfg = config_manager.get_mysql_config()
    limite = _data_limite()
    session = mdb_session or MdbCountSession(log)
    os_c = session.count("os", paths.get("os_atual") or "", limite)
    pap_c = session.count("pap", paths.get("papelaria") or "", limite)
    my_c = count_mysql(mysql_cfg, limite, log)
    if os_c is None or pap_c is None:
        return os_c, pap_c, None, my_c
    return os_c, pap_c, os_c + pap_c, my_c


# ===========================================================================
# Restart do serviço SyncAndamentos
# ===========================================================================


def _find_nssm() -> Optional[str]:
    candidates = [
        os.path.join(_ROOT_DIR, "deploy", "tools", "nssm.exe"),
        os.path.join(_ROOT_DIR, "tools", "nssm.exe"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    try:
        completed = subprocess.run(
            ["where", "nssm"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        line = (completed.stdout or "").strip().splitlines()
        if line and os.path.isfile(line[0].strip()):
            return line[0].strip()
    except Exception:
        pass
    return None


def restart_sync_andamentos(log: logging.Logger) -> bool:
    """Reinicia SAGRA-SyncAndamentos. Retorna True se o comando foi aceito."""
    if sys.platform != "win32":
        log.warning("Restart ignorado (plataforma != win32)")
        return False
    name = SYNC_ANDAMENTOS_SERVICE_NAME
    nssm = _find_nssm()
    try:
        if nssm:
            log.info("Reiniciando %s via nssm restart...", name)
            completed = subprocess.run(
                [nssm, "restart", name],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=120,
                check=False,
            )
            if completed.returncode == 0:
                return True
            log.warning(
                "nssm restart exit=%s stdout=%s stderr=%s — tentando sc stop/start",
                completed.returncode,
                (completed.stdout or "").strip()[:200],
                (completed.stderr or "").strip()[:200],
            )
        log.info("Reiniciando %s via sc stop/start...", name)
        stop = subprocess.run(
            ["sc", "stop", name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
        time.sleep(3)
        start = subprocess.run(
            ["sc", "start", name],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=60,
            check=False,
        )
        ok = start.returncode == 0
        if not ok:
            log.error(
                "sc start falhou (stop=%s start=%s): %s",
                stop.returncode,
                start.returncode,
                (start.stderr or start.stdout or "")[:300],
            )
        return ok
    except Exception as exc:
        log.error("Falha ao reiniciar %s: %s", name, exc)
        return False


# ===========================================================================
# Loop principal
# ===========================================================================


class MonitorLoop:
    def __init__(self, log: logging.Logger, status: StatusWriter):
        self.log = log
        self.status = status
        self.state = MonitorState()
        self._stop = threading.Event()
        self._mdb = MdbCountSession(log)

    def request_stop(self, *_args) -> None:
        self.log.info("Sinal de parada recebido")
        self._stop.set()

    def _counts_equal(self, mdb_total: Optional[int], mysql: Optional[int]) -> Optional[bool]:
        if mdb_total is None or mysql is None:
            return None
        return mdb_total == mysql

    def run_once(self, now_mono: Optional[float] = None) -> TickResult:
        now = time.monotonic() if now_mono is None else now_mono
        os_c, pap_c, mdb_total, mysql_c = fetch_counts(self.log, self._mdb)
        equal = self._counts_equal(mdb_total, mysql_c)
        result = tick_monitor(
            self.state,
            counts_equal=equal,
            now_mono=now,
            diverge_seconds=MONITOR_DIVERGE_SECONDS,
            alert_after_restart_seconds=MONITOR_ALERT_AFTER_RESTART_SECONDS,
        )
        self.state = result.state

        if result.should_restart:
            self.log.warning(
                "Divergência persistente (mdb=%s mysql=%s) — reiniciando %s",
                mdb_total,
                mysql_c,
                SYNC_ANDAMENTOS_SERVICE_NAME,
            )
            ok = restart_sync_andamentos(self.log)
            if not ok:
                self.log.error("Restart do sync falhou; episódio segue sem novo restart")

        payload = {
            "phase": self.state.phase,
            "alert": bool(self.state.alert_active),
            "diverged": equal is False,
            "count_mdb_os": os_c,
            "count_mdb_papelaria": pap_c,
            "count_mdb": mdb_total,
            "count_mysql": mysql_c,
            "days": MONITOR_DAYS,
            "read_ok": equal is not None,
            "restart_done_this_episode": self.state.restart_done_this_episode,
            "service_target": SYNC_ANDAMENTOS_SERVICE_NAME,
        }
        try:
            self.status.write(payload)
        except Exception as exc:
            self.log.warning("Falha ao gravar status JSON: %s", exc)

        if equal is True:
            self.log.info(
                "OK mdb=%s mysql=%s (os=%s pap=%s)",
                mdb_total,
                mysql_c,
                os_c,
                pap_c,
            )
        elif equal is False:
            self.log.warning(
                "DIVERGENTE mdb=%s mysql=%s phase=%s alert=%s",
                mdb_total,
                mysql_c,
                self.state.phase,
                self.state.alert_active,
            )
        return result

    def run(self) -> int:
        self.log.info(
            "Monitor iniciado (dias=%s poll=%ss diverge=%ss alert_after=%ss)",
            MONITOR_DAYS,
            MONITOR_POLL_SECONDS,
            MONITOR_DIVERGE_SECONDS,
            MONITOR_ALERT_AFTER_RESTART_SECONDS,
        )
        try:
            while not self._stop.is_set():
                try:
                    self.run_once()
                except Exception as exc:
                    self.log.exception("Erro no ciclo do monitor: %s", exc)
                self._stop.wait(MONITOR_POLL_SECONDS)
        finally:
            self._mdb.close()
        self.log.info("Monitor encerrado")
        return 0


def main() -> int:
    log_dir = resolve_log_dir()
    log = setup_logging(log_dir)
    mutex = InstanceMutex()
    if not mutex.acquire():
        log.error("Outra instancia do monitor ja esta em execucao (%s)", MONITOR_MUTEX_NAME)
        return 2

    status = StatusWriter(os.path.join(log_dir, STATUS_FILENAME))
    loop = MonitorLoop(log, status)

    def _handle_signal(signum, _frame):
        loop.request_stop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except Exception:
            pass
    if hasattr(signal, "SIGBREAK"):
        try:
            signal.signal(signal.SIGBREAK, _handle_signal)  # type: ignore[attr-defined]
        except Exception:
            pass

    try:
        return loop.run()
    finally:
        mutex.release()


if __name__ == "__main__":
    raise SystemExit(main())
