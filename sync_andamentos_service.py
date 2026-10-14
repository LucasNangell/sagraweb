"""
SAGRA - Sync Andamentos Service (runner resiliente 24/7)
=======================================================
Herda sync_andamentos_v2_Old.py e adiciona tabAndamento bidirecional no runner.

Fonte canônica da lógica (produção):
  \\\\cgrafsysvm\\s\\SagraWeb\\sync_andamentos_v2_Old.py
O runner carrega o arquivo de mesmo nome na raiz do deploy (ao lado deste
script). Não altere a lógica em sync_andamentos_v2_Old.py sem alinhar
com a cópia de produção.

Adiciona:
- Invalidação / reconexão de MDB e MySQL em falha
- Timeout de conexão (best-effort) e pré-checagem dos .mdb
- Abort de ciclo se leitura MySQL falhar (evita tempestade de inserts)
- Watchdog anti-travamento (stall → dump + os._exit(17) → NSSM reinicia)
- Heartbeat em logs/sync/sync_heartbeat.json
- Logging rotativo em logs/sync/
- Mutex de instância única (Windows Global\\SagraSyncAndamentos)
- Supervisor com backoff e startup tolerante
- Sinais SIGINT/SIGTERM/SIGBREAK para parada limpa via NSSM
"""

from __future__ import annotations

import ctypes
import faulthandler
import hashlib
import importlib.util
import json
import logging
import os
import signal
import sys
import threading
import time
import traceback
from datetime import date, datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, List, Optional, Set

# ---------------------------------------------------------------------------
# Bootstrap de path (mesmo padrão de sync_andamentos_v2.py)
# ---------------------------------------------------------------------------
# IMPORTANTE: app/backend deve vir ANTES de app/services.
# Em app/services existe um pacote aninhado `services/` (legado) que sombreia
# app/backend/services e quebra `from services.andamento_operacional import ...`
# (usado por mdb_writer / UltimoStatus).
_ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
_BACKEND_DIR = os.path.join(_ROOT_DIR, "app", "backend")
_SERVICES_DIR = os.path.join(_ROOT_DIR, "app", "services")

# Limpa entradas duplicadas e reinsere na ordem correta
for _p in (_SERVICES_DIR, _BACKEND_DIR, _ROOT_DIR):
    while _p in sys.path:
        sys.path.remove(_p)

sys.path.insert(0, _ROOT_DIR)
if os.path.isdir(_BACKEND_DIR):
    sys.path.insert(0, _BACKEND_DIR)
# Legado (sync_tables etc.): só no final, nunca antes do backend
if os.path.isdir(_SERVICES_DIR):
    sys.path.append(_SERVICES_DIR)

# ---------------------------------------------------------------------------
# Import do módulo legado (lógica de sincronia intacta)
# ---------------------------------------------------------------------------
_CORE_PATH = os.path.join(_ROOT_DIR, "sync_andamentos_v2_Old.py")
if not os.path.isfile(_CORE_PATH):
    raise FileNotFoundError(
        f"sync_andamentos_v2_Old.py nao encontrado em {_CORE_PATH}. "
        "O runner resiliente depende da logica desse modulo."
    )

_spec = importlib.util.spec_from_file_location("sync_andamentos_v2_Old", _CORE_PATH)
if _spec is None or _spec.loader is None:
    raise ImportError(f"Nao foi possivel carregar {_CORE_PATH}")
core = importlib.util.module_from_spec(_spec)
sys.modules["sync_andamentos_v2_Old"] = core
_spec.loader.exec_module(core)

import mysql.connector  # noqa: E402  (depois do bootstrap)
import pyodbc  # noqa: E402
from mysql.connector import Error as MySQLError  # noqa: E402

# ---------------------------------------------------------------------------
# Configuração via ambiente
# ---------------------------------------------------------------------------
STALL_EXIT_CODE = 17
MYSQL_CONN_ERRNOS: Set[int] = {2003, 2006, 2013, 1412}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


SYNC_STALL_TIMEOUT = _env_float("SYNC_STALL_TIMEOUT", 120.0)
SYNC_WATCHDOG_INTERVAL = _env_float("SYNC_WATCHDOG_INTERVAL", 5.0)
SYNC_CONNECT_TIMEOUT = _env_int("SYNC_CONNECT_TIMEOUT", 30)
SYNC_QUERY_TIMEOUT = _env_int("SYNC_QUERY_TIMEOUT", 60)
SYNC_BACKOFF_MIN = _env_float("SYNC_BACKOFF_MIN", 5.0)
SYNC_BACKOFF_MAX = _env_float("SYNC_BACKOFF_MAX", 60.0)
# 0 desliga. Recicla conexoes ODBC/MySQL entre ciclos para evitar handle zumbi.
SYNC_CONN_RECYCLE_SECONDS = _env_float("SYNC_CONN_RECYCLE_SECONDS", 900.0)
# Abaixo do AppStopMethodConsole (8000 ms) do NSSM: thread presa em ODBC nao
# pode deixar o servico em StopPending.
SYNC_SHUTDOWN_DEADLINE_SECONDS = _env_float("SYNC_SHUTDOWN_DEADLINE_SECONDS", 6.0)
# Erro ACE -1812/HY001 persistente: reciclar MDB a cada N falhas e, se durar
# mais que EXIT_AFTER (0 desliga), sair para o NSSM relancar processo limpo.
SYNC_MDB_FATAL_RESET_AFTER = max(1, _env_int("SYNC_MDB_FATAL_RESET_AFTER", 5))
SYNC_MDB_FATAL_EXIT_AFTER_SECONDS = _env_float("SYNC_MDB_FATAL_EXIT_AFTER_SECONDS", 120.0)
SYNC_MDB_FATAL_MIN_UPTIME_SECONDS = _env_float("SYNC_MDB_FATAL_MIN_UPTIME_SECONDS", 600.0)
MDB_FATAL_EXIT_CODE = 18
# Intervalo mínimo para a varredura de flags voltar a curar a mesma OS. Uma OS
# cuja correção não converge não pode gravar no MDB a cada ciclo.
SYNC_ULTIMO_HEAL_RETRY_SECONDS = max(0.0, _env_float("SYNC_ULTIMO_HEAL_RETRY_SECONDS", 600.0))
# Mantido por compatibilidade; o notify sempre usa base interna (uvicorn).
SYNC_NOTIFY_INTERNAL_BASE = _env_bool("SYNC_NOTIFY_INTERNAL_BASE", True)
SYNC_NOTIFY_FAIL_LOG_INTERVAL = _env_float("SYNC_NOTIFY_FAIL_LOG_INTERVAL", 60.0)
# tabAndamento bidirecional (INSERT/UPDATE MySQL↔MDB). Protocolos/Detalhes seguem só MDB→MySQL.
SYNC_TABANDAMENTO_BIDI = _env_bool("SYNC_TABANDAMENTO_BIDI", True)
# Alias legado do plano de catch-up (se False, desliga o sentido MySQL→MDB).
SYNC_MYSQL_TO_MDB_CATCHUP = _env_bool("SYNC_MYSQL_TO_MDB_CATCHUP", True)
# Desempate quando ambos os lados mudaram (ou não há baseline): mdb | mysql.
_raw_conflict = (os.getenv("SYNC_CONFLICT_WINNER") or "mdb").strip().lower()
SYNC_CONFLICT_WINNER = _raw_conflict if _raw_conflict in ("mdb", "mysql") else "mdb"
SYNC_MUTEX_NAME = os.getenv("SYNC_MUTEX_NAME", r"Global\SagraSyncAndamentos")
SYNC_LOG_DIR = os.getenv("SYNC_LOG_DIR", "").strip()
SYNC_LOG_MAX_BYTES = _env_int("SYNC_LOG_MAX_BYTES", 10 * 1024 * 1024)
SYNC_LOG_BACKUP_COUNT = _env_int("SYNC_LOG_BACKUP_COUNT", 5)
_BASELINE_PRUNE_EVERY = 50

# Reconciliação MDB -> MySQL de tabelas relacionadas à OS. É propositalmente
# independente do ciclo rápido de tabAndamento: um valor só é escrito depois de
# permanecer igual no MDB durante N leituras consecutivas.
SYNC_RELATED_RECONCILE_ENABLED = _env_bool("SYNC_RELATED_RECONCILE_ENABLED", True)
SYNC_RELATED_RECONCILE_INTERVAL = max(
    1.0, _env_float("SYNC_RELATED_RECONCILE_INTERVAL", 10.0)
)
SYNC_RELATED_RECONCILE_STABLE_CYCLES = max(
    1, _env_int("SYNC_RELATED_RECONCILE_STABLE_CYCLES", 3)
)
SYNC_RELATED_RECONCILE_MAX_WRITES = max(
    1, _env_int("SYNC_RELATED_RECONCILE_MAX_WRITES", 100)
)
_RELATED_TABLE_SPECS = (
    {
        "table": "tabProtocolos",
        "pk_fields": ("NroProtocolo", "AnoProtocolo"),
        "nro_field": "NroProtocolo",
        "year_field": "AnoProtocolo",
        "allowlist": core._PROTOCOL_SYNC_ALLOWLIST,
    },
    {
        "table": "tabDetalhesServico",
        "pk_fields": ("NroProtocoloLinkDet", "AnoProtocoloLinkDet"),
        "nro_field": "NroProtocoloLinkDet",
        "year_field": "AnoProtocoloLinkDet",
        "allowlist": core._DETAILS_SYNC_ALLOWLIST,
    },
)

# Sentinel para distinguir "MySQL retornou lista vazia" de "falha de leitura"
_MYSQL_READ_FAILED = object()
_PROCESS_STARTED_MONO = time.monotonic()
_MDB_FATAL_MARKERS = ("-1812", "hy001")


def is_mdb_fatal_error(text: str) -> bool:
    lowered = (text or "").lower()
    return any(marker in lowered for marker in _MDB_FATAL_MARKERS)


class MdbFatalErrorTracker:
    """
    Sequência de erros ACE -1812/HY001 (recurso/arquivo temporário do Access).
    A cada `reset_after` erros pede descarte das conexões MDB; se a sequência
    dura `exit_after_seconds` e o processo já viveu `min_uptime_seconds`, pede
    saída para o NSSM relançar com o motor ACE limpo. O tempo mínimo de vida
    impede laço de reinícios quando a causa é externa ao processo.
    """

    def __init__(
        self,
        reset_after: int,
        exit_after_seconds: float,
        min_uptime_seconds: float,
        process_started_mono: float,
    ):
        self.reset_after = max(1, int(reset_after))
        self.exit_after_seconds = float(exit_after_seconds)
        self.min_uptime_seconds = float(min_uptime_seconds)
        self.process_started_mono = float(process_started_mono)
        self.streak = 0
        self.first_error_mono: Optional[float] = None

    def observe_success(self) -> None:
        self.streak = 0
        self.first_error_mono = None

    def observe_error(self, text: str, now_mono: float) -> str:
        if not is_mdb_fatal_error(text):
            return "ignored"
        if self.first_error_mono is None:
            self.first_error_mono = now_mono
        self.streak += 1
        streak_age = now_mono - self.first_error_mono
        uptime = now_mono - self.process_started_mono
        if (
            self.exit_after_seconds > 0
            and streak_age >= self.exit_after_seconds
            and uptime >= self.min_uptime_seconds
        ):
            return "exit"
        if self.streak % self.reset_after == 0:
            return "reset"
        return "count"


