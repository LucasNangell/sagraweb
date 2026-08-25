"""
Replicação MySQL → MDB (Access).
Fluxo obrigatório:
  1. A rota grava no MySQL e faz commit da transação.
  2. Responde ao usuário e emite WebSocket (MySQL = fonte da verdade).
  3. Replica no MDB em background (retentativas sem bloquear a API).
PKs respeitadas:
  - tabProtocolos: (NroProtocolo, AnoProtocolo)
  - tabDetalhesServico: (NroProtocoloLinkDet, AnoProtocoloLinkDet)
  - tabAndamento: CodStatus (único)
Retry: bloqueios temporários do Access (arquivo em uso, lock, queda de rede) — aguarda e tenta de novo.
"""
from __future__ import annotations
import atexit
import logging
import threading
import time
from datetime import datetime
from queue import Empty, Full, Queue
from typing import Any, Callable, Dict, List, Optional, Tuple
import pyodbc
from config_manager import config_manager
from database import db
from mdb_helpers import (
    CALC_DETALHES_FIELDS,
    prepare_os_detalhes_params,
    prepare_os_protocol_params,
    to_mdb_bool,
    to_mdb_datetime,
    to_mdb_memo,
    to_mdb_null,
)

# ACE/Jet over UNC/DFS: pooling reuses a dead handle after -1022
# ("network access was interrupted"). Close must release the engine.
pyodbc.pooling = False
logger = logging.getLogger(__name__)

_MDB_SYNC_QUEUE: Queue[Tuple[str, Callable[[], None], dict[str, Any]]] = Queue(maxsize=256)
_MDB_SYNC_WORKER_LOCK = threading.Lock()
_MDB_SYNC_WORKER_STARTED = False
_MDB_SYNC_STOP_EVENT = threading.Event()


def _parse_dispatch_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on", "sim")


def _mdb_sync_worker() -> None:
    while True:
        if _MDB_SYNC_STOP_EVENT.is_set() and _MDB_SYNC_QUEUE.empty():
            return
        try:
            task_name, callback, context = _MDB_SYNC_QUEUE.get(timeout=0.5)
        except Empty:
            continue
        try:
            callback()
        except Exception as exc:
            handle_mdb_sync_failure(task_name, exc, **context)
        finally:
            _MDB_SYNC_QUEUE.task_done()


def _ensure_mdb_sync_worker() -> None:
    global _MDB_SYNC_WORKER_STARTED
    if _MDB_SYNC_WORKER_STARTED:
        return
    with _MDB_SYNC_WORKER_LOCK:
        if _MDB_SYNC_WORKER_STARTED:
            return
        worker = threading.Thread(
            target=_mdb_sync_worker,
            name="mdb-sync-worker",
            daemon=True,
        )
        worker.start()
        atexit.register(lambda: _MDB_SYNC_STOP_EVENT.set())
        _MDB_SYNC_WORKER_STARTED = True


def _run_mdb_sync_task(
    task_name: str,
    callback: Callable[[], None],
    context: dict[str, Any] | None = None,
) -> None:
    """Executa sync MDB; falha não propaga — alerta administrador."""
    ctx = context or {}
    try:
        callback()
    except Exception as exc:
        handle_mdb_sync_failure(task_name, exc, **ctx)


def _enqueue_mdb_sync_when_queue_full(
    task_name: str,
    callback: Callable[[], None],
    context: dict[str, Any],
) -> None:
    """
    Enfileira tarefa MDB sem bloquear a thread da requisição HTTP.
    Preserva ordem FIFO e o worker único (evita escrita concorrente no Access).
    """
    def _wait_and_enqueue() -> None:
        _ensure_mdb_sync_worker()
        try:
            _MDB_SYNC_QUEUE.put((task_name, callback, context))
        except Exception as exc:
            logger.error(
                "Falha ao enfileirar sync MDB overflow (%s): %s",
                task_name,
                exc,
            )
            _run_mdb_sync_task(task_name, callback, context)

    threading.Thread(
        target=_wait_and_enqueue,
        name=f"mdb-sync-enqueue-{task_name}",
        daemon=True,
    ).start()


def _mdb_sync_context(
    *,
    cod_status: str | None = None,
    nro: int | None = None,
    ano: int | None = None,
) -> dict[str, Any]:
    ctx: dict[str, Any] = {}
    if cod_status:
        ctx["cod_status"] = cod_status
    if nro is not None:
        ctx["nro"] = nro
    if ano is not None:
        ctx["ano"] = ano
    return ctx


def dispatch_mdb_sync(
    task_name: str,
    callback: Callable[[], None],
    *,
    cod_status: str | None = None,
    nro: int | None = None,
    ano: int | None = None,
) -> None:
    """
    Enfileira replicação MDB (padrão) ou executa síncrono se desabilitado.
    MySQL já commitado — não bloqueia resposta HTTP nem WebSocket.
    """
    if not config_manager.is_mdb_write_enabled():
        return

    context = _mdb_sync_context(cod_status=cod_status, nro=nro, ano=ano)
    use_async = _parse_dispatch_bool(
        config_manager.get("mdb_sync_async_enabled"), default=True
    )

    if not use_async:
        _run_mdb_sync_task(task_name, callback, context)
        return

    _ensure_mdb_sync_worker()
    try:
        _MDB_SYNC_QUEUE.put_nowait((task_name, callback, context))
    except Full:
        logger.warning(
            "Fila de sync MDB cheia (%s); enfileirando em background (sem bloquear API).",
            task_name,
        )
        _enqueue_mdb_sync_when_queue_full(task_name, callback, context)

# Colunas opcionais no INSERT de tabProtocolos (podem não existir em MDBs de teste/legado).
_PROTO_INSERT_OPTIONAL_NULL_COLS = (
    "RetiradaNome",
    "RetiradaPonto",
    "RecebimData",
    "PontoEntrega",
    "SetorEntrega",
    "CancelamentoMotivo",
    "CancelamentoSetor",
)

_PROTO_ANDAMENTO_EXTRA_COLS = (
    "DataConclusao",
    "ArmazenadoEm",
    "ContatoRecebim",
    "RetiradaNome",
    "RetiradaPonto",
    "RecebimData",
    "PontoEntrega",
    "SetorEntrega",
    "CancelamentoMotivo",
    "CancelamentoPonto",
    "CancelamentoSetor",
)

_PROTO_REQUISICAO_EXTRA_COLS = (
    "ReqEntregue",
)

