"""
SAGRA - Sync Andamentos Service (runner resiliente 24/7)
=======================================================
Herda a lógica de sincronia de sync_andamentos_v2_Old.py SEM alterá-la.

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
import importlib.util
import json
import logging
import os
import signal
import sys
import threading
import time
import traceback
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, List, Optional, Set

# ---------------------------------------------------------------------------
# Bootstrap de path (mesmo padrão de sync_andamentos_v2.py)
# ---------------------------------------------------------------------------
_ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)
_BACKEND_DIR = os.path.join(_ROOT_DIR, "app", "backend")
if os.path.isdir(_BACKEND_DIR) and _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
_SERVICES_DIR = os.path.join(_ROOT_DIR, "app", "services")
if os.path.isdir(_SERVICES_DIR) and _SERVICES_DIR not in sys.path:
    sys.path.insert(0, _SERVICES_DIR)

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
# Mantido por compatibilidade; o notify sempre usa base interna (uvicorn).
SYNC_NOTIFY_INTERNAL_BASE = _env_bool("SYNC_NOTIFY_INTERNAL_BASE", True)
SYNC_NOTIFY_FAIL_LOG_INTERVAL = _env_float("SYNC_NOTIFY_FAIL_LOG_INTERVAL", 60.0)
# tabAndamento bidirecional (INSERT/UPDATE MySQL↔MDB). Protocolos/Detalhes seguem só MDB→MySQL.
SYNC_TABANDAMENTO_BIDI = _env_bool("SYNC_TABANDAMENTO_BIDI", True)
# Alias legado do plano de catch-up (se False, desliga o sentido MySQL→MDB).
SYNC_MYSQL_TO_MDB_CATCHUP = _env_bool("SYNC_MYSQL_TO_MDB_CATCHUP", True)
SYNC_MUTEX_NAME = os.getenv("SYNC_MUTEX_NAME", r"Global\SagraSyncAndamentos")
SYNC_LOG_DIR = os.getenv("SYNC_LOG_DIR", "").strip()
SYNC_LOG_MAX_BYTES = _env_int("SYNC_LOG_MAX_BYTES", 10 * 1024 * 1024)
SYNC_LOG_BACKUP_COUNT = _env_int("SYNC_LOG_BACKUP_COUNT", 5)

# Sentinel para distinguir "MySQL retornou lista vazia" de "falha de leitura"
_MYSQL_READ_FAILED = object()


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

    def release(self) -> None:
        if self._handle is None:
            return
        try:
            ctypes.windll.kernel32.CloseHandle(self._handle)
        except Exception:
            pass
        self._handle = None


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
        self.stats: Dict[str, Any] = {
            "ins_m2y": 0,
            "upd_m2y": 0,
            "ins_y2m": 0,
            "upd_y2m": 0,
            "del_y": 0,
            "ultimo_heals": 0,
            "safety_lock_aborts": 0,
            "mysql_only_remaining": 0,
        }

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
            self.last_progress_mono = time.monotonic()

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
        self._cycle_stats = {
            "ins_m2y": 0,
            "upd_m2y": 0,
            "ins_y2m": 0,
            "upd_y2m": 0,
            "del_y": 0,
            "ultimo_heals": 0,
            "safety_lock_aborts": 0,
            "mysql_only_remaining": 0,
        }

        # Sempre patch: Old usa get_api_base() relativo (/sagra/api) que quebra requests.
        self._install_reliable_notify()

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
        try:
            conn = self.conn_mgr.get_mysql()
            cur = conn.cursor(dictionary=True)
            data_limite = self.get_data_limite()
            cur.execute(
                """
                SELECT NroProtocoloLink AS nro, AnoProtocoloLink AS ano,
                       SUM(UltimoStatus = 1) AS flags
                FROM tabandamento
                WHERE Data >= %s AND AnoProtocoloLink >= 2024
                GROUP BY NroProtocoloLink, AnoProtocoloLink
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

        heals = 0
        for row in rows:
            nro = row.get("nro") if isinstance(row, dict) else row[0]
            ano = row.get("ano") if isinstance(row, dict) else row[1]
            if nro is None or ano is None:
                continue
            self.ensure_mysql_ultimo_status_from_mdb(int(nro), int(ano))
            heals += 1
            self._cycle_stats["ultimo_heals"] = (
                self._cycle_stats.get("ultimo_heals", 0) + 1
            )
        return heals

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

    def _mysql_wins_lww(self, mysql_rec, mdb_rec) -> bool:
        d_mysql = self._parse_andamento_data(mysql_rec.get("Data"))
        d_mdb = self._parse_andamento_data(mdb_rec.get("Data"))
        return d_mysql >= d_mdb

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

    def detect_and_register_deletions(self, mysql_codes, mdb_all_codes):
        excluidos_confirmados = set()
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
                    code, nro, ano, origem, motivo="Exclusao confirmada no MDB"
                )
                self.logger.logger.info(
                    f"[DETECCAO] CodStatus {code} excluido do MDB {origem} (Verificado)."
                )
            return excluidos_confirmados
        except Exception as e:
            self.logger.logger.error(f"[ERRO] Erro ao detectar exclusoes: {e}")
            return set()

    # ------------------------------------------------------------------
    # perform_sync: tabAndamento bidirecional + heartbeat
    # ------------------------------------------------------------------

    def perform_sync(self):
        self._hb.mark_progress("perform_sync")
        self._cycle_stats = {
            "ins_m2y": 0,
            "upd_m2y": 0,
            "ins_y2m": 0,
            "upd_y2m": 0,
            "del_y": 0,
            "ultimo_heals": 0,
            "safety_lock_aborts": 0,
            "mysql_only_remaining": 0,
        }
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
                return

            self._hb.mark_progress("read_mdb_pap")
            mdb_pap_data = self.read_mdb(self.conn_mgr.get_mdb_pap())
            if mdb_pap_data is None:
                self.logger.logger.error(
                    "[ABORT] Falha na leitura do MDB Papelaria. Ciclo de sincronizacao abortado."
                )
                self._hb.mark_cycle_error("mdb_pap_read_failed")
                return

            mysql_codes = {a["CodStatus"] for a in mysql_data}
            mdb_os_codes = {a["CodStatus"] for a in mdb_os_data}
            mdb_pap_codes = {a["CodStatus"] for a in mdb_pap_data}
            mdb_all_codes = mdb_os_codes | mdb_pap_codes

            self._hb.mark_progress("detect_deletions")
            excluidos = self.detect_and_register_deletions(mysql_codes, mdb_all_codes)

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
                    continue

                nro = mysql_rec["NroProtocoloLink"]
                ano = mysql_rec["AnoProtocoloLink"]
                touched_os.add((nro, ano))

                if bidi and self._mysql_wins_lww(mysql_rec, mdb_rec):
                    mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
                    destino = self.conn_mgr.get_mdb_name_by_nro(nro)
                    self.update_mdb(mysql_rec, mdb_conn, destino)
                    self._cycle_stats["upd_y2m"] += 1
                    self._svc_log.info(
                        "[BI] UPDATE MySQL->MDB CodStatus=%s OS=%s/%s", code, nro, ano
                    )
                else:
                    self.sync_os_data_from_mdb(nro, ano, origem)
                    self.update_mysql(mdb_rec, origem)
                    self._cycle_stats["upd_m2y"] += 1

                self.ensure_mysql_ultimo_status_from_mdb(nro, ano)

            if bidi:
                self._hb.mark_progress("inserts_y2m")
                novos_no_mysql = mysql_codes - mdb_all_codes
                for code in novos_no_mysql:
                    and_ = next((a for a in mysql_data if a["CodStatus"] == code), None)
                    if not and_:
                        continue
                    nro = and_["NroProtocoloLink"]
                    ano = and_["AnoProtocoloLink"]
                    try:
                        mdb_conn = self.conn_mgr.get_mdb_by_nro(nro)
                        destino = self.conn_mgr.get_mdb_name_by_nro(nro)
                        self.insert_mdb(and_, mdb_conn, destino)
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

            self._hb.mark_progress("deletes")
            if excluidos:
                for code in excluidos:
                    and_ = next((a for a in mysql_data if a["CodStatus"] == code), None)
                    if and_:
                        self.delete_mysql(code, and_)
                        self._cycle_stats["del_y"] += 1
                        touched_os.add(
                            (and_["NroProtocoloLink"], and_["AnoProtocoloLink"])
                        )
                        self.ensure_mysql_ultimo_status_from_mdb(
                            and_["NroProtocoloLink"], and_["AnoProtocoloLink"]
                        )

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

    # ------------------------------------------------------------------
    # Watchdog
    # ------------------------------------------------------------------
    # Watchdog
    # ------------------------------------------------------------------

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
                if phase == "mdb_unavailable":
                    continue
                if stall >= SYNC_STALL_TIMEOUT:
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
            "[INFO] tabAndamento bi=%s | Protocolos/Detalhes so MDB->MySQL",
            SYNC_TABANDAMENTO_BIDI and SYNC_MYSQL_TO_MDB_CATCHUP,
        )
        self._svc_log.info(
            "[INFO] Monitorando ultimos %s dias | intervalo=%ss | stall=%ss",
            self.config.dias_monitoramento,
            self.config.intervalo_segundos,
            SYNC_STALL_TIMEOUT,
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
                except Exception as e:
                    self._svc_log.error("[ERRO] Excecao no supervisor: %s", e)
                    self._svc_log.error(traceback.format_exc())
                    self._hb.mark_cycle_error(str(e))
                    self.conn_mgr.invalidate_all()
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


def _handle_stop(signum, _frame):
    log = logging.getLogger("sync_andamentos_service")
    log.info("[SINAL] Recebido sinal %s - solicitando parada", signum)
    global _ACTIVE_SYNC
    if _ACTIVE_SYNC is not None:
        _ACTIVE_SYNC.stop()


def _install_signal_handlers() -> None:
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
    _MUTEX = InstanceMutex()
    if not _MUTEX.acquire():
        msg = (
            f"Outra instancia ja esta em execucao (mutex {SYNC_MUTEX_NAME}). Abortando."
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