def _exit_for_clean_restart(code: int) -> None:
    os._exit(code)


class StableRelatedMismatchGate:
    """Exige a mesma divergência MDB/MySQL em ciclos consecutivos antes de escrever."""

    def __init__(self, required_cycles: int):
        self.required_cycles = max(1, int(required_cycles))
        self._pending: Dict[tuple, Dict[str, Any]] = {}

    def observe(self, identity: tuple, desired_hash: str, current_hash: Optional[str]) -> bool:
        """Retorna True após a divergência atingir o limiar, até ela ser tratada."""
        if desired_hash == current_hash:
            self._pending.pop(identity, None)
            return False

        pending = self._pending.get(identity)
        if (
            pending is None
            or pending["desired_hash"] != desired_hash
            or pending["current_hash"] != current_hash
        ):
            self._pending[identity] = {
                "desired_hash": desired_hash,
                "current_hash": current_hash,
                "cycles": 1,
            }
            return self.required_cycles == 1

        pending["cycles"] += 1
        return pending["cycles"] >= self.required_cycles

    def mark_write_failed(self, identity: tuple) -> None:
        """Mantém a evidência estável para nova tentativa no próximo ciclo."""
        pending = self._pending.get(identity)
        if pending:
            pending["cycles"] = self.required_cycles - 1

    def mark_written(self, identity: tuple) -> None:
        self._pending.pop(identity, None)

    def discard(self, identity: tuple) -> None:
        self._pending.pop(identity, None)

    def discard_not_seen(self, scope: tuple, seen_identities: Set[tuple]) -> None:
        for identity in list(self._pending):
            if identity[:2] == scope and identity not in seen_identities:
                self._pending.pop(identity, None)

    def pending_cycles(self, identity: tuple) -> int:
        pending = self._pending.get(identity)
        return int(pending["cycles"]) if pending else 0


def _empty_cycle_stats() -> Dict[str, int]:
    return {
        "ins_m2y": 0,
        "upd_m2y": 0,
        "ins_y2m": 0,
        "upd_y2m": 0,
        "del_y": 0,
        "ultimo_heals": 0,
        "safety_lock_aborts": 0,
        "mysql_only_remaining": 0,
        "conflitos": 0,
        "baseline_rows": 0,
        "os_del_candidates": 0,
        "os_del_executed": 0,
        "os_del_quarantined": 0,
        "os_del_aborted": 0,
    }


# ===========================================================================
# Logging
# ===========================================================================

def resolve_log_dir() -> str:
    if SYNC_LOG_DIR:
        log_dir = os.path.abspath(SYNC_LOG_DIR)
    else:
        log_dir = os.path.join(_ROOT_DIR, "logs", "sync")
    os.makedirs(log_dir, exist_ok=True)
    return log_dir


def setup_logging(log_dir: str) -> logging.Logger:
    """Configura handlers ANTES de SyncLogger (basicConfig vira no-op)."""
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)

    fmt = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    for filename in ("sync_andamentos.log", "synlog.txt"):
        path = os.path.join(log_dir, filename)
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

    return logging.getLogger("sync_andamentos_service")


# ===========================================================================
# Mutex de instância única (Windows)
# ===========================================================================

class InstanceMutex:
    """CreateMutexW nomeado - liberado automaticamente na morte do processo."""

    ERROR_ALREADY_EXISTS = 183

    def __init__(self, name: str = SYNC_MUTEX_NAME):
        self.name = name
        self._handle = None
        self.already_running = False

    def acquire(self) -> bool:
        if sys.platform != "win32":
            # Fora do Windows (testes), permite execução.
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

    def acquire_with_retry(
        self,
        *,
        timeout_sec: float = 45.0,
        interval_sec: float = 1.5,
        log: Optional[logging.Logger] = None,
    ) -> bool:
        """Evita exit 2 imediato em overlap stop/start (NSSM throttle → PAUSED)."""
        deadline = time.monotonic() + max(timeout_sec, 0.0)
        attempt = 0
        while True:
            attempt += 1
            if self.acquire():
                if attempt > 1 and log is not None:
                    log.info(
                        "[MUTEX] Adquirido apos %s tentativa(s) (%s)",
                        attempt,
                        self.name,
                    )
                return True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            if log is not None and (attempt == 1 or attempt % 5 == 0):
                log.warning(
                    "[MUTEX] Outra instancia ainda segura %s "
                    "(tentativa %s, restante %.0fs) - aguardando...",
                    self.name,
                    attempt,
                    remaining,
                )
            time.sleep(min(interval_sec, max(remaining, 0.1)))

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            ctypes.windll.kernel32.CloseHandle(self._handle)
        except Exception:
            pass
        self._handle = None


def _preflight_imports(log: logging.Logger) -> None:
    """Falhas claras no boot (evita crash opaco → NSSM PAUSED)."""
    missing: List[str] = []
    for mod_name in ("sync_policy", "sync_os_deletes"):
        path = os.path.join(_ROOT_DIR, f"{mod_name}.py")
        if not os.path.isfile(path):
            missing.append(path)
    if missing:
        raise FileNotFoundError(
            "Arquivos obrigatorios ausentes na raiz do sync: "
            + "; ".join(missing)
            + ". Copie sync_policy.py e sync_os_deletes.py para o AppDirectory."
        )
    try:
        import services  # noqa: F401
        from services import andamento_operacional as _ao  # noqa: F401
    except Exception as e:
        services_pkg = None
        try:
            import services as _svc

            services_pkg = getattr(_svc, "__file__", repr(_svc))
        except Exception:
            pass
        raise ImportError(
            "Falha ao importar services.andamento_operacional "
            f"(services={services_pkg!r}; sys.path[0:3]={sys.path[:3]!r}): {e}"
        ) from e
    log.info(
        "[PREFLIGHT] sync_policy/sync_os_deletes/andamento_operacional OK "
        "(backend=%s)",
        _BACKEND_DIR,
    )


# ===========================================================================
# Heartbeat
# ===========================================================================

class HeartbeatWriter:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.pid = os.getpid()
        self.last_progress_mono = time.monotonic()
        self.last_cycle_at: Optional[str] = None
        self.phase = "init"
        self.cycles = 0
        self.consecutive_errors = 0
        self.last_error: Optional[str] = None
        self.stall_seconds = 0.0
        self.stats: Dict[str, Any] = _empty_cycle_stats()

    def mark_progress(self, phase: str) -> None:
        with self.lock:
            self.phase = phase
            self.last_progress_mono = time.monotonic()

    def mark_cycle_ok(self, stats: Optional[Dict[str, Any]] = None) -> None:
        with self.lock:
            self.cycles += 1
            self.consecutive_errors = 0
            self.last_error = None
            self.last_cycle_at = datetime.now(timezone.utc).isoformat()
            self.phase = "idle"
            self.last_progress_mono = time.monotonic()
            if stats:
                self.stats.update(stats)

    def mark_skip_cycle(self, phase: str = "mdb_unavailable") -> None:
        """Skip intencional (share fora): atualiza last_cycle_at para nao storm-restart."""
        with self.lock:
            self.phase = phase
            self.last_cycle_at = datetime.now(timezone.utc).isoformat()
            self.last_progress_mono = time.monotonic()

    def mark_cycle_error(self, error: str) -> None:
        with self.lock:
            self.consecutive_errors += 1
            self.last_error = (error or "")[:500]
            self.phase = "error"
            # Nao resetar last_progress_mono: erro em loop deve acumular stall
            # para o watchdog interno encerrar com exit 17 e o NSSM relancar.

    def snapshot(self) -> Dict[str, Any]:
        with self.lock:
            stall = max(0.0, time.monotonic() - self.last_progress_mono)
            self.stall_seconds = stall
            return {
                "pid": self.pid,
                "started_at": self.started_at,
                "last_cycle_at": self.last_cycle_at,
                "phase": self.phase,
                "cycles": self.cycles,
                "consecutive_errors": self.consecutive_errors,
                "last_error": self.last_error,
                "stall_seconds": round(stall, 1),
                "stats": dict(self.stats),
                "tabandamento_bidi": SYNC_TABANDAMENTO_BIDI and SYNC_MYSQL_TO_MDB_CATCHUP,
                "written_at": datetime.now(timezone.utc).isoformat(),
            }

    def write(self) -> None:
        data = self.snapshot()
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
        except Exception:
            try:
                if os.path.exists(tmp):
                    os.remove(tmp)
            except Exception:
                pass


# ===========================================================================
# Connection manager resiliente
# ===========================================================================

class ResilientConnectionManager(core.ConnectionManager):
    """Extende ConnectionManager com timeouts e invalidação explícita."""

    def __init__(self, config: core.Config):
        super().__init__(config)
        self._connect_timeout = SYNC_CONNECT_TIMEOUT
        self._query_timeout = SYNC_QUERY_TIMEOUT

    def _close_quietly(self, conn) -> None:
        try:
            if conn:
                conn.close()
        except Exception:
            pass

    def invalidate_mysql(self) -> None:
        self._close_quietly(self.mysql_conn)
        self.mysql_conn = None

    def invalidate_mdb_os(self) -> None:
        self._close_quietly(self.mdb_os_conn)
        self.mdb_os_conn = None

    def invalidate_mdb_pap(self) -> None:
        self._close_quietly(self.mdb_pap_conn)
        self.mdb_pap_conn = None

    def invalidate_all(self) -> None:
        self.invalidate_mysql()
        self.invalidate_mdb_os()
        self.invalidate_mdb_pap()

    def get_mysql(self):
        if not self.mysql_conn or not self.mysql_conn.is_connected():
            self.mysql_conn = mysql.connector.connect(
                host=self.config.mysql_host,
                port=self.config.mysql_port,
                user=self.config.mysql_user,
                password=self.config.mysql_password,
                database=self.config.mysql_database,
                charset="utf8mb4",
                autocommit=False,
                connection_timeout=self._connect_timeout,
            )
            try:
                cursor = self.mysql_conn.cursor()
                cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                cursor.close()
            except Exception:
                pass
        return self.mysql_conn

    def _connect_mdb(self, path: str):
        driver = "{Microsoft Access Driver (*.mdb, *.accdb)}"
        conn_str = f"DRIVER={driver};DBQ={path};"
        conn = pyodbc.connect(conn_str, autocommit=False, timeout=self._connect_timeout)
        try:
            # Melhor esforço - o driver Access pode ignorar.
            conn.timeout = self._query_timeout
        except Exception:
            pass
        return conn

    def get_mdb_os(self):
        if not self.mdb_os_conn:
            self.mdb_os_conn = self._connect_mdb(self.config.mdb_os_atual_path)
        return self.mdb_os_conn

    def get_mdb_pap(self):
        if not self.mdb_pap_conn:
            self.mdb_pap_conn = self._connect_mdb(self.config.mdb_papelaria_path)
        return self.mdb_pap_conn