# Nome lógico MySQL → possíveis nomes físicos no Access (1ª existente vence).
# RetiradaPonto: auditado em MySQL/MDB; Funcionário/Funcionario = rótulo/legado.
_MDB_COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "RetiradaPonto": ("RetiradaPonto", "Funcionário", "Funcionario"),
    "RecebimData": ("RecebimData", "DataRecebimento"),
    "DataRecebimento": ("RecebimData", "DataRecebimento"),
}

_MDB_TABLE_COLUMNS_CACHE: dict[tuple[str, str], frozenset[str]] = {}

# Erros típicos do Access quando o .mdb está aberto ou bloqueado por outro processo
_RETRIABLE_MARKERS = (
    "locked",
    "lock violation",
    "could not lock",
    "already opened",
    "already open",
    "exclusively",
    "in use",
    "busy",
    "temporarily",
    "too many client",
    "deadlock",
    "network error",
    "network access was interrupted",
    "disk or network",
    "retry",
    "-1022",
    "-1032",
    "-1102",
    "hy000",
    "3010",
    "3045",
    "3354",
    "3197",
    "operationalerror",
)
class MdbWriteDisabledError(Exception):
    """Dual-write MDB desligado (MYSQL_ONLY=true)."""

    def __init__(self, operation: str, cod_status: str, nro: int, ano: int):
        self.operation = operation
        self.cod_status = cod_status
        self.nro = nro
        self.ano = ano
        super().__init__(
            f"Gravação MDB desabilitada (MYSQL_ONLY). "
            f"op={operation} codstatus={cod_status} os={nro}/{ano}"
        )


class MdbSyncError(Exception):
    """Falha ao replicar no MDB após esgotar tentativas (MySQL já foi gravado)."""
    def __init__(
        self,
        stage: str,
        nro: int,
        mdb_path: str,
        cause: Exception,
        *,
        attempts: int,
        cod_status: str | None = None,
        ano: int | None = None,
    ):
        self.stage = stage
        self.nro = nro
        self.ano = ano
        self.mdb_path = mdb_path
        self.cause = cause
        self.attempts = attempts
        self.cod_status = cod_status or (
            stage[len("andamento_") :]
            if stage.startswith("andamento_")
            else None
        )
        super().__init__(
            f"MDB sync '{stage}' falhou após {attempts} tentativa(s) "
            f"(OS nro={nro}, arquivo={mdb_path}): {cause}"
        )
def get_mdb_path(nro: int) -> str:
    """Roteia para OS Atual (<5000) ou Papelaria Atual (>=5000)."""
    return config_manager.get_mdb_path_by_nro(nro)


def mdb_dest_label(nro: int) -> str:
    """Rótulo legível do destino MDB conforme NroProtocolo."""
    try:
        return "Papelaria" if int(nro) >= 5000 else "OS_Atual"
    except (TypeError, ValueError):
        return "OS_Atual"


def _ensure_mdb_write_enabled(operation: str, cod_status: str, nro: int, ano: int) -> None:
    if config_manager.is_mdb_write_enabled():
        return
    logger.error(
        "[MDB WRITE] ERROR %s andamento codstatus=%s os=%s/%s destino=%s erro=MYSQL_ONLY ativo",
        operation,
        cod_status,
        nro,
        ano,
        mdb_dest_label(nro),
    )
    raise MdbWriteDisabledError(operation, cod_status, nro, ano)


def _log_mdb_write_start(operation: str, cod_status: str, nro: int, ano: int) -> str:
    path = get_mdb_path(nro)
    logger.info(
        "[MDB WRITE] START %s andamento codstatus=%s os=%s/%s destino=%s path=%s",
        operation,
        cod_status,
        nro,
        ano,
        mdb_dest_label(nro),
        path,
    )
    return path


def _log_mdb_write_ok(operation: str, cod_status: str, nro: int, ano: int) -> None:
    logger.info(
        "[MDB WRITE] OK %s andamento codstatus=%s os=%s/%s destino=%s",
        operation,
        cod_status,
        nro,
        ano,
        mdb_dest_label(nro),
    )


def _log_mdb_write_error(operation: str, cod_status: str, nro: int, ano: int, exc: BaseException) -> None:
    path = get_mdb_path(nro)
    logger.error(
        "[MDB WRITE] ERROR %s andamento codstatus=%s os=%s/%s destino=%s path=%s erro=%s",
        operation,
        cod_status,
        nro,
        ano,
        mdb_dest_label(nro),
        path,
        exc,
        exc_info=True,
    )
def _retry_settings() -> tuple[int, float, int, float]:
    """Retorna (max_attempts, base_wait, rounds, second_round_wait)."""
    try:
        max_attempts = int(config_manager.get("mdb_retry_max_attempts") or 5)
    except (TypeError, ValueError):
        max_attempts = 5
    try:
        base_wait = float(config_manager.get("mdb_retry_base_wait_seconds") or 15)
    except (TypeError, ValueError):
        base_wait = 15.0
    try:
        rounds = int(config_manager.get("mdb_retry_rounds") or 2)
    except (TypeError, ValueError):
        rounds = 2
    try:
        second_round_wait = float(
            config_manager.get("mdb_retry_second_round_wait_seconds") or 120
        )
    except (TypeError, ValueError):
        second_round_wait = 120.0
    return (
        max(1, max_attempts),
        max(0.5, base_wait),
        max(1, rounds),
        max(0.0, second_round_wait),
    )


def is_retriable_mdb_error(exc: BaseException) -> bool:
    """Indica se vale a pena aguardar e tentar de novo (lock / arquivo ocupado)."""
    if isinstance(exc, pyodbc.Error):
        codes = []
        if hasattr(exc, "args") and exc.args:
            codes.append(str(exc.args[0]).lower())
        for part in exc.args[1:] if len(exc.args) > 1 else []:
            codes.append(str(part).lower())
        text = " ".join(codes)
    else:
        text = str(exc).lower()
    return any(marker in text for marker in _RETRIABLE_MARKERS)


def _mdb_path_for_connection(nro: int) -> tuple[str, str]:
    """Retorna (caminho configurado, caminho resolvido para ODBC)."""
    configured = get_mdb_path(nro)
    resolved = config_manager.resolve_mdb_path(configured)
    return configured, resolved


_MDB_CONNECT_TIMEOUT = 30


def _mdb_connect(conn_str: str) -> pyodbc.Connection:
    """Abre ODBC Access com timeout; pooling desligado no import deste módulo."""
    return pyodbc.connect(conn_str, timeout=_MDB_CONNECT_TIMEOUT)


def _execute_mdb_transaction(
    nro: int,
    stage: str,
    callback: Callable[[pyodbc.Connection, pyodbc.Cursor], None],
) -> None:
    """
    Abre conexão, executa callback(conn, cursor), commit.
    Em erro recuperável: rollback, fecha, espera (intervalo fixo) e tenta de novo.
    Após esgotar uma rodada de tentativas, aguarda second_round_wait e repete
    (até mdb_retry_rounds). Só então propaga MdbSyncError (alerta admin).
    """
    configured_path, path = _mdb_path_for_connection(nro)
    max_attempts, base_wait, rounds, second_round_wait = _retry_settings()
    last_err: Optional[Exception] = None
    total_attempts = 0

    for round_no in range(1, rounds + 1):
        for attempt in range(1, max_attempts + 1):
            total_attempts += 1
            conn: Optional[pyodbc.Connection] = None
            try:
                conn_str = config_manager.get_mdb_connection_string(path)
                conn = _mdb_connect(conn_str)
                cursor = conn.cursor()
                callback(conn, cursor)
                conn.commit()
                if total_attempts > 1:
                    logger.info(
                        "MDB '%s' OK na tentativa %s (rodada %s/%s, %s/%s nesta rodada) (%s)",
                        stage,
                        total_attempts,
                        round_no,
                        rounds,
                        attempt,
                        max_attempts,
                        path,
                    )
                return
            except Exception as e:
                last_err = e
                if conn:
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                retriable = is_retriable_mdb_error(e)
                last_in_round = attempt >= max_attempts
                last_round = round_no >= rounds

                if not retriable:
                    logger.error(
                        "MDB '%s' falhou (tentativa %s, rodada %s/%s, retentável=False): %s",
                        stage,
                        total_attempts,
                        round_no,
                        rounds,
                        e,
                    )
                    raise MdbSyncError(
                        stage,
                        nro,
                        configured_path or path,
                        e,
                        attempts=total_attempts,
                    ) from e

                if last_in_round and last_round:
                    logger.error(
                        "MDB '%s' falhou após %s tentativa(s) em %s rodada(s): %s",
                        stage,
                        total_attempts,
                        rounds,
                        e,
                    )
                    raise MdbSyncError(
                        stage,
                        nro,
                        configured_path or path,
                        e,
                        attempts=total_attempts,
                    ) from e

                if last_in_round:
                    logger.warning(
                        "MDB '%s' bloqueado/ocupado — rodada %s/%s esgotada; "
                        "nova rodada em %.1fs: %s",
                        stage,
                        round_no,
                        rounds,
                        second_round_wait,
                        e,
                    )
                    if second_round_wait > 0:
                        time.sleep(second_round_wait)
                else:
                    logger.warning(
                        "MDB '%s' bloqueado/ocupado — rodada %s/%s tentativa %s/%s, "
                        "nova tentativa em %.1fs: %s",
                        stage,
                        round_no,
                        rounds,
                        attempt,
                        max_attempts,
                        base_wait,
                        e,
                    )
                    time.sleep(base_wait)
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass

    if last_err:
        raise MdbSyncError(
            stage,
            nro,
            configured_path or path,
            last_err,
            attempts=total_attempts,
        ) from last_err
def get_connection(nro: int) -> pyodbc.Connection:
    """Conexão direta (preferir _execute_mdb_transaction para escrita)."""
    _configured, path = _mdb_path_for_connection(nro)
    try:
        conn_str = config_manager.get_mdb_connection_string(path)
        return _mdb_connect(conn_str)
    except Exception as e:
        logger.error("Erro conectando ao MDB %s: %s", path, e)
        raise
def _mdb_table_columns(cursor, table: str, mdb_path: str) -> frozenset[str]:
    """Colunas disponíveis no .mdb (cache por arquivo + tabela)."""
    key = (mdb_path, table)
    cached = _MDB_TABLE_COLUMNS_CACHE.get(key)
    if cached is not None:
        return cached
    cursor.execute(f"SELECT * FROM [{table}] WHERE 1=0")
    cols = frozenset(d[0] for d in cursor.description if d[0])
    _MDB_TABLE_COLUMNS_CACHE[key] = cols
    return cols


def _mdb_avail_by_lower(avail: frozenset[str] | set[str]) -> dict[str, str]:
    """Mapa casefold → nome físico exatamente como o ODBC reportou."""
    return {str(name).casefold(): str(name) for name in avail if name}


def _resolve_mdb_column(avail: frozenset[str] | set[str], logical_name: str) -> str | None:
    """Resolve coluna MDB por nome lógico + aliases (case-insensitive)."""
    by_lower = _mdb_avail_by_lower(avail)
    candidates = _MDB_COLUMN_ALIASES.get(logical_name, (logical_name,))
    for candidate in candidates:
        hit = by_lower.get(str(candidate).casefold())
        if hit:
            return hit
    return None


def _map_protocolo_cols_for_mdb(
    avail: frozenset[str] | set[str],
    logical_cols: tuple[str, ...],
    proto_row: Dict[str, Any] | None,
    *,
    null_values: bool = False,
) -> dict[str, Any]:
    """
    Monta {coluna_fisica_mdb: valor} a partir de nomes lógicos MySQL.
    Evita gravar a mesma coluna física duas vezes quando há aliases.
    """
    from mdb_helpers import to_mdb_field

    mapped: dict[str, Any] = {}
    for logical in logical_cols:
        mdb_col = _resolve_mdb_column(avail, logical)
        if not mdb_col or mdb_col in mapped:
            continue
        if null_values or proto_row is None:
            mapped[mdb_col] = None
        else:
            mapped[mdb_col] = to_mdb_field(logical, proto_row.get(logical))
    return mapped


def _mdb_has_table(cursor, table: str, mdb_path: str) -> bool:
    try:
        _mdb_table_columns(cursor, table, mdb_path)
        return True
    except Exception:
        return False


def _ensure_lookup_value(
    cursor,
    table: str,
    column: str,
    value: Any,
    *,
    mdb_path: str,
) -> None:
    value = to_mdb_null(value)
    if not value:
        return
    if not _mdb_has_table(cursor, table, mdb_path):
        return
    try:
        cursor.execute(f"SELECT COUNT(*) FROM [{table}] WHERE [{column}] = ?", (value,))
        if cursor.fetchone()[0] == 0:
            logger.info("Lookup: inserindo '%s' em %s.%s", value, table, column)
            cursor.execute(f"INSERT INTO [{table}] ([{column}]) VALUES (?)", (value,))
    except Exception as e_lookup:
        logger.warning("Erro ao verificar/inserir lookup %s.%s: %s", table, column, e_lookup)