# ===========================================================================
# Synchronizer resiliente
# ===========================================================================

class ResilientSynchronizer(core.AndamentosSynchronizer):
    """
    Herda intactos: insert/update/delete, detecção de exclusões, cache,
    formatação, sync de OS, bg_sync de Protocolos/Detalhes, comparação.
    Overrides apenas pontos de falha de conexão e o loop supervisor.
    """

    def __init__(self, config: core.Config, heartbeat: HeartbeatWriter, log: logging.Logger):
        # Substitui ConnectionManager antes do SyncLogger tocar DB.
        self.config = config
        self.conn_mgr = ResilientConnectionManager(config)
        self.logger = core.SyncLogger(self.conn_mgr)
        self.backup_mgr = core.BackupManager(self.conn_mgr, self.logger)

        self._blocked_warnings_cache = {}
        self._blocked_warning_interval = 300
        self._mdb_insert_error_cache = {}
        self._mdb_insert_error_interval = 300
        self.running = False

        self._hb = heartbeat
        self._svc_log = log
        self._mdb_missing_warn_ts = 0.0
        self._mdb_missing_warn_interval = 60.0
        self._notify_fail_ts = 0.0
        self._cycle_stats = _empty_cycle_stats()
        self._init_baseline_state()
        self._last_conn_recycle_mono = time.monotonic()
        self._related_mismatch_gate = StableRelatedMismatchGate(
            SYNC_RELATED_RECONCILE_STABLE_CYCLES
        )

        # Sempre patch: Old usa get_api_base() relativo (/sagra/api) que quebra requests.
        self._install_reliable_notify()

    # ------------------------------------------------------------------
    # tabProtocolos/tabDetalhesServico: reconciliação estável e isolada
    # ------------------------------------------------------------------
    def _related_gate(self) -> StableRelatedMismatchGate:
        # Também atende instâncias montadas por testes legados com __new__.
        gate = getattr(self, "_related_mismatch_gate", None)
        if gate is None:
            gate = StableRelatedMismatchGate(SYNC_RELATED_RECONCILE_STABLE_CYCLES)
            self._related_mismatch_gate = gate
        return gate

    def _mdb_fatal_tracker(self) -> MdbFatalErrorTracker:
        tracker = getattr(self, "_mdb_fatal_errors", None)
        if tracker is None:
            tracker = MdbFatalErrorTracker(
                SYNC_MDB_FATAL_RESET_AFTER,
                SYNC_MDB_FATAL_EXIT_AFTER_SECONDS,
                SYNC_MDB_FATAL_MIN_UPTIME_SECONDS,
                _PROCESS_STARTED_MONO,
            )
            self._mdb_fatal_errors = tracker
        return tracker

    def _note_mdb_error(self, text: str) -> None:
        tracker = self._mdb_fatal_tracker()
        action = tracker.observe_error(text, time.monotonic())
        if action == "reset":
            self._svc_log.warning(
                "[MDB] %s erros -1812/HY001 consecutivos - descartando conexoes MDB",
                tracker.streak,
            )
            self.conn_mgr.invalidate_mdb_os()
            self.conn_mgr.invalidate_mdb_pap()
        elif action == "exit":
            self._svc_log.critical(
                "[MDB] erros -1812/HY001 persistem ha %.0fs (%s seguidos) - "
                "encerrando com codigo %s para o NSSM relancar o motor ACE limpo",
                time.monotonic() - (tracker.first_error_mono or time.monotonic()),
                tracker.streak,
                MDB_FATAL_EXIT_CODE,
            )
            self._hb.mark_cycle_error(f"mdb_fatal_exit: {text}")
            try:
                self._hb.write()
            except Exception:
                pass
            for handler in list(self._svc_log.handlers) + list(logging.getLogger().handlers):
                try:
                    handler.flush()
                except Exception:
                    pass
            _exit_for_clean_restart(MDB_FATAL_EXIT_CODE)

    @staticmethod
    def _related_normalize(value: Any) -> str:
        """Normalização compatível com o comparador legado, sem falsos positivos de tipo."""
        if value is None:
            return ""
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, datetime):
            if value.hour == 0 and value.minute == 0 and value.second == 0:
                return value.strftime("%Y-%m-%d")
            return value.strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(value, date):
            return value.strftime("%Y-%m-%d")

        value_str = str(value).strip()
        try:
            number = float(value_str)
            return str(int(number)) if number.is_integer() else str(number)
        except ValueError:
            pass

        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d"):
            try:
                parsed = datetime.strptime(value_str, fmt)
                if parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0:
                    return parsed.strftime("%Y-%m-%d")
                return parsed.strftime("%Y-%m-%d %H:%M:%S")
            except ValueError:
                continue
        return value_str

    @classmethod
    def _related_row_hash(cls, record: Dict[str, Any], columns: List[str]) -> str:
        payload = [(column, cls._related_normalize(record.get(column))) for column in columns]
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    @staticmethod
    def _related_source_filter(spec: Dict[str, Any], is_os: bool) -> str:
        comparator = "<" if is_os else ">="
        return (
            f"WHERE {spec['year_field']} >= {{placeholder_year}} "
            f"AND {spec['nro_field']} {comparator} {{placeholder_split}}"
        )

    def _load_related_policies(self, mysql_conn) -> Optional[Dict[str, Dict[str, Any]]]:
        """Lê as políticas usando a conexão dedicada do worker; em erro, falha fechado."""
        try:
            from sync_policy import apply_env_kill_switches, load_policies

            cursor = mysql_conn.cursor(dictionary=True)
            try:
                return apply_env_kill_switches(load_policies(cursor))
            finally:
                cursor.close()
        except Exception as exc:
            self._svc_log.error("[RELATED_SYNC] políticas indisponíveis; nenhuma escrita: %s", exc)
            return None

    def _related_tombstones(self, mysql_conn) -> Optional[Set[tuple]]:
        """Não permite recriar OS tombstoned; erro de leitura interrompe a reconciliação."""
        try:
            cursor = mysql_conn.cursor(dictionary=True)
            try:
                cursor.execute("SELECT nro, ano FROM deleted_os")
                return {
                    (row.get("nro"), row.get("ano"))
                    for row in cursor.fetchall()
                }
            finally:
                cursor.close()
        except Exception as exc:
            self._svc_log.error(
                "[RELATED_SYNC] tombstones indisponíveis; reconciliação abortada: %s", exc
            )
            return None

    @staticmethod
    def _unique_related_records(
        records: List[Dict[str, Any]], pk_fields: tuple, label: str
    ) -> Dict[tuple, Dict[str, Any]]:
        indexed: Dict[tuple, Dict[str, Any]] = {}
        for record in records:
            key = tuple(record.get(field) for field in pk_fields)
            if any(value is None for value in key):
                raise ValueError(f"chave nula em {label}: {key}")
            if key in indexed:
                raise ValueError(f"chave duplicada em {label}: {key}")
            indexed[key] = record
        return indexed

    def _read_related_table(self, mdb_conn, mysql_conn, spec: Dict[str, Any], is_os: bool):
        """Lê uma tabela em ambas as pontas com o mesmo recorte legado de OS/Papelaria."""
        from sync_policy import OS_MIN_YEAR

        table = spec["table"]
        source_filter = self._related_source_filter(spec, is_os)
        mdb_query = (
            f"SELECT * FROM {table} "
            + source_filter.format(placeholder_year="?", placeholder_split="?")
        )
        mysql_query = (
            f"SELECT * FROM `{table}` "
            + source_filter.format(placeholder_year="%s", placeholder_split="%s")
        )
        params = (OS_MIN_YEAR, 5000)

        mdb_cursor = mdb_conn.cursor()
        try:
            mdb_cursor.execute(mdb_query, params)
            mdb_columns = [desc[0] for desc in mdb_cursor.description]
            mdb_records = [dict(zip(mdb_columns, row)) for row in mdb_cursor.fetchall()]
        finally:
            mdb_cursor.close()

        sync_columns = self._sync_allowed_columns(
            mdb_columns, spec["allowlist"], list(spec["pk_fields"])
        )
        missing_pk = [field for field in spec["pk_fields"] if field not in sync_columns]
        if missing_pk:
            raise ValueError(f"chave ausente no MDB de {table}: {missing_pk}")

        mysql_cursor = mysql_conn.cursor(dictionary=True)
        try:
            mysql_cursor.execute(mysql_query, params)
            mysql_records = list(mysql_cursor.fetchall() or [])
        finally:
            mysql_cursor.close()

        return mdb_records, mysql_records, sync_columns

    def _apply_related_candidates(
        self,
        mysql_conn,
        spec: Dict[str, Any],
        source_name: str,
        candidates: List[Dict[str, Any]],
        sync_columns: List[str],
    ) -> None:
        """Revalida cada linha dentro da transação antes de INSERT/UPDATE no MySQL."""
        table = spec["table"]
        pk_fields = spec["pk_fields"]
        mutable_columns = [column for column in sync_columns if column not in pk_fields]
        cursor = mysql_conn.cursor(dictionary=True)
        written: List[tuple] = []
        try:
            for candidate in candidates:
                record = candidate["record"]
                key = candidate["key"]
                identity = candidate["identity"]
                where_clause = " AND ".join(f"`{field}` = %s" for field in pk_fields)
                selected_columns = ", ".join(f"`{column}`" for column in sync_columns)
                cursor.execute(
                    f"SELECT {selected_columns} FROM `{table}` WHERE {where_clause} FOR UPDATE",
                    key,
                )
                live_record = cursor.fetchone()
                live_hash = (
                    self._related_row_hash(live_record, sync_columns)
                    if live_record is not None
                    else None
                )
                if live_hash != candidate["current_hash"]:
                    # Outra gravação ocorreu após a leitura. Não a sobrescrevemos.
                    self._related_gate().mark_write_failed(identity)
                    self._svc_log.warning(
                        "[RELATED_SYNC] %s %s/%s mudou durante a confirmação; aguardando novos ciclos",
                        table,
                        key[0],
                        key[1],
                    )
                    continue

                if live_record is None:
                    columns_clause = ", ".join(f"`{column}`" for column in sync_columns)
                    placeholders = ", ".join("%s" for _ in sync_columns)
                    cursor.execute(
                        f"INSERT INTO `{table}` ({columns_clause}) VALUES ({placeholders})",
                        [record.get(column) for column in sync_columns],
                    )
                    operation = "INSERT"
                elif mutable_columns:
                    set_clause = ", ".join(f"`{column}` = %s" for column in mutable_columns)
                    cursor.execute(
                        f"UPDATE `{table}` SET {set_clause} WHERE {where_clause}",
                        [record.get(column) for column in mutable_columns] + list(key),
                    )
                    operation = "UPDATE"
                else:
                    continue

                written.append(identity)
                self._svc_log.info(
                    "[RELATED_SYNC] %s confirmado após %s ciclos: %s %s/%s (%s)",
                    table,
                    SYNC_RELATED_RECONCILE_STABLE_CYCLES,
                    operation,
                    key[0],
                    key[1],
                    source_name,
                )

            mysql_conn.commit()
        except Exception:
            mysql_conn.rollback()
            for candidate in candidates:
                self._related_gate().mark_write_failed(candidate["identity"])
            raise
        else:
            for identity in written:
                self._related_gate().mark_written(identity)
        finally:
            cursor.close()

    def _reconcile_related_table(
        self,
        mdb_conn,
        mysql_conn,
        source_name: str,
        is_os: bool,
        spec: Dict[str, Any],
        tombstones: Set[tuple],
    ) -> None:
        table = spec["table"]
        scope = (source_name, table)
        policies = self._related_policies
        policy = policies.get(table) or {}
        if not policy.get("enabled", True) or policy.get("mode", "uni") != "uni":
            self._related_gate().discard_not_seen(scope, set())
            self._svc_log.info("[RELATED_SYNC] %s desabilitada pela política", table)
            return

        mdb_records, mysql_records, sync_columns = self._read_related_table(
            mdb_conn, mysql_conn, spec, is_os
        )
        mdb_by_key = self._unique_related_records(
            mdb_records, spec["pk_fields"], f"MDB {source_name}/{table}"
        )
        mysql_by_key = self._unique_related_records(
            mysql_records, spec["pk_fields"], f"MySQL/{table}"
        )

        candidates: List[Dict[str, Any]] = []
        seen_identities: Set[tuple] = set()
        for key, mdb_record in mdb_by_key.items():
            identity = scope + key
            seen_identities.add(identity)
            os_key = (mdb_record.get(spec["nro_field"]), mdb_record.get(spec["year_field"]))
            if os_key in tombstones:
                self._related_gate().discard(identity)
                continue

            desired_hash = self._related_row_hash(mdb_record, sync_columns)
            mysql_record = mysql_by_key.get(key)
            current_hash = (
                self._related_row_hash(mysql_record, sync_columns)
                if mysql_record is not None
                else None
            )
            if not self._related_gate().observe(identity, desired_hash, current_hash):
                continue
            candidates.append(
                {
                    "record": mdb_record,
                    "key": key,
                    "identity": identity,
                    "current_hash": current_hash,
                }
            )

        self._related_gate().discard_not_seen(scope, seen_identities)
        if not candidates:
            return

        to_apply = candidates[:SYNC_RELATED_RECONCILE_MAX_WRITES]
        if len(candidates) > len(to_apply):
            self._svc_log.warning(
                "[RELATED_SYNC] limite de %s escritas por ciclo atingido em %s; restante aguardará",
                SYNC_RELATED_RECONCILE_MAX_WRITES,
                table,
            )
        self._apply_related_candidates(
            mysql_conn, spec, source_name, to_apply, sync_columns
        )

    def _reconcile_related_tables(self) -> None:
        """Executa um ciclo seguro, fora do caminho e do estado de tabAndamento."""
        if not SYNC_RELATED_RECONCILE_ENABLED:
            return

        mysql_conn = None
        try:
            mysql_conn = mysql.connector.connect(
                host=self.config.mysql_host,
                port=self.config.mysql_port,
                user=self.config.mysql_user,
                password=self.config.mysql_password,
                database=self.config.mysql_database,
                charset="utf8mb4",
                autocommit=False,
                connection_timeout=SYNC_CONNECT_TIMEOUT,
            )
            isolation_cursor = mysql_conn.cursor()
            try:
                isolation_cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
            finally:
                isolation_cursor.close()
            self._related_policies = self._load_related_policies(mysql_conn)
            if self._related_policies is None:
                return
            tombstones = self._related_tombstones(mysql_conn)
            if tombstones is None:
                return

            for source_name, is_os, path in (
                ("OS_Atual", True, self.config.mdb_os_atual_path),
                ("Papelaria", False, self.config.mdb_papelaria_path),
            ):
                if not os.path.isfile(path):
                    self._svc_log.error("[RELATED_SYNC] MDB indisponível: %s", path)
                    continue
                mdb_conn = None
                try:
                    driver = "{Microsoft Access Driver (*.mdb, *.accdb)}"
                    mdb_conn = pyodbc.connect(
                        f"DRIVER={driver};DBQ={path};",
                        autocommit=False,
                        timeout=SYNC_CONNECT_TIMEOUT,
                    )
                    for spec in _RELATED_TABLE_SPECS:
                        self._reconcile_related_table(
                            mdb_conn, mysql_conn, source_name, is_os, spec, tombstones
                        )
                except Exception as exc:
                    mysql_conn.rollback()
                    self._svc_log.error(
                        "[RELATED_SYNC] ciclo abortado para %s; a tabela em erro foi revertida: %s",
                        source_name,
                        exc,
                    )
                finally:
                    if mdb_conn is not None:
                        try:
                            mdb_conn.close()
                        except Exception:
                            pass
        except Exception as exc:
            if mysql_conn is not None:
                try:
                    mysql_conn.rollback()
                except Exception:
                    pass
            self._svc_log.error("[RELATED_SYNC] falha ao preparar ciclo: %s", exc)
        finally:
            if mysql_conn is not None:
                try:
                    mysql_conn.close()
                except Exception:
                    pass

    def _run_background_sync(self):
        """Worker exclusivo de Protocolos/Detalhes; nunca aciona nem altera tabAndamento."""
        self._svc_log.info(
            "[RELATED_SYNC] iniciado: intervalo=%ss, confirmação=%s ciclos, max_escritas=%s",
            SYNC_RELATED_RECONCILE_INTERVAL,
            SYNC_RELATED_RECONCILE_STABLE_CYCLES,
            SYNC_RELATED_RECONCILE_MAX_WRITES,
        )
        while self.running:
            started = time.monotonic()
            self._reconcile_related_tables()
            remaining = max(0.0, SYNC_RELATED_RECONCILE_INTERVAL - (time.monotonic() - started))
            while self.running and remaining > 0:
                step = min(0.2, remaining)
                time.sleep(step)
                remaining -= step
        self._svc_log.info("[RELATED_SYNC] finalizado")

    def sync_os_data_from_mdb(self, nro: int, ano: int, origem: str):
        """
        Mantém a pré-condição de FK do fluxo de tabAndamento sem fazer UPDATE
        antecipado de dados da OS. Alterações de Protocolos/Detalhes seguem
        exclusivamente a reconciliação estável em segundo plano.
        """
        try:
            if self.is_os_deleted(nro, ano):
                self._svc_log.info(
                    "[RELATED_SYNC] protocolo %s/%s ignorado: OS tombstoned", nro, ano
                )
                return

            mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
            mdb_cursor = mdb_conn.cursor()
            try:
                mdb_cursor.execute(
                    "SELECT * FROM tabProtocolos WHERE NroProtocolo = ? AND AnoProtocolo = ?",
                    (nro, ano),
                )
                row = mdb_cursor.fetchone()
                if row is None:
                    self._svc_log.warning(
                        "[RELATED_SYNC] protocolo %s/%s ausente no MDB %s", nro, ano, origem
                    )
                    return
                columns = [desc[0] for desc in mdb_cursor.description]
                record = dict(zip(columns, row))
            finally:
                mdb_cursor.close()

            pk_fields = ("NroProtocolo", "AnoProtocolo")
            sync_columns = self._sync_allowed_columns(
                columns, core._PROTOCOL_SYNC_ALLOWLIST, list(pk_fields)
            )
            if any(field not in sync_columns for field in pk_fields):
                raise ValueError("chave de tabProtocolos ausente no MDB")

            mysql_conn = self.conn_mgr.get_mysql()
            mysql_cursor = mysql_conn.cursor(dictionary=True)
            try:
                mysql_cursor.execute(
                    "SELECT 1 FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
                    (nro, ano),
                )
                if mysql_cursor.fetchone() is not None:
                    # Atualizações são deliberadamente adiadas até confirmação estável.
                    return

                columns_clause = ", ".join(f"`{column}`" for column in sync_columns)
                placeholders = ", ".join("%s" for _ in sync_columns)
                mysql_cursor.execute(
                    f"INSERT INTO tabProtocolos ({columns_clause}) VALUES ({placeholders})",
                    [record.get(column) for column in sync_columns],
                )
                mysql_conn.commit()
                self._svc_log.info(
                    "[RELATED_SYNC] protocolo %s/%s inserido como pré-condição de tabAndamento (%s)",
                    nro,
                    ano,
                    origem,
                )
            except Exception:
                mysql_conn.rollback()
                raise
            finally:
                mysql_cursor.close()
        except Exception as exc:
            # Nunca impede a rotina principal de tratar seu próprio erro/retentativa.
            self._svc_log.error(
                "[RELATED_SYNC] falha ao garantir protocolo para tabAndamento %s/%s: %s",
                nro,
                ano,
                exc,
            )

    def _install_reliable_notify(self) -> None:
        """
        Substitui notify_api do Old por URL interna (uvicorn) + header de secret,
        e também notifica em UPDATE (Old só dispara em INSERT/DELETE).
        """
        original_log = self.logger.log
        fail_interval = SYNC_NOTIFY_FAIL_LOG_INTERVAL
        svc_log = self._svc_log

        def notify_api(nro: int, ano: int, action: str):
            if not nro or not ano:
                return
            try:
                from config_manager import config_manager

                if SYNC_NOTIFY_INTERNAL_BASE:
                    api_base = config_manager.get_api_internal_base()
                else:
                    # Escape hatch legado (não recomendado em produção).
                    api_base = config_manager.get_api_base()
                url = f"{api_base.rstrip('/')}/realtime/notify"
                if "0.0.0.0" in url:
                    url = url.replace("0.0.0.0", "127.0.0.1")

                headers = {}
                try:
                    from security.notify_auth import notify_request_headers

                    headers = notify_request_headers() or {}
                except Exception:
                    headers = {}

                import requests

                payload = {
                    "type": "system_update",
                    "id": nro,
                    "ano": ano,
                    "action": action,
                    "origem": "sync_bot",
                }
                requests.post(url, json=payload, headers=headers, timeout=0.5)
            except Exception as exc:
                now = time.time()
                if now - self._notify_fail_ts >= fail_interval:
                    self._notify_fail_ts = now
                    svc_log.warning("[NOTIFY] falha ao avisar API: %s", exc)

        def log(
            tipo: str,
            origem: str,
            destino: str,
            codstatus: str,
            nro: int = None,
            ano: int = None,
            detalhes: str = None,
            sucesso: bool = True,
            erro: str = None,
        ):
            original_log(
                tipo,
                origem,
                destino,
                codstatus,
                nro,
                ano,
                detalhes,
                sucesso,
                erro,
            )
            # Old já chama notify_api em INSERT/DELETE via o método substituído acima.
            # UPDATE também precisa disparar refresh na home/painéis.
            if sucesso and tipo == "UPDATE" and nro and ano:
                notify_api(nro, ano, "sync_update")

        self.logger.notify_api = notify_api  # type: ignore[method-assign]
        self.logger.log = log  # type: ignore[method-assign]
        self._original_notify_log = original_log

    # ------------------------------------------------------------------
    # Conexões / leituras
    # ------------------------------------------------------------------

    def _mdb_paths_available(self) -> bool:
        os_path = self.config.mdb_os_atual_path
        pap_path = self.config.mdb_papelaria_path
        os_ok = bool(os_path) and os.path.exists(os_path)
        pap_ok = bool(pap_path) and os.path.exists(pap_path)
        if os_ok and pap_ok:
            return True
        now = time.time()
        if now - self._mdb_missing_warn_ts >= self._mdb_missing_warn_interval:
            missing = []
            if not os_ok:
                missing.append(f"OS_Atual={os_path!r}")
            if not pap_ok:
                missing.append(f"Papelaria={pap_path!r}")
            self._svc_log.warning(
                "[SKIP] MDB indisponivel (share fora do ar?): %s - ciclo pulado",
                "; ".join(missing),
            )
            self._mdb_missing_warn_ts = now
        return False

    def _invalidate_for_conn(self, conn) -> None:
        if conn is self.conn_mgr.mdb_os_conn:
            self.conn_mgr.invalidate_mdb_os()
        elif conn is self.conn_mgr.mdb_pap_conn:
            self.conn_mgr.invalidate_mdb_pap()
        else:
            # Conexão desconhecida - invalida ambos por segurança
            self.conn_mgr.invalidate_mdb_os()
            self.conn_mgr.invalidate_mdb_pap()

    def _is_mysql_conn_error(self, exc: BaseException) -> bool:
        if isinstance(exc, MySQLError):
            errno = getattr(exc, "errno", None)
            if errno in MYSQL_CONN_ERRNOS:
                return True
        msg = str(exc).lower()
        markers = (
            "lost connection",
            "not connected",
            "can't connect",
            "cannot connect",
            "server has gone away",
            "table definition has changed",
            "2013",
            "2006",
            "2003",
            "1412",
        )
        return any(m in msg for m in markers)

    def read_mysql(self):
        """
        Mesma query do legado.
        Em sucesso: List[Dict].
        Em falha: sentinel _MYSQL_READ_FAILED (ciclo deve abortar - o legado
        retornava [] e isso gerava tempestade de inserts).
        """
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor(dictionary=True)
            data_limite = self.get_data_limite()
            cursor.execute(
                """
                SELECT
                    CodStatus, NroProtocoloLink, AnoProtocoloLink,
                    SituacaoLink, SetorLink, Data, UltimoStatus,
                    Observaçao, Ponto
                FROM tabandamento
                WHERE Data >= %s
                  AND CodStatus IS NOT NULL
                  AND AnoProtocoloLink >= 2024
                ORDER BY CodStatus
                """,
                (data_limite,),
            )
            result = cursor.fetchall()
            cursor.close()
            return result
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao ler MySQL: {e}")
            self._svc_log.error("[ERRO] Erro ao ler MySQL (abortando ciclo): %s", e)
            if self._is_mysql_conn_error(e):
                self.conn_mgr.invalidate_mysql()
            return _MYSQL_READ_FAILED

    def read_mdb(self, conn: pyodbc.Connection):
        """Igual ao legado, mas invalida a conexão MDB em qualquer falha."""
        try:
            cursor = conn.cursor()
            data_limite = self.get_data_limite()
            cursor.execute(
                """
                SELECT
                    CodStatus, NroProtocoloLink, AnoProtocoloLink,
                    SituacaoLink, SetorLink, Data, UltimoStatus,
                    Observaçao, Ponto
                FROM tabandamento
                WHERE Data >= ? AND AnoProtocoloLink >= 2024
                ORDER BY CodStatus
                """,
                (data_limite,),
            )
            columns = [col[0] for col in cursor.description]
            result = []
            row = cursor.fetchone()
            while row:
                r_dict = {}
                for i, col in enumerate(columns):
                    val = row[i]
                    if isinstance(val, str):
                        val = val.strip()
                    r_dict[col] = val
                result.append(r_dict)
                row = cursor.fetchone()
            cursor.close()
            return result
        except Exception as e:
            self._last_mdb_read_error = str(e)
            self.logger.logger.error(f"[ERRO CRÍTICO] Erro ao ler MDB: {e}")
            self.logger.logger.error("Abortando leitura para evitar inconsistências.")
            self._invalidate_for_conn(conn)
            return None

    def verify_mdb_existence(self, codstatus: str, origem: str) -> bool:
        """Igual ao legado; em erro invalida a conexão e retorna True (fail-safe)."""
        try:
            conn = (
                self.conn_mgr.get_mdb_os()
                if origem == "OS_Atual"
                else self.conn_mgr.get_mdb_pap()
            )
            cursor = conn.cursor()
            cursor.execute(
                "SELECT COUNT(*) FROM tabandamento WHERE CodStatus = ?", (codstatus,)
            )
            row = cursor.fetchone()
            exists = row[0] > 0 if row else False
            cursor.close()
            return exists
        except Exception as e:
            self.logger.logger.error(
                f"[ERRO] Erro ao verificar existência no MDB ({origem}): {e}"
            )
            if origem == "OS_Atual":
                self.conn_mgr.invalidate_mdb_os()
            else:
                self.conn_mgr.invalidate_mdb_pap()
            return True

    # ------------------------------------------------------------------
    # UltimoStatus + update MySQL->MDB
    # ------------------------------------------------------------------

    def ensure_mysql_ultimo_status_from_mdb(self, nro: int, ano: int):
        """Recalc canonico (maior CodStatus) + heal invariante + espelho MDB."""
        try:
            promoted = self._recalc_mysql_ultimo_status_operacional(nro, ano)
            healed = self._assert_or_fix_ultimo_mysql(nro, ano)
            if healed and healed != promoted:
                self._cycle_stats["ultimo_heals"] = (
                    self._cycle_stats.get("ultimo_heals", 0) + 1
                )
                promoted = healed
            self._push_ultimo_status_to_mdb(nro, ano, promoted)
            return promoted
        except Exception as e:
            self.logger.logger.error(
                f"[ERRO] Erro ao alinhar UltimoStatus MySQL+MDB em {nro}/{ano}: {e}"
            )
            return None

    def _assert_or_fix_ultimo_mysql(self, nro: int, ano: int):
        try:
            from services.andamento_operacional import assert_or_fix_unico_ultimo_status

            conn = self.conn_mgr.get_mysql()
            cur = conn.cursor(dictionary=True)
            try:
                promoted = assert_or_fix_unico_ultimo_status(cur, nro, ano)
                conn.commit()
                return promoted
            except Exception:
                conn.rollback()
                raise
            finally:
                cur.close()
        except ImportError:
            return None

    def _heal_os_batch(self, os_keys):
        for nro, ano in os_keys:
            self.ensure_mysql_ultimo_status_from_mdb(int(nro), int(ano))

    def _heal_broken_ultimo_flags(self, limit: int = 50) -> int:
        # A janela de data só escolhe as OS; as flags são contadas em todos os
        # andamentos da OS. Contar só na janela marcava como quebrada, a cada
        # ciclo, toda OS cujo último andamento canônico é anterior à janela.
        try:
            conn = self.conn_mgr.get_mysql()
            cur = conn.cursor(dictionary=True)
            data_limite = self.get_data_limite()
            cur.execute(
                """
                SELECT a.NroProtocoloLink AS nro, a.AnoProtocoloLink AS ano,
                       SUM(a.UltimoStatus = 1) AS flags
                FROM tabandamento a
                INNER JOIN (
                    SELECT DISTINCT NroProtocoloLink, AnoProtocoloLink
                    FROM tabandamento
                    WHERE Data >= %s AND AnoProtocoloLink >= 2024
                ) recentes
                  ON recentes.NroProtocoloLink = a.NroProtocoloLink
                 AND recentes.AnoProtocoloLink = a.AnoProtocoloLink
                GROUP BY a.NroProtocoloLink, a.AnoProtocoloLink
                HAVING flags <> 1
                LIMIT %s
                """,
                (data_limite, limit),
            )
            rows = cur.fetchall() or []
            cur.close()
        except Exception as e:
            self._svc_log.warning("[ULTIMO] scan de flags falhou: %s", e)
            return 0

        retry_at = getattr(self, "_ultimo_heal_retry_at", None)
        if retry_at is None:
            retry_at = {}
            self._ultimo_heal_retry_at = retry_at
        now = time.monotonic()
        for key in [k for k, until in retry_at.items() if until <= now]:
            retry_at.pop(key, None)

        heals = 0
        skipped = 0
        for row in rows:
            nro = row.get("nro") if isinstance(row, dict) else row[0]
            ano = row.get("ano") if isinstance(row, dict) else row[1]
            if nro is None or ano is None:
                continue
            key = (int(nro), int(ano))
            if key in retry_at:
                skipped += 1
                continue
            self.ensure_mysql_ultimo_status_from_mdb(key[0], key[1])
            if SYNC_ULTIMO_HEAL_RETRY_SECONDS > 0:
                retry_at[key] = now + SYNC_ULTIMO_HEAL_RETRY_SECONDS
            heals += 1
            self._cycle_stats["ultimo_heals"] = (
                self._cycle_stats.get("ultimo_heals", 0) + 1
            )
        if skipped:
            self._svc_log.debug(
                "[ULTIMO] %s OS aguardando nova tentativa de heal (%.0fs)",
                skipped,
                SYNC_ULTIMO_HEAL_RETRY_SECONDS,
            )
        return heals

    # ------------------------------------------------------------------
    # Payload canônico / baseline / direção de UPDATE
    # ------------------------------------------------------------------

    def _init_baseline_state(self) -> None:
        self._baseline: Dict[str, str] = {}
        self._baseline_dirty: Dict[str, str] = {}
        self._baseline_deleted: Set[str] = set()
        self._baseline_loaded = False
        self._baseline_prune_counter = 0
        self._conflict_log_cache: Dict[str, float] = {}
        self._conflict_log_interval = 300

    @staticmethod
    def _parse_andamento_data(val):
        if val is None:
            return datetime.min
        if isinstance(val, datetime):
            return val.replace(tzinfo=None) if val.tzinfo else val
        text = str(val).strip()
        if not text:
            return datetime.min
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S.%f",
            "%d/%m/%Y %H:%M:%S",
            "%Y-%m-%d",
        ):
            try:
                return datetime.strptime(text[:26], fmt)
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(text.replace("Z", ""))
        except ValueError:
            return datetime.min

    @staticmethod
    def _norm_str(val) -> str:
        if val is None:
            return ""
        return str(val).strip()

    def _norm_date(self, val) -> str:
        if not val:
            return ""
        if isinstance(val, datetime):
            dt = val.replace(tzinfo=None) if val.tzinfo else val
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        dt = self._parse_andamento_data(val)
        if dt == datetime.min:
            return str(val).strip()[:19]
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    def _data_for_format(self, val):
        if not val:
            return None
        if isinstance(val, datetime):
            return val.replace(tzinfo=None) if val.tzinfo else val
        dt = self._parse_andamento_data(val)
        if dt == datetime.min:
            return None
        return dt

    def _canonical_payload(self, rec: Dict) -> Dict[str, Any]:
        data_raw = rec.get("Data")
        data_fmt = self._data_for_format(data_raw)
        obs = self.format_observacao(rec.get("Observaçao"), data_fmt)
        ponto = self.format_ponto(rec.get("Ponto"))
        try:
            nro = int(rec.get("NroProtocoloLink") or 0)
        except (TypeError, ValueError):
            nro = 0
        try:
            ano = int(rec.get("AnoProtocoloLink") or 0)
        except (TypeError, ValueError):
            ano = 0
        return {
            "nro": nro,
            "ano": ano,
            "situacao": self._norm_str(rec.get("SituacaoLink")),
            "setor": self._norm_str(rec.get("SetorLink")),
            "data": self._norm_date(data_raw),
            "obs": self._norm_str(obs),
            "ponto": self._norm_str(ponto),
        }

    def _payload_hash(self, rec: Dict) -> str:
        blob = json.dumps(
            self._canonical_payload(rec),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def _andamentos_differ(self, mdb_rec: Dict, mysql_rec: Dict) -> bool:
        return self._payload_hash(mdb_rec) != self._payload_hash(mysql_rec)

    def _ambiguous_winner(self) -> str:
        return "mysql" if SYNC_CONFLICT_WINNER == "mysql" else "mdb"

    def _log_conflict(self, code: str) -> None:
        now = time.time()
        last = self._conflict_log_cache.get(code, 0.0)
        if now - last < self._conflict_log_interval:
            return
        self._conflict_log_cache[code] = now
        winner = "MDB" if self._ambiguous_winner() == "mdb" else "MySQL"
        self._svc_log.warning(
            "[CONFLITO] CodStatus=%s ambos alterados - %s vence", code, winner
        )

    def _resolve_update_direction(self, code: str, mdb_rec: Dict, mysql_rec: Dict) -> str:
        """'mdb' = MDB vence (update_mysql); 'mysql' = MySQL vence (update_mdb); 'equal'."""
        mdb_hash = self._payload_hash(mdb_rec)
        mysql_hash = self._payload_hash(mysql_rec)
        if mdb_hash == mysql_hash:
            return "equal"
        baseline = self._baseline.get(code)
        if not baseline:
            return self._ambiguous_winner()
        mdb_changed = mdb_hash != baseline
        mysql_changed = mysql_hash != baseline
        if mdb_changed and not mysql_changed:
            return "mdb"
        if mysql_changed and not mdb_changed:
            return "mysql"
        self._cycle_stats["conflitos"] = self._cycle_stats.get("conflitos", 0) + 1
        self._log_conflict(code)
        return self._ambiguous_winner()

    def _ensure_baseline_ready(self) -> None:
        if self._baseline_loaded:
            return
        try:
            self._create_baseline_table()
            self._load_baseline_cache()
            self._baseline_loaded = True
            self._svc_log.info("[BASELINE] carregado: %s linhas", len(self._baseline))
        except Exception as e:
            self._svc_log.warning("[BASELINE] indisponivel neste ciclo: %s", e)

    def _create_baseline_table(self) -> None:
        conn = self.conn_mgr.get_mysql()
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_andamento_baseline (
                CodStatus VARCHAR(50) NOT NULL PRIMARY KEY,
                payload_hash CHAR(64) NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            """
        )
        conn.commit()
        cursor.close()

    def _load_baseline_cache(self) -> None:
        conn = self.conn_mgr.get_mysql()
        cursor = conn.cursor()
        cursor.execute("SELECT CodStatus, payload_hash FROM sync_andamento_baseline")
        self._baseline = {row[0]: row[1] for row in cursor.fetchall()}
        cursor.close()
        self._baseline_dirty.clear()
        self._baseline_deleted.clear()

    def _mark_baseline(self, code: str, payload_hash: str) -> None:
        if not code or not payload_hash:
            return
        if self._baseline.get(code) == payload_hash:
            self._baseline_deleted.discard(code)
            return
        self._baseline[code] = payload_hash
        self._baseline_dirty[code] = payload_hash
        self._baseline_deleted.discard(code)

    def _forget_baseline(self, code: str) -> None:
        if not code:
            return
        self._baseline.pop(code, None)
        self._baseline_dirty.pop(code, None)
        self._baseline_deleted.add(code)

    def _maybe_prune_baseline(self, live_codes: Set) -> None:
        self._baseline_prune_counter += 1
        if self._baseline_prune_counter < _BASELINE_PRUNE_EVERY:
            return
        self._baseline_prune_counter = 0
        stale = [c for c in self._baseline if c not in live_codes]
        for code in stale:
            self._forget_baseline(code)
        if stale:
            self._svc_log.info("[BASELINE] poda: %s linhas fora da janela", len(stale))

    def _flush_baseline(self) -> None:
        if not self._baseline_dirty and not self._baseline_deleted:
            return
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            to_delete = [
                c for c in self._baseline_deleted if c not in self._baseline_dirty
            ]
            if to_delete:
                cursor.executemany(
                    "DELETE FROM sync_andamento_baseline WHERE CodStatus = %s",
                    [(c,) for c in to_delete],
                )
            if self._baseline_dirty:
                cursor.executemany(
                    """
                    INSERT INTO sync_andamento_baseline (CodStatus, payload_hash)
                    VALUES (%s, %s)
                    ON DUPLICATE KEY UPDATE payload_hash = VALUES(payload_hash)
                    """,
                    list(self._baseline_dirty.items()),
                )
            conn.commit()
            cursor.close()
            self._baseline_dirty.clear()
            self._baseline_deleted.clear()
        except Exception as e:
            self._svc_log.warning("[BASELINE] flush falhou: %s", e)
            if self._is_mysql_conn_error(e):
                self.conn_mgr.invalidate_mysql()

    def update_mdb(self, andamento, conn, destino: str):
        try:
            codstatus = andamento["CodStatus"]
            cursor = conn.cursor()
            obs = andamento.get("Observaçao", "") or ""
            if obs:
                obs = str(obs).replace("\n", "\r\n")
            cursor.execute(
                """
                UPDATE tabandamento
                SET NroProtocoloLink = ?,
                    AnoProtocoloLink = ?,
                    SituacaoLink = ?,
                    SetorLink = ?,
                    Data = ?,
                    Observaçao = ?,
                    Ponto = ?
                WHERE CodStatus = ?
                """,
                (
                    andamento["NroProtocoloLink"],
                    andamento["AnoProtocoloLink"],
                    andamento["SituacaoLink"],
                    andamento["SetorLink"],
                    andamento["Data"],
                    obs,
                    andamento["Ponto"],
                    codstatus,
                ),
            )
            conn.commit()
            cursor.close()
            self.logger.log(
                "UPDATE",
                "MySQL",
                destino,
                codstatus,
                andamento.get("NroProtocoloLink"),
                andamento.get("AnoProtocoloLink"),
                "Andamento atualizado por alteracao no MySQL",
            )
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            self.logger.log(
                "UPDATE",
                "MySQL",
                destino,
                andamento.get("CodStatus"),
                andamento.get("NroProtocoloLink"),
                andamento.get("AnoProtocoloLink"),
                sucesso=False,
                erro=str(e),
            )
            self._invalidate_for_conn(conn)

    def detect_and_register_deletions(self, mysql_codes, mdb_all_codes, mysql_data=None):
        excluidos_confirmados = set()
        mysql_by_code = {
            a["CodStatus"]: a for a in (mysql_data or []) if a.get("CodStatus")
        }
        try:
            from sync_os_deletes import os_keys_pending_or_deleted

            os_protected = os_keys_pending_or_deleted(self.conn_mgr)
        except Exception:
            os_protected = set()
        try:
            conn = self.conn_mgr.get_mysql()
            cursor = conn.cursor()
            cursor.execute(
                "SELECT codstatus, nro, ano, origem FROM cache_andamentos_mdb WHERE ano >= 2024"
            )
            cache = {row[0]: row for row in cursor.fetchall()}
            cursor.close()

            cache_codes = set(cache.keys())
            candidatos_exclusao = cache_codes - mdb_all_codes
            if not candidatos_exclusao:
                return set()

            for code in candidatos_exclusao:
                if code not in cache:
                    continue
                _, nro, ano, origem = cache[code]
                # OS em exclusão/quarentena: não contar no SAFETY LOCK de andamentos
                if (int(nro), int(ano)) in os_protected:
                    continue
                if not self.verify_mdb_existence(code, origem):
                    excluidos_confirmados.add(code)

            if len(excluidos_confirmados) > 5:
                msg = (
                    f"[SAFETY LOCK] Tentativa de excluir {len(excluidos_confirmados)} "
                    "registros de uma vez. ABORTANDO para evitar perda de dados."
                )
                self.logger.logger.critical(msg)
                self.logger.logger.critical(
                    f"Registros abortados: {list(excluidos_confirmados)}"
                )
                self._svc_log.error(msg)
                self._cycle_stats["safety_lock_aborts"] = (
                    self._cycle_stats.get("safety_lock_aborts", 0) + 1
                )
                return set()

            for code in excluidos_confirmados:
                if code not in cache:
                    continue
                _, nro, ano, origem = cache[code]
                self.mark_as_deleted(
                    code,
                    nro,
                    ano,
                    origem,
                    andamento=mysql_by_code.get(code),
                    motivo="Exclusao confirmada no MDB",
                )
                self.logger.logger.info(
                    f"[DETECCAO] CodStatus {code} excluido do MDB {origem} (Verificado)."
                )
            return excluidos_confirmados
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao detectar exclusoes: {e}")
            return set()

    def _load_effective_policies(self):
        from sync_policy import apply_env_kill_switches, load_policies

        conn = self.conn_mgr.get_mysql()
        cur = conn.cursor(dictionary=True)
        try:
            policies = load_policies(cur)
        finally:
            cur.close()
        return apply_env_kill_switches(policies)

    # ------------------------------------------------------------------
    # perform_sync: tabAndamento bidirecional + heartbeat
    # ------------------------------------------------------------------

    def perform_sync(self):
        self._hb.mark_progress("perform_sync")
        self._cycle_stats = _empty_cycle_stats()
        touched_os = set()
        bidi = SYNC_TABANDAMENTO_BIDI and SYNC_MYSQL_TO_MDB_CATCHUP
        try:
            if not self._mdb_paths_available():
                self._hb.mark_skip_cycle("mdb_unavailable")
                return

            self._hb.mark_progress("read_mysql")
            mysql_data = self.read_mysql()
            if mysql_data is _MYSQL_READ_FAILED:
                self._svc_log.error(
                    "[ABORT] Falha na leitura do MySQL. Ciclo de sincronizacao abortado."
                )
                self._hb.mark_cycle_error("mysql_read_failed")
                return

            self._hb.mark_progress("read_mdb_os")
            mdb_os_data = self.read_mdb(self.conn_mgr.get_mdb_os())
            if mdb_os_data is None:
                self.logger.logger.error(
                    "[ABORT] Falha na leitura do MDB OS_Atual. Ciclo de sincronizacao abortado."
                )
                self._hb.mark_cycle_error("mdb_os_read_failed")
                self._note_mdb_error(getattr(self, "_last_mdb_read_error", ""))
                return

            self._hb.mark_progress("read_mdb_pap")
            mdb_pap_data = self.read_mdb(self.conn_mgr.get_mdb_pap())
            if mdb_pap_data is None:
                self.logger.logger.error(
                    "[ABORT] Falha na leitura do MDB Papelaria. Ciclo de sincronizacao abortado."
                )
                self._hb.mark_cycle_error("mdb_pap_read_failed")
                self._note_mdb_error(getattr(self, "_last_mdb_read_error", ""))
                return
            self._mdb_fatal_tracker().observe_success()

            self._ensure_baseline_ready()

            try:
                policies = self._load_effective_policies()
            except Exception as e:
                self._svc_log.warning("[POLICY] falha ao carregar sync_policy: %s", e)
                policies = {}

            and_policy = policies.get("tabAndamento") or {}
            # Sem policy no DB: manter comportamento atual (bi ligado).
            and_enabled = bool(and_policy.get("enabled", True))
            and_mode = and_policy.get("mode") or "bi"
            bidi_policy = and_enabled and (and_mode == "bi")
            # Env kill-switch already applied in _load_effective_policies;
            # still require module flags for emergency.
            bidi = (
                bidi
                and bidi_policy
                and SYNC_TABANDAMENTO_BIDI
                and SYNC_MYSQL_TO_MDB_CATCHUP
            )

            mysql_codes = {a["CodStatus"] for a in mysql_data}
            mdb_os_codes = {a["CodStatus"] for a in mdb_os_data}
            mdb_pap_codes = {a["CodStatus"] for a in mdb_pap_data}
            mdb_all_codes = mdb_os_codes | mdb_pap_codes

            self._hb.mark_progress("detect_deletions")
            excluidos = self.detect_and_register_deletions(
                mysql_codes, mdb_all_codes, mysql_data=mysql_data
            )

            self._hb.mark_progress("update_cache")
            self.update_cache(mdb_os_data, mdb_pap_data)

            self._hb.mark_progress("inserts_m2y")
            novos_no_mdb = mdb_all_codes - mysql_codes
            for code in novos_no_mdb:
                and_ = None
                origem = None
                for a in mdb_os_data:
                    if a["CodStatus"] == code:
                        and_ = a
                        origem = "OS_Atual"
                        break
                if not and_:
                    for a in mdb_pap_data:
                        if a["CodStatus"] == code:
                            and_ = a
                            origem = "Papelaria"
                            break
                if and_:
                    self.sync_os_data_from_mdb(
                        and_["NroProtocoloLink"], and_["AnoProtocoloLink"], origem
                    )
                    self.insert_mysql(and_, origem)
                    self._mark_baseline(code, self._payload_hash(and_))
                    self._cycle_stats["ins_m2y"] += 1
                    touched_os.add(
                        (and_["NroProtocoloLink"], and_["AnoProtocoloLink"])
                    )
                    self.ensure_mysql_ultimo_status_from_mdb(
                        and_["NroProtocoloLink"], and_["AnoProtocoloLink"]
                    )

            self._hb.mark_progress("updates")
            comuns = mysql_codes & mdb_all_codes
            for code in comuns:
                mysql_rec = next((a for a in mysql_data if a["CodStatus"] == code), None)
                mdb_rec = None
                origem = None
                for a in mdb_os_data:
                    if a["CodStatus"] == code:
                        mdb_rec = a
                        origem = "OS_Atual"
                        break
                if not mdb_rec:
                    for a in mdb_pap_data:
                        if a["CodStatus"] == code:
                            mdb_rec = a
                            origem = "Papelaria"
                            break
                if not (mdb_rec and mysql_rec):
                    continue
                if not self._andamentos_differ(mdb_rec, mysql_rec):
                    self._mark_baseline(code, self._payload_hash(mdb_rec))
                    continue

                nro = mysql_rec["NroProtocoloLink"]
                ano = mysql_rec["AnoProtocoloLink"]
                touched_os.add((nro, ano))

                direction = "mdb"
                if bidi:
                    direction = self._resolve_update_direction(code, mdb_rec, mysql_rec)

                if direction == "equal":
                    self._mark_baseline(code, self._payload_hash(mdb_rec))
                    continue

                if bidi and direction == "mysql":
                    mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
                    destino = self.conn_mgr.get_mdb_name_by_nro(nro)
                    self.update_mdb(mysql_rec, mdb_conn, destino)
                    self._mark_baseline(code, self._payload_hash(mysql_rec))
                    self._cycle_stats["upd_y2m"] += 1
                    self._svc_log.info(
                        "[BI] UPDATE MySQL->MDB CodStatus=%s OS=%s/%s", code, nro, ano
                    )
                else:
                    self.sync_os_data_from_mdb(nro, ano, origem)
                    self.update_mysql(mdb_rec, origem)
                    self._mark_baseline(code, self._payload_hash(mdb_rec))
                    self._cycle_stats["upd_m2y"] += 1

                self.ensure_mysql_ultimo_status_from_mdb(nro, ano)

            # Deletes antes do catch-up: exclusão MDB não pode ser desfeita por INSERT y2m
            self._hb.mark_progress("deletes")
            if excluidos:
                for code in excluidos:
                    and_ = next((a for a in mysql_data if a["CodStatus"] == code), None)
                    if and_:
                        self.delete_mysql(code, and_)
                        self._forget_baseline(code)
                        self._cycle_stats["del_y"] += 1
                        touched_os.add(
                            (and_["NroProtocoloLink"], and_["AnoProtocoloLink"])
                        )
                        self.ensure_mysql_ultimo_status_from_mdb(
                            and_["NroProtocoloLink"], and_["AnoProtocoloLink"]
                        )

            # Exclusão segura de OS (Protocolos/Detalhes + andamentos)
            self._hb.mark_progress("os_deletes")
            try:
                from sync_os_deletes import OsDeleteManager

                os_result = OsDeleteManager(self).run_phase(policies)
                self._cycle_stats["os_del_candidates"] = os_result.candidates
                self._cycle_stats["os_del_executed"] = os_result.executed
                self._cycle_stats["os_del_quarantined"] = os_result.quarantined
                if os_result.aborted:
                    self._cycle_stats["os_del_aborted"] = 1
            except Exception as e:
                self._svc_log.error("[OS_DEL] fase falhou: %s", e)
                self._svc_log.error(traceback.format_exc())
                try:
                    self.conn_mgr.invalidate_mysql()
                except Exception:
                    pass

            if bidi:
                self._hb.mark_progress("inserts_y2m")
                novos_no_mysql = mysql_codes - mdb_all_codes
                for code in novos_no_mysql:
                    if code in excluidos:
                        self._svc_log.info(
                            "[CATCHUP] skip CodStatus=%s motivo=excluido", code
                        )
                        continue
                    if self.is_deleted(code):
                        self._svc_log.info(
                            "[CATCHUP] skip CodStatus=%s motivo=tombstone", code
                        )
                        continue
                    and_ = next((a for a in mysql_data if a["CodStatus"] == code), None)
                    if not and_:
                        continue
                    nro = and_["NroProtocoloLink"]
                    ano = and_["AnoProtocoloLink"]
                    if self.is_os_deleted(nro, ano):
                        self._svc_log.info(
                            "[CATCHUP] skip CodStatus=%s motivo=deleted_os", code
                        )
                        continue
                    try:
                        mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
                        destino = self.conn_mgr.get_mdb_name_by_nro(nro)
                        self.insert_mdb(and_, mdb_conn, destino)
                        self._mark_baseline(code, self._payload_hash(and_))
                        self._cycle_stats["ins_y2m"] += 1
                        touched_os.add((nro, ano))
                        self._svc_log.info(
                            "[CATCHUP] MySQL->MDB INSERT CodStatus=%s OS=%s/%s destino=%s",
                            code,
                            nro,
                            ano,
                            destino,
                        )
                        self.ensure_mysql_ultimo_status_from_mdb(nro, ano)
                    except Exception as e:
                        self._svc_log.warning(
                            "[CATCHUP] falha MySQL->MDB CodStatus=%s: %s", code, e
                        )

                remaining = len(mysql_codes - mdb_all_codes) - self._cycle_stats["ins_y2m"]
                self._cycle_stats["mysql_only_remaining"] = max(0, remaining)

            self._hb.mark_progress("ultimo_heal")
            self._heal_os_batch(touched_os)
            self._heal_broken_ultimo_flags(limit=30)

            if not hasattr(self, "_format_counter"):
                self._format_counter = 0

            self._format_counter += 1
            if self._format_counter >= 10:
                self._hb.mark_progress("format")
                self.apply_formatting_to_recent_records()
                self._format_counter = 0

            self._maybe_prune_baseline(mysql_codes | mdb_all_codes)
            self._flush_baseline()
            self._cycle_stats["baseline_rows"] = len(self._baseline)
            self._hb.mark_cycle_ok(self._cycle_stats)

        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro no ciclo de sincronizacao: {e}")
            self.logger.logger.error(traceback.format_exc())
            self._hb.mark_cycle_error(str(e))
            if self._is_mysql_conn_error(e):
                self.conn_mgr.invalidate_mysql()
            try:
                self.conn_mgr.get_mysql().rollback()
            except Exception:
                self.conn_mgr.invalidate_mysql()
            self._note_mdb_error(str(e))

    def _maybe_recycle_connections(self) -> None:
        interval = SYNC_CONN_RECYCLE_SECONDS
        if interval <= 0:
            return
        now = time.monotonic()
        if now - self._last_conn_recycle_mono < interval:
            return
        self._svc_log.info(
            "[RECYCLE] invalidando conexoes MDB/MySQL (intervalo=%.0fs)", interval
        )
        self.conn_mgr.invalidate_all()
        self._last_conn_recycle_mono = now

    # ------------------------------------------------------------------
    # Watchdog
    # ------------------------------------------------------------------

    @staticmethod
    def _is_fatal_stall(phase: str, stall: float) -> bool:
        if (phase or "") == "mdb_unavailable":
            return False
        return stall >= SYNC_STALL_TIMEOUT

    def _dump_all_stacks(self) -> None:
        try:
            self._svc_log.critical("--- STACK DUMP (stall) ---")
            frames = sys._current_frames()
            for thread_id, frame in frames.items():
                self._svc_log.critical("Thread %s:\n%s", thread_id, "".join(traceback.format_stack(frame)))
        except Exception as e:
            self._svc_log.critical("Falha ao dumpar stacks: %s", e)
        try:
            faulthandler.dump_traceback(file=sys.stderr if sys.stderr else sys.stdout)
        except Exception:
            pass
        for handler in logging.getLogger().handlers:
            try:
                handler.flush()
            except Exception:
                pass

    def _watchdog_loop(self) -> None:
        self._svc_log.info(
            "[WATCHDOG] Iniciado (stall_timeout=%.0fs, interval=%.0fs)",
            SYNC_STALL_TIMEOUT,
            SYNC_WATCHDOG_INTERVAL,
        )
        while self.running:
            try:
                self._hb.write()
                snap = self._hb.snapshot()
                stall = snap["stall_seconds"]
                phase = snap.get("phase") or ""
                # Skip intencional de share MDB: nao tratar como stall fatal.
                # Sempre dormir depois (nao continue) para nao girar a 100% CPU.
                if self._is_fatal_stall(phase, stall):
                    self._svc_log.critical(
                        "[WATCHDOG] STALL detectado: phase=%s stall=%.1fs - "
                        "encerrando com codigo %s para NSSM reiniciar",
                        snap["phase"],
                        stall,
                        STALL_EXIT_CODE,
                    )
                    self._dump_all_stacks()
                    os._exit(STALL_EXIT_CODE)
            except Exception as e:
                self._svc_log.error("[WATCHDOG] Erro: %s", e)

            for _ in range(int(max(SYNC_WATCHDOG_INTERVAL, 0.5) * 10)):
                if not self.running:
                    break
                time.sleep(0.1)

        try:
            self._hb.write()
        except Exception:
            pass
        self._svc_log.info("[WATCHDOG] Finalizado")

    # ------------------------------------------------------------------
    # Startup / supervisor
    # ------------------------------------------------------------------

    def _wait_for_dependencies(self) -> bool:
        """Retry com backoff até MySQL (e paths MDB, se já montados) responderem."""
        delay = SYNC_BACKOFF_MIN
        attempt = 0
        while self.running:
            attempt += 1
            self._hb.mark_progress("startup_wait")
            mysql_ok = False
            try:
                conn = self.conn_mgr.get_mysql()
                cur = conn.cursor()
                cur.execute("SELECT 1")
                cur.fetchone()
                cur.close()
                mysql_ok = True
            except Exception as e:
                self.conn_mgr.invalidate_mysql()
                self._svc_log.warning(
                    "[STARTUP] MySQL indisponivel (tentativa %s): %s", attempt, e
                )

            mdb_ok = self._mdb_paths_available()
            if mysql_ok and mdb_ok:
                self._svc_log.info("[STARTUP] Dependencias OK")
                return True

            self._svc_log.info(
                "[STARTUP] Aguardando dependencias (mysql=%s mdb=%s) - sleep %.0fs",
                mysql_ok,
                mdb_ok,
                delay,
            )
            slept = 0.0
            while slept < delay and self.running:
                time.sleep(0.2)
                slept += 0.2
            delay = min(delay * 1.5, SYNC_BACKOFF_MAX)
        return False

    def run_continuous(self):
        self._svc_log.info("=" * 70)
        self._svc_log.info("[INICIO] SYNC SERVICE tabAndamento BIDIRECIONAL resiliente")
        self._svc_log.info(
            "[INFO] tabAndamento bi=%s | conflito=%s | Protocolos/Detalhes so MDB->MySQL",
            SYNC_TABANDAMENTO_BIDI and SYNC_MYSQL_TO_MDB_CATCHUP,
            SYNC_CONFLICT_WINNER,
        )
        self._svc_log.info(
            "[INFO] Monitorando ultimos %s dias | intervalo=%ss | stall=%ss | recycle=%ss",
            self.config.dias_monitoramento,
            self.config.intervalo_segundos,
            SYNC_STALL_TIMEOUT,
            SYNC_CONN_RECYCLE_SECONDS,
        )
        self._svc_log.info("[INFO] Filtro de Ano: APENAS REGISTROS >= 2024")
        self._svc_log.info("[INFO] PID: %s", os.getpid())
        self._svc_log.info("=" * 70)

        try:
            self.running = True

            if not self._wait_for_dependencies():
                return

            self._bg_thread = threading.Thread(
                target=self._run_background_sync, daemon=True, name="bg_sync"
            )
            self._bg_thread.start()

            self._watchdog_thread = threading.Thread(
                target=self._watchdog_loop, daemon=True, name="watchdog"
            )
            self._watchdog_thread.start()

            backoff = 0.0
            while self.running:
                inicio = time.time()
                try:
                    self.perform_sync()
                    backoff = 0.0
                    self._maybe_recycle_connections()
                except Exception as e:
                    self._svc_log.error("[ERRO] Excecao no supervisor: %s", e)
                    self._svc_log.error(traceback.format_exc())
                    self._hb.mark_cycle_error(str(e))
                    self.conn_mgr.invalidate_all()
                    self._last_conn_recycle_mono = time.monotonic()
                    backoff = (
                        SYNC_BACKOFF_MIN
                        if backoff <= 0
                        else min(backoff * 1.5, SYNC_BACKOFF_MAX)
                    )

                if not self.running:
                    break

                if backoff > 0:
                    self._svc_log.info("[BACKOFF] Aguardando %.1fs antes do proximo ciclo", backoff)
                    slept = 0.0
                    while slept < backoff and self.running:
                        time.sleep(0.1)
                        slept += 0.1
                    continue

                tempo_decorrido = time.time() - inicio
                if tempo_decorrido < self.config.intervalo_segundos:
                    sleep_time = self.config.intervalo_segundos - tempo_decorrido
                    for _ in range(int(sleep_time * 10)):
                        if not self.running:
                            break
                        time.sleep(0.1)

        except KeyboardInterrupt:
            self._svc_log.info("[AVISO] Interrupcao pelo usuario")
        except Exception as e:
            self._svc_log.error("[ERRO] Erro fatal no supervisor: %s", e)
            self._svc_log.error(traceback.format_exc())
            raise
        finally:
            self.running = False
            if hasattr(self, "_watchdog_thread") and self._watchdog_thread.is_alive():
                self._watchdog_thread.join(timeout=2.0)
            if hasattr(self, "_bg_thread") and self._bg_thread.is_alive():
                self._svc_log.info("Aguardando finalizacao do thread de segundo plano...")
                self._bg_thread.join(timeout=5.0)
            self.conn_mgr.close_all()
            try:
                self._hb.mark_progress("stopped")
                self._hb.write()
            except Exception:
                pass
            self._svc_log.info("[FIM] Conexoes fechadas")


# ===========================================================================
# MAIN
# ===========================================================================

_ACTIVE_SYNC: Optional[ResilientSynchronizer] = None
_MUTEX: Optional[InstanceMutex] = None
_SHUTDOWN_TIMER: Optional[threading.Timer] = None
_SHUTDOWN_LOCK = threading.Lock()
_CONSOLE_HANDLER = None
# CTRL_C, CTRL_BREAK, CTRL_CLOSE, CTRL_SHUTDOWN. CTRL_LOGOFF (5) fica de fora:
# servicos o recebem sempre que um usuario sai da sessao.
_CONSOLE_STOP_EVENTS = (0, 1, 2, 6)


def _force_exit_after_deadline() -> None:
    try:
        sys.stderr.write(
            f"[SHUTDOWN] encerramento excedeu {SYNC_SHUTDOWN_DEADLINE_SECONDS:.0f}s - os._exit(0)\n"
        )
        sys.stderr.flush()
    except Exception:
        pass
    os._exit(0)


def arm_shutdown_deadline(seconds: float = SYNC_SHUTDOWN_DEADLINE_SECONDS) -> bool:
    """Garante o fim do processo em `seconds` apos o pedido de parada (idempotente)."""
    global _SHUTDOWN_TIMER
    if seconds <= 0:
        return False
    with _SHUTDOWN_LOCK:
        if _SHUTDOWN_TIMER is not None:
            return False
        timer = threading.Timer(seconds, _force_exit_after_deadline)
        timer.daemon = True
        timer.start()
        _SHUTDOWN_TIMER = timer
    return True


def _install_console_deadline_handler() -> None:
    """
    O handler Python de SIGINT so roda quando a thread principal volta ao
    interpretador; presa em ODBC, nunca armaria o prazo. O handler de console
    do Windows roda em thread propria e devolve False para o Python seguir.
    """
    global _CONSOLE_HANDLER
    if sys.platform != "win32" or _CONSOLE_HANDLER is not None:
        return
    try:
        from ctypes import wintypes

        handler_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)

        def _on_console_event(event: int) -> bool:
            if event in _CONSOLE_STOP_EVENTS:
                arm_shutdown_deadline()
            return False

        handler = handler_type(_on_console_event)
        if ctypes.windll.kernel32.SetConsoleCtrlHandler(handler, True):
            _CONSOLE_HANDLER = handler
    except Exception:
        pass


def _handle_stop(signum, _frame):
    arm_shutdown_deadline()
    log = logging.getLogger("sync_andamentos_service")
    log.info("[SINAL] Recebido sinal %s - solicitando parada", signum)
    global _ACTIVE_SYNC
    if _ACTIVE_SYNC is not None:
        _ACTIVE_SYNC.stop()


def _install_signal_handlers() -> None:
    _install_console_deadline_handler()
    for sig_name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        sig = getattr(signal, sig_name, None)
        if sig is None:
            continue
        try:
            signal.signal(sig, _handle_stop)
        except Exception:
            pass


def main() -> int:
    log_dir = resolve_log_dir()
    log = setup_logging(log_dir)
    heartbeat = HeartbeatWriter(os.path.join(log_dir, "sync_heartbeat.json"))

    print("=" * 70)
    print(" SAGRA Sync Andamentos Service (resiliente 24/7)")
    print(" Logica: sync_andamentos_v2_Old.py | Runner: sync_andamentos_service.py")
    print("=" * 70)
    log.info("Log dir: %s", log_dir)

    global _MUTEX, _ACTIVE_SYNC
    try:
        _preflight_imports(log)
    except Exception as e:
        log.error("[PREFLIGHT] %s", e)
        print(f"[ERRO][PREFLIGHT] {e}")
        return 1

    _MUTEX = InstanceMutex()
    if not _MUTEX.acquire_with_retry(timeout_sec=45.0, interval_sec=1.5, log=log):
        msg = (
            f"Outra instancia ja esta em execucao (mutex {SYNC_MUTEX_NAME}) "
            "apos 45s. Feche janelas manuais/_iniciar-sync ou: "
            "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
            "Where-Object CommandLine -match sync_andamentos_service"
        )
        log.error(msg)
        print(f"[ERRO] {msg}")
        return 2

    _install_signal_handlers()

    try:
        config = core.Config.load()
        sync = ResilientSynchronizer(config, heartbeat, log)
        _ACTIVE_SYNC = sync
        sync.run_continuous()
        return 0
    except KeyboardInterrupt:
        print("\n[AVISO] Interrupcao pelo usuario")
        return 0
    except Exception:
        traceback.print_exc()
        log.error(traceback.format_exc())
        return 1
    finally:
        _ACTIVE_SYNC = None
        if _MUTEX is not None:
            _MUTEX.release()


if __name__ == "__main__":
    sys.exit(main())