def _ensure_os_lookups(
    cursor,
    proto: Dict[str, Any],
    det: Dict[str, Any],
    *,
    mdb_path: str,
) -> None:
    _ensure_lookup_value(
        cursor, "tabcategorias", "Categoria", proto.get("CategoriaLink"), mdb_path=mdb_path
    )
    _ensure_lookup_value(cursor, "tabPapel", "Papel", det.get("PapelLink"), mdb_path=mdb_path)
    _ensure_lookup_value(
        cursor, "tabProdutos", "Produto", det.get("TipoPublicacaoLink"), mdb_path=mdb_path
    )
    _ensure_lookup_value(cursor, "tabCores", "Cor", det.get("Cores"), mdb_path=mdb_path)
def _protocolo_exists(cursor, nro: int, ano: int) -> bool:
    cursor.execute(
        "SELECT COUNT(*) FROM tabProtocolos WHERE NroProtocolo = ? AND AnoProtocolo = ?",
        (nro, ano),
    )
    return cursor.fetchone()[0] > 0
def _detalhes_exists(cursor, nro: int, ano: int) -> bool:
    cursor.execute(
        "SELECT COUNT(*) FROM tabDetalhesServico WHERE NroProtocoloLinkDet = ? AND AnoProtocoloLinkDet = ?",
        (nro, ano),
    )
    return cursor.fetchone()[0] > 0
def _andamento_exists(cursor, cod_status: str) -> bool:
    cursor.execute("SELECT COUNT(*) FROM tabAndamento WHERE CodStatus = ?", (cod_status,))
    return cursor.fetchone()[0] > 0
def _write_protocolo(
    cursor,
    nro: int,
    ano: int,
    proto: Dict[str, Any],
    *,
    mdb_path: str,
) -> None:
    avail = _mdb_table_columns(cursor, "tabProtocolos", mdb_path)
    proto_fields = (
        "CodigoRequisic", "CategoriaLink", "NomeUsuario",
        "Titular", "OrgInteressado", "SiglaOrgao",
        "GabSalaUsuario", "Andar", "Localizacao", "RamalUsuario",
        "DataEntrada", "ProcessoSolicit", "CSnro",
        "EntregPrazoLink", "EntregData", "ContatoTrab",
    )
    from os_calc_fields import cota_protocolo_column

    cota_col = cota_protocolo_column(nro)
    if cota_col in avail:
        proto_fields = (*proto_fields, cota_col)
    params = tuple(proto.get(f) for f in proto_fields)
    if _protocolo_exists(cursor, nro, ano):
        set_sql = ", ".join(f"{col}=?" for col in proto_fields)
        cursor.execute(
            f"UPDATE tabProtocolos SET {set_sql} WHERE NroProtocolo=? AND AnoProtocolo=?",
            params + (nro, ano),
        )
    else:
        base_cols = [
            "NroProtocolo",
            "AnoProtocolo",
            "CodigoRequisic",
            "CategoriaLink",
            "NomeUsuario",
            "Titular",
            "OrgInteressado",
            "SiglaOrgao",
            "GabSalaUsuario",
            "Andar",
            "Localizacao",
            "RamalUsuario",
            "DataEntrada",
            "ProcessoSolicit",
            "CSnro",
            "EntregPrazoLink",
            "EntregData",
            "ContatoTrab",
        ]
        if cota_col in avail:
            base_cols.append(cota_col)
        optional_mapped = _map_protocolo_cols_for_mdb(
            avail,
            _PROTO_INSERT_OPTIONAL_NULL_COLS,
            None,
            null_values=True,
        )
        optional_cols = list(optional_mapped.keys())
        insert_cols = base_cols + optional_cols
        placeholders = ", ".join("?" * len(insert_cols))
        col_sql = ", ".join(insert_cols)
        insert_values: list[Any] = [nro, ano]
        for col in proto_fields:
            if col in insert_cols:
                insert_values.append(proto.get(col))
        for col in optional_cols:
            insert_values.append(None)
        values = tuple(insert_values)
        cursor.execute(
            f"INSERT INTO tabProtocolos ({col_sql}) VALUES ({placeholders})",
            values,
        )
_DETALHES_WRITE_FIELDS = (
    "Titulo",
    "TipoPublicacaoLink",
    "FormatoLink",
    "MaquinaLink",
    "Tiragem",
    "Pags",
    "FrenteVerso",
    "ModelosArq",
    "PapelLink",
    "PapelDescricao",
    "Cores",
    "CoresDescricao",
    "DescAcabamento",
    "Observ",
    "TiragemSolicitada",
    "CotaTotal",
    "MaterialFornecido",
    "Fotolito",
    "ModeloDobra",
    "ProvaImpressa",
    "InsumosFornecidos",
    "ElemGrafBrasao",
    "ElemGrafTimbre",
    "ElemGrafArteGab",
    "ElemGrafAssinatura",
    *CALC_DETALHES_FIELDS,
)


def _write_detalhes(
    cursor,
    nro: int,
    ano: int,
    det: Dict[str, Any],
    *,
    mdb_path: str,
) -> None:
    avail = _mdb_table_columns(cursor, "tabDetalhesServico", mdb_path)
    fields = [f for f in _DETALHES_WRITE_FIELDS if f in avail]
    values = [det.get(f) for f in fields]

    if _detalhes_exists(cursor, nro, ano):
        set_sql = ", ".join(f"{col}=?" for col in fields)
        cursor.execute(
            f"UPDATE tabDetalhesServico SET {set_sql} "
            "WHERE NroProtocoloLinkDet=? AND AnoProtocoloLinkDet=?",
            tuple(values) + (nro, ano),
        )
    else:
        cols = ["NroProtocoloLinkDet", "AnoProtocoloLinkDet", *fields]
        placeholders = ", ".join("?" * len(cols))
        col_sql = ", ".join(cols)
        cursor.execute(
            f"INSERT INTO tabDetalhesServico ({col_sql}) VALUES ({placeholders})",
            (nro, ano) + tuple(values),
        )
def _upsert_andamento_row(cursor, row: Dict[str, Any], nro_fk: int, ano_fk: int) -> None:
    cod_status = row["CodStatus"]
    ultimo = to_mdb_bool(row.get("UltimoStatus"))
    if ultimo:
        cursor.execute(
            """
            UPDATE tabAndamento SET UltimoStatus = ?
            WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
            """,
            (to_mdb_bool(False), nro_fk, ano_fk),
        )
    params = (
        to_mdb_null(row.get("SituacaoLink")),
        to_mdb_null(row.get("SetorLink")),
        to_mdb_datetime(row.get("Data")) or datetime.now(),
        ultimo,
        to_mdb_memo(row.get("Observaçao")) or "",
        to_mdb_null(row.get("Ponto")) or "",
        cod_status,
        nro_fk,
        ano_fk,
    )
    if _andamento_exists(cursor, cod_status):
        cursor.execute(
            """
            UPDATE tabAndamento
            SET SituacaoLink = ?, SetorLink = ?, Data = ?, UltimoStatus = ?,
                Observaçao = ?, Ponto = ?
            WHERE CodStatus = ? AND NroProtocoloLink = ? AND AnoProtocoloLink = ?
            """,
            params,
        )
    else:
        cursor.execute(
            """
            INSERT INTO tabAndamento
            (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink,
             Data, UltimoStatus, Observaçao, Ponto)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cod_status, nro_fk, ano_fk,
                params[0], params[1], params[2], params[3], params[4], params[5],
            ),
        )
def _ensure_protocolo_in_mdb(cursor, nro: int, ano: int) -> tuple[int, int]:
    cursor.execute(
        "SELECT NroProtocolo, AnoProtocolo FROM tabProtocolos WHERE NroProtocolo = ? AND AnoProtocolo = ?",
        (nro, ano),
    )
    protocolo = cursor.fetchone()
    if not protocolo:
        raise ValueError(
            f"Protocolo {nro}/{ano} ausente em tabProtocolos do MDB {get_mdb_path(nro)}"
        )
    return protocolo.NroProtocolo, protocolo.AnoProtocolo


def _cod_status_seq_key(cod: object) -> tuple:
    """Chave de desempate alinhada ao MySQL (sufixo numérico, depois string)."""
    text = str(cod or "")
    try:
        seq = int(text.rsplit("-", 1)[-1])
    except ValueError:
        seq = -1
    return (seq, text)


def _fix_ultimo_status_mdb(
    cursor,
    nro: int,
    ano: int,
    *,
    promoted_cod: Optional[str] = None,
) -> Optional[str]:
    """
    Alinha UltimoStatus no MDB com o canônico do MySQL.
    Prefere `promoted_cod` / UltimoStatus=1 do MySQL; fallback: maior CodStatus
    (sufixo numérico) no Access, excluindo espelhos Sub OS.
    """
    from services.andamento_operacional import (
        get_mirror_cod_statuses_for_os,
        get_ultimo_operacional_cod_mysql,
    )

    target = (promoted_cod or "").strip() or None
    if not target:
        target = get_ultimo_operacional_cod_mysql(nro, ano)

    mirror_cods = set(get_mirror_cod_statuses_for_os(nro, ano))

    cursor.execute(
        """
        UPDATE tabAndamento SET UltimoStatus = ?
        WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
        """,
        (to_mdb_bool(False), nro, ano),
    )

    if target:
        cursor.execute(
            """
            SELECT COUNT(*) FROM tabAndamento
            WHERE CodStatus = ? AND NroProtocoloLink = ? AND AnoProtocoloLink = ?
            """,
            (target, nro, ano),
        )
        count_row = cursor.fetchone()
        exists = int(count_row[0] if count_row is not None else 0) > 0
        if exists and target not in mirror_cods:
            cursor.execute(
                "UPDATE tabAndamento SET UltimoStatus = ? WHERE CodStatus = ?",
                (to_mdb_bool(True), target),
            )
            return target

    cursor.execute(
        """
        SELECT CodStatus, Data FROM tabAndamento
        WHERE NroProtocoloLink = ? AND AnoProtocoloLink = ?
        """,
        (nro, ano),
    )
    candidates = []
    for row in cursor.fetchall() or []:
        cod = getattr(row, "CodStatus", None)
        if not cod or str(cod).strip() in mirror_cods:
            continue
        data = getattr(row, "Data", None)
        # Maior sufixo primeiro; Data só como desempate (alinhado ao MySQL).
        candidates.append((_cod_status_seq_key(cod), data or datetime.min, str(cod)))

    if not candidates:
        return None

    candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    chosen = candidates[0][2]
    cursor.execute(
        "UPDATE tabAndamento SET UltimoStatus = ? WHERE CodStatus = ?",
        (to_mdb_bool(True), chosen),
    )
    return chosen


def push_os_ultimo_status_to_mdb(
    nro: int,
    ano: int,
    *,
    promoted_cod: Optional[str] = None,
) -> Optional[str]:
    """Espelha o UltimoStatus canônico (MySQL) em toda a OS no MDB."""
    operation = "fix_ultimo_status"
    _ensure_mdb_write_enabled(operation, promoted_cod or "", nro, ano)
    _log_mdb_write_start(operation, promoted_cod or "", nro, ano)
    stage = f"fix_ultimo_status_{nro}_{ano}"
    result: dict[str, Optional[str]] = {"cod": None}

    def _work(_conn, cursor):
        result["cod"] = _fix_ultimo_status_mdb(
            cursor, nro, ano, promoted_cod=promoted_cod
        )

    try:
        _execute_mdb_transaction(nro, stage, _work)
    except Exception as exc:
        _log_mdb_write_error(operation, promoted_cod or "", nro, ano, exc)
        raise
    _log_mdb_write_ok(operation, result["cod"] or promoted_cod or "", nro, ano)
    return result["cod"]
def _write_os_to_mdb_cursor(
    cursor,
    nro: int,
    ano: int,
    proto_rows: List[Dict],
    det_raw: Dict,
    *,
    sync_andamentos: bool,
    cod_statuses: Optional[List[str]],
) -> None:
    mdb_path = get_mdb_path(nro)
    proto = prepare_os_protocol_params(proto_rows[0])
    det = prepare_os_detalhes_params(det_raw)
    _ensure_os_lookups(cursor, proto, det, mdb_path=mdb_path)
    _write_protocolo(cursor, nro, ano, proto, mdb_path=mdb_path)
    _write_detalhes(cursor, nro, ano, det, mdb_path=mdb_path)
    if not sync_andamentos:
        return
    codes = cod_statuses
    if not codes:
        and_rows = db.execute_query(
            """
            SELECT CodStatus FROM tabAndamento
            WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
            ORDER BY CodStatus
            """,
            (nro, ano),
        )
        codes = [r["CodStatus"] for r in and_rows if r.get("CodStatus")]
    nro_fk, ano_fk = _ensure_protocolo_in_mdb(cursor, nro, ano)
    for cod in codes:
        rows = db.execute_query(
            """
            SELECT * FROM tabAndamento
            WHERE CodStatus = %s AND NroProtocoloLink = %s AND AnoProtocoloLink = %s
            """,
            (cod, nro, ano),
        )
        if not rows:
            logger.warning("Andamento %s não encontrado no MySQL — ignorado no MDB", cod)
            continue
        _upsert_andamento_row(cursor, rows[0], nro_fk, ano_fk)
def sync_os_from_mysql_to_mdb(
    nro: int,
    ano: int,
    *,
    sync_andamentos: bool = False,
    cod_statuses: Optional[list[str]] = None,
) -> bool:
    """Replica OS do MySQL para o MDB (após commit no MySQL), com retry em lock."""
    if not config_manager.is_mdb_write_enabled():
        return False
    proto_rows = db.execute_query(
        "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
        (nro, ano),
    )
    if not proto_rows:
        raise ValueError(f"Protocolo {nro}/{ano} não encontrado no MySQL — replicação MDB abortada")
    det_rows = db.execute_query(
        "SELECT * FROM tabDetalhesServico WHERE NroProtocoloLinkDet = %s AND AnoProtocoloLinkDet = %s",
        (nro, ano),
    )
    det_raw = det_rows[0] if det_rows else {}
    stage = f"os_{nro}_{ano}"
    def _work(_conn, cursor):
        _write_os_to_mdb_cursor(
            cursor, nro, ano, proto_rows, det_raw,
            sync_andamentos=sync_andamentos,
            cod_statuses=cod_statuses,
        )
    _execute_mdb_transaction(nro, stage, _work)
    logger.info("Replicação MySQL→MDB concluída para OS %s/%s", nro, ano)
    return True
def sync_os_to_mdb(data, final_id: int, current_year: int, is_update: bool = False) -> bool:
    if not config_manager.is_mdb_write_enabled():
        logger.debug(
            "sync_os_to_mdb ignorado (MYSQL_ONLY): OS %s/%s permanece somente no MySQL",
            final_id, current_year,
        )
        return False
    initial_cod = f"{final_id:05d}{current_year}-01"
    return sync_os_from_mysql_to_mdb(
        final_id,
        current_year,
        sync_andamentos=not is_update,
        cod_statuses=[initial_cod] if not is_update else None,
    )
def sync_andamento_from_mysql_to_mdb(
    cod_status: str,
    nro: int,
    ano: int,
    *,
    operation: str = "upsert",
    sync_protocolo_extra: bool = False,
) -> bool:
    """Replica andamento do MySQL para o MDB pela PK CodStatus, com retry.

    Se sync_protocolo_extra=True (Entregue/Cancelado), grava também os campos de
    entrega/cancelamento em tabProtocolos na mesma transação Access.
    """
    _ensure_mdb_write_enabled(operation, cod_status, nro, ano)
    _log_mdb_write_start(operation, cod_status, nro, ano)
    rows = db.execute_query(
        """
        SELECT * FROM tabAndamento
        WHERE CodStatus = %s AND NroProtocoloLink = %s AND AnoProtocoloLink = %s
        """,
        (cod_status, nro, ano),
    )
    if not rows:
        err = ValueError(
            f"Andamento {cod_status} não encontrado no MySQL — replicação MDB abortada"
        )
        _log_mdb_write_error(operation, cod_status, nro, ano, err)
        raise err

    proto_extra: Dict[str, Any] | None = None
    if sync_protocolo_extra:
        proto_rows = db.execute_query(
            "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
            (nro, ano),
        )
        if not proto_rows:
            err = ValueError(
                f"Protocolo {nro}/{ano} ausente no MySQL — sync entrega MDB abortado"
            )
            _log_mdb_write_error(operation, cod_status, nro, ano, err)
            raise err
        proto_extra = proto_rows[0]

    stage = f"andamento_{cod_status}"

    def _work(_conn, cursor):
        nro_fk, ano_fk = _ensure_protocolo_in_mdb(cursor, nro, ano)
        _upsert_andamento_row(cursor, rows[0], nro_fk, ano_fk)
        # Sempre realinha a OS inteira — upsert de uma linha não basta.
        _fix_ultimo_status_mdb(cursor, nro_fk, ano_fk)
        if proto_extra is not None:
            mdb_path = get_mdb_path(nro)
            written = _write_protocolo_andamento_extra(
                cursor,
                nro,
                ano,
                proto_extra,
                mdb_path=mdb_path,
            )
            if written <= 0:
                raise ValueError(
                    f"Campos de entrega/cancelamento não gravados em tabProtocolos "
                    f"do MDB para OS {nro}/{ano} (nenhuma coluna resolvida)"
                )

    try:
        _execute_mdb_transaction(nro, stage, _work)
    except MdbSyncError as exc:
        raise MdbSyncError(
            exc.stage,
            exc.nro,
            exc.mdb_path,
            exc.cause,
            attempts=exc.attempts,
            cod_status=cod_status,
            ano=ano,
        ) from exc
    except Exception as exc:
        _log_mdb_write_error(operation, cod_status, nro, ano, exc)
        raise
    _log_mdb_write_ok(operation, cod_status, nro, ano)
    return True


def sync_andamento_to_mdb(
    cod_status: str,
    nro: int,
    ano: int,
    situacao: str = None,
    setor: str = None,
    obs: str = None,
    ponto: str = None,
    data: Optional[datetime] = None,
    ultimo_status: bool = True,
) -> bool:
    return sync_andamento_from_mysql_to_mdb(cod_status, nro, ano)


def sync_andamento_update_to_mdb(
    cod_status: str,
    nro: int,
    ano: int,
    situacao: str = None,
    setor: str = None,
    obs: str = None,
    ponto: str = None,
) -> bool:
    return sync_andamento_from_mysql_to_mdb(cod_status, nro, ano)


def sync_andamento_delete_to_mdb(cod_status: str, nro: int, ano: int) -> bool:
    """
    Replica exclusão de andamento no MDB (após DELETE no MySQL).
    Remove pela PK CodStatus e recalcula UltimoStatus nos registros restantes.
    """
    operation = "delete"
    _ensure_mdb_write_enabled(operation, cod_status, nro, ano)
    _log_mdb_write_start(operation, cod_status, nro, ano)
    stage = f"delete_andamento_{cod_status}"

    def _work(_conn, cursor):
        cursor.execute(
            "SELECT COUNT(*) FROM tabAndamento WHERE CodStatus = ?",
            (cod_status,),
        )
        if cursor.fetchone()[0] == 0:
            logger.warning(
                "[MDB WRITE] delete: andamento %s ausente no MDB %s (já removido?)",
                cod_status,
                get_mdb_path(nro),
            )
        else:
            cursor.execute("DELETE FROM tabAndamento WHERE CodStatus = ?", (cod_status,))
        # Sempre realinha flags — mesmo se a linha já não existia no Access.
        _fix_ultimo_status_mdb(cursor, nro, ano)

    try:
        _execute_mdb_transaction(nro, stage, _work)
    except Exception as exc:
        _log_mdb_write_error(operation, cod_status, nro, ano, exc)
        raise
    _log_mdb_write_ok(operation, cod_status, nro, ano)
    return True


def push_andamento_to_mdb_after_mysql(
    cod_status: str,
    nro: int,
    ano: int,
    *,
    operation: str = "insert",
    task_name: str | None = None,
) -> None:
    """Replica andamento no MDB após commit MySQL (background por padrão)."""
    name = task_name or f"andamento_{operation}"

    def _work() -> None:
        sync_andamento_from_mysql_to_mdb(
            cod_status, nro, ano, operation=operation
        )

    dispatch_mdb_sync(name, _work, cod_status=cod_status, nro=nro, ano=ano)


def fetch_andamento_alert_context(
    cod_status: str | None,
    nro: int | None,
    ano: int | None,
) -> dict[str, str | int | None]:
    """Dados do registro em tabAndamento (MySQL) para alerta ao administrador."""
    if not cod_status or nro is None or ano is None:
        return {}
    rows = db.execute_query(
        """
        SELECT CodStatus, NroProtocoloLink, AnoProtocoloLink,
               SituacaoLink, SetorLink, Ponto, Observaçao
        FROM tabAndamento
        WHERE CodStatus = %s AND NroProtocoloLink = %s AND AnoProtocoloLink = %s
        LIMIT 1
        """,
        (cod_status, nro, ano),
    )
    if not rows:
        return {
            "cod_status": cod_status,
            "nro": nro,
            "ano": ano,
            "situacao": None,
            "setor": None,
            "ponto": None,
            "obs": None,
        }
    row = rows[0]
    return {
        "cod_status": str(row.get("CodStatus") or cod_status),
        "nro": int(row.get("NroProtocoloLink") or nro),
        "ano": int(row.get("AnoProtocoloLink") or ano),
        "situacao": str(row.get("SituacaoLink") or "") or None,
        "setor": str(row.get("SetorLink") or "") or None,
        "ponto": str(row.get("Ponto") or "") or None,
        "obs": str(row.get("Observaçao") or "") or None,
    }


def _format_andamento_alert_lines(record: dict[str, str | int | None]) -> list[str]:
    if not record:
        return []
    lines = ["--- Registro com erro (MySQL) ---"]
    if record.get("cod_status"):
        lines.append(f"CodStatus: {record['cod_status']}")
    nro = record.get("nro")
    ano = record.get("ano")
    if nro is not None and ano is not None:
        lines.append(f"OS: {nro}/{ano}")
    for label, key in (
        ("Situação", "situacao"),
        ("Setor", "setor"),
        ("Ponto", "ponto"),
        ("Obs", "obs"),
    ):
        value = record.get(key)
        if value is not None and str(value).strip():
            lines.append(f"{label}: {value}")
    return lines


def format_mdb_failure_detail(
    exc: Exception,
    *,
    task_name: str | None = None,
    cod_status: str | None = None,
    nro: int | None = None,
    ano: int | None = None,
    andamento: dict[str, str | int | None] | None = None,
) -> str:
    """Texto técnico completo da falha MDB (para log e alerta ao administrador)."""
    lines: list[str] = []
    if task_name:
        lines.append(f"Operação: {task_name}")

    record = andamento or {}
    if isinstance(exc, MdbSyncError):
        nro = nro if nro is not None else exc.nro
        ano = ano if ano is not None else exc.ano
        cod_status = cod_status or exc.cod_status
    elif isinstance(exc, MdbWriteDisabledError):
        nro = nro if nro is not None else exc.nro
        ano = ano if ano is not None else exc.ano
        cod_status = cod_status or exc.cod_status

    if not record and cod_status and nro is not None and ano is not None:
        record = fetch_andamento_alert_context(cod_status, nro, ano)

    if cod_status:
        lines.append(f"CodStatus: {cod_status}")

    if isinstance(exc, MdbSyncError):
        root = exc.cause or exc
        if nro is not None:
            lines.append(f"OS: {nro}" + (f"/{ano}" if ano is not None else ""))
        lines.extend(_format_andamento_alert_lines(record))
        lines.append(f"Arquivo MDB (config): {exc.mdb_path}")
        resolved = config_manager.resolve_mdb_path(exc.mdb_path)
        if resolved and resolved != exc.mdb_path:
            lines.append(f"Arquivo MDB (resolvido): {resolved}")
        lines.append(f"Tentativas: {exc.attempts}")
        lines.append(f"Detalhe: {root}")
    elif isinstance(exc, MdbWriteDisabledError):
        lines.append(f"OS: {exc.nro}/{exc.ano}")
        lines.append(f"CodStatus: {exc.cod_status}")
        lines.extend(_format_andamento_alert_lines(record))
        lines.append("MYSQL_ONLY=true — gravação Access desativada.")
        lines.append(f"Detalhe: {exc}")
    else:
        if nro is not None and ano is not None:
            lines.append(f"OS: {nro}/{ano}")
        lines.extend(_format_andamento_alert_lines(record))
        lines.append(f"Detalhe: {exc}")
    return "\n".join(lines)


def handle_mdb_sync_failure(
    task_name: str,
    exc: Exception,
    *,
    cod_status: str | None = None,
    nro: int | None = None,
    ano: int | None = None,
) -> None:
    """
    Registra falha de sync MDB após commit MySQL.

    O usuário final não deve ver detalhes técnicos; o administrador é alertado
    via mensagens de suporte.
    """
    if isinstance(exc, MdbSyncError):
        if nro is None:
            nro = exc.nro
        if ano is None:
            ano = exc.ano
        if cod_status is None:
            cod_status = exc.cod_status
    if isinstance(exc, MdbWriteDisabledError):
        if nro is None:
            nro = exc.nro
        if ano is None:
            ano = exc.ano
        if cod_status is None:
            cod_status = exc.cod_status

    andamento = fetch_andamento_alert_context(cod_status, nro, ano)

    logger.error(
        "Falha sync MDB pós-MySQL (%s): %s",
        task_name,
        exc,
        exc_info=True,
    )
    try:
        from services.support_message_service import create_system_mdb_alert

        create_system_mdb_alert(
            task_name=task_name,
            exc=exc,
            cod_status=cod_status,
            nro=nro,
            ano=ano,
            andamento=andamento,
        )
    except Exception as notify_exc:
        logger.warning(
            "Não foi possível alertar administrador sobre falha MDB (%s): %s",
            task_name,
            notify_exc,
        )


def mdb_sync_http_exception(task_name: str, exc: Exception):
    """Compatibilidade: alerta admin e não expõe detalhes técnicos ao usuário."""
    handle_mdb_sync_failure(task_name, exc)
    from fastapi import HTTPException

    return HTTPException(
        status_code=502,
        detail=(
            "Não foi possível concluir a sincronização com o sistema legado. "
            "Seus dados foram registrados no SAGRA Web. "
            "O suporte técnico foi notificado."
        ),
    )


def format_mdb_failure_message(exc: Exception) -> str:
    """Mensagem técnica resumida quando MySQL OK mas MDB falhou (uso interno/admin)."""
    detail = ""
    root = exc
    if isinstance(exc, MdbSyncError):
        root = exc.cause or exc
        detail = f" Arquivo: {exc.mdb_path}."
    cause_text = str(root).strip()
    if cause_text:
        if len(cause_text) > 180:
            cause_text = cause_text[:177] + "..."
        detail += f" Detalhe: {cause_text}"

    if isinstance(exc, MdbSyncError):
        if is_retriable_mdb_error(root):
            return (
                " (Aviso: gravado no sistema web, mas o Access (MDB) estava ocupado ou bloqueado."
                f"{detail} Salve novamente em alguns segundos.)"
            )
        return (
            " (Aviso: gravado no sistema web, mas o Access (MDB) não atualizou após "
            f"{exc.attempts} tentativa(s).{detail})"
        )
    if is_retriable_mdb_error(exc):
        return (
            " (Aviso: gravado no sistema web, mas o Access (MDB) estava ocupado."
            f"{detail} Salve novamente.)"
        )
    return (
        " (Aviso: gravado no sistema web, mas não foi possível atualizar o banco Access/MDB."
        f"{detail})"
    )


def _write_protocolo_extra_cols(
    cursor,
    nro: int,
    ano: int,
    proto_row: Dict[str, Any],
    extra_cols: tuple[str, ...],
    *,
    mdb_path: str,
) -> int:
    """
    Atualiza colunas extras de tabProtocolos no MDB.
    Retorna quantas colunas físicas foram gravadas (0 = nada escrito).
    """
    if not _protocolo_exists(cursor, nro, ano):
        logger.warning(
            "Protocolo %s/%s ausente no MDB %s — sync extra tabProtocolos ignorado",
            nro,
            ano,
            mdb_path,
        )
        return 0
    avail = _mdb_table_columns(cursor, "tabProtocolos", mdb_path)
    mapped = _map_protocolo_cols_for_mdb(avail, extra_cols, proto_row)
    if not mapped:
        logger.warning(
            "Nenhuma coluna extra de tabProtocolos disponível no MDB %s para OS %s/%s "
            "(solicitadas=%s; avail_tem_retirada=%s)",
            mdb_path,
            nro,
            ano,
            list(extra_cols),
            bool(_resolve_mdb_column(avail, "RetiradaPonto") or _resolve_mdb_column(avail, "RetiradaNome")),
        )
        return 0

    cols = list(mapped.keys())
    values = list(mapped.values())
    # Colchetes: seguro para nomes acentuados (ex.: Funcionário) no Access.
    set_sql = ", ".join(f"[{col}]=?" for col in cols)
    cursor.execute(
        f"UPDATE tabProtocolos SET {set_sql} WHERE NroProtocolo=? AND AnoProtocolo=?",
        tuple(values) + (nro, ano),
    )
    logger.info(
        "tabProtocolos MDB atualizado OS %s/%s cols=%s",
        nro,
        ano,
        cols,
    )
    return len(cols)


def _write_protocolo_andamento_extra(
    cursor,
    nro: int,
    ano: int,
    proto_row: Dict[str, Any],
    *,
    mdb_path: str,
) -> int:
    return _write_protocolo_extra_cols(
        cursor,
        nro,
        ano,
        proto_row,
        _PROTO_ANDAMENTO_EXTRA_COLS,
        mdb_path=mdb_path,
    )


def sync_protocolo_andamento_fields_to_mdb(nro: int, ano: int) -> bool:
    """Replica campos de entrega/cancelamento de tabProtocolos (MySQL → MDB)."""
    if not config_manager.is_mdb_write_enabled():
        return False
    proto_rows = db.execute_query(
        "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
        (nro, ano),
    )
    if not proto_rows:
        logger.warning(
            "Protocolo %s/%s ausente no MySQL — sync extra tabProtocolos ignorado",
            nro,
            ano,
        )
        return False
    stage = f"protocolo_andamento_extra_{nro}_{ano}"
    written = {"n": 0}

    def _work(_conn, cursor):
        mdb_path = get_mdb_path(nro)
        written["n"] = _write_protocolo_andamento_extra(
            cursor,
            nro,
            ano,
            proto_rows[0],
            mdb_path=mdb_path,
        )

    _execute_mdb_transaction(nro, stage, _work)
    if written["n"] <= 0:
        logger.error(
            "Campos entrega/cancelamento NÃO gravados no MDB para OS %s/%s "
            "(0 colunas — verifique schema/alias tabProtocolos)",
            nro,
            ano,
        )
        return False
    logger.info(
        "Campos entrega/cancelamento replicados no MDB para OS %s/%s (%s colunas)",
        nro,
        ano,
        written["n"],
    )
    return True


def sync_protocolo_req_entregue_to_mdb(nro: int, ano: int) -> bool:
    """Replica ReqEntregue de tabProtocolos (MySQL → MDB) após lançamento CotasGraf."""
    if not config_manager.is_mdb_write_enabled():
        return False
    proto_rows = db.execute_query(
        "SELECT * FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
        (nro, ano),
    )
    if not proto_rows:
        logger.warning(
            "Protocolo %s/%s ausente no MySQL — sync ReqEntregue ignorado",
            nro,
            ano,
        )
        return False
    stage = f"protocolo_req_entregue_{nro}_{ano}"
    written = {"n": 0}

    def _work(_conn, cursor):
        mdb_path = get_mdb_path(nro)
        written["n"] = _write_protocolo_extra_cols(
            cursor,
            nro,
            ano,
            proto_rows[0],
            _PROTO_REQUISICAO_EXTRA_COLS,
            mdb_path=mdb_path,
        )

    _execute_mdb_transaction(nro, stage, _work)
    if written["n"] <= 0:
        logger.error("ReqEntregue NÃO gravado no MDB para OS %s/%s", nro, ano)
        return False
    logger.info("ReqEntregue replicado no MDB para OS %s/%s", nro, ano)
    return True

