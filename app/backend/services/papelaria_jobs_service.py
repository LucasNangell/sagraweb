"""
Fila de jobs de geração Corel/PDF para Papelaria.
Sem COM no servidor — worker Windows processará na fase seguinte.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
from datetime import datetime
from typing import Any, Optional

from config_manager import PROJECT_ROOT
from database import db

logger = logging.getLogger(__name__)

STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

PROVA_REVISAO_PENDING = "pending"
PROVA_REVISAO_APPROVED = "approved"
PROVA_REVISAO_DISCARDED = "discarded"

TIPO_JOB_CREATE = "create"
TIPO_JOB_MANUAL_COREL = "manual_corel"
TIPO_JOB_EXPORT_EXISTING_CDR = "export_existing_cdr"
TIPO_JOB_CREDENCIAIS_DEPOL = "credenciais_depol"

CDR_BACKUP_NAME_FRAGMENT = "cópia_de_segurança"
INPUT_CDR_DADOS_KEY = "__input_cdr"

TERMINAL_STATUSES = frozenset({STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED})
CANCELLABLE_STATUSES = frozenset({STATUS_PENDING, STATUS_PROCESSING})

MAX_DADOS_JSON_BYTES = 32 * 1024
MAX_WORKER_RETRIES = 3
_PATH_PATTERN = re.compile(r"[\\/]{2,}|:[\\/]|[a-zA-Z]:\\")
_UNSAFE_FILENAME = re.compile(r'[\\/*?:"<>|]|\.\.')

_tables_ready = False
_worker_heartbeats: dict[str, datetime] = {}
_worker_meta: dict[str, dict[str, Any]] = {}

_DEFAULT_WORKER_HEARTBEAT_STALE_SEC = 75
_DEFAULT_PROCESSING_MAX_SEC = 360
_DEFAULT_JOB_STALL_SEC = 30


def ensure_papelaria_jobs_tables() -> None:
    global _tables_ready
    if _tables_ready:
        return

    sql_path = PROJECT_ROOT / "deploy" / "sql" / "create_papelaria_jobs.sql"
    if sql_path.is_file():
        raw = sql_path.read_text(encoding="utf-8")
        for stmt in raw.split(";"):
            s = stmt.strip()
            if s:
                db.execute_query(s)

    _ensure_prova_revisao_column()
    _backfill_prova_revisao_pending()
    _tables_ready = True
    logger.info(
        "Tabelas tabPapelariaJobs/tabPapelariaJobLog/tabPapelariaWorkerHeartbeat verificadas/criadas"
    )


def _ensure_prova_revisao_column() -> None:
    rows = db.execute_query(
        "SHOW COLUMNS FROM tabPapelariaJobs LIKE 'ProvaRevisao'"
    )
    if rows:
        return
    db.execute_query(
        """
        ALTER TABLE tabPapelariaJobs
        ADD COLUMN ProvaRevisao VARCHAR(20) NULL
        AFTER ArquivoPdfGerado
        """
    )
    logger.info("Coluna tabPapelariaJobs.ProvaRevisao adicionada")


def _backfill_prova_revisao_pending() -> None:
    """Jobs concluídos antes da coluna ou via API antiga ficam aguardando revisão."""
    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET ProvaRevisao = %(pending)s
        WHERE Status = %(completed)s
          AND ArquivoPdfGerado IS NOT NULL
          AND TRIM(ArquivoPdfGerado) <> ''
          AND (ProvaRevisao IS NULL OR TRIM(ProvaRevisao) = '')
        """,
        {"pending": PROVA_REVISAO_PENDING, "completed": STATUS_COMPLETED},
    )


def _parse_json_field(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None
    return None


def _format_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def _row_to_job(row: dict[str, Any], include_logs: bool = False) -> dict[str, Any]:
    dados = _parse_json_field(row.get("DadosJson")) or {}
    job = {
        "id": row["ID"],
        "nro_protocolo": row["NroProtocolo"],
        "ano_protocolo": row["AnoProtocolo"],
        "tipo_job": row.get("TipoJob") or "create",
        "produto": row.get("Produto") or "",
        "modelo_id": row.get("ModeloID"),
        "arquivo_modelo": row.get("ArquivoModelo") or "",
        "dados": dados,
        "status": row.get("Status") or STATUS_PENDING,
        "prioridade": row.get("Prioridade") or 0,
        "ordem_fila": row.get("OrdemFila"),
        "solicitado_por": row.get("SolicitadoPor") or "",
        "solicitado_em": _format_datetime(row.get("SolicitadoEm")),
        "iniciado_em": _format_datetime(row.get("IniciadoEm")),
        "concluido_em": _format_datetime(row.get("ConcluidoEm")),
        "worker_id": row.get("WorkerID"),
        "arquivo_cdr": _basename_only(row.get("ArquivoCdrGerado")),
        "arquivo_pdf": _basename_only(row.get("ArquivoPdfGerado")),
        "erro": row.get("Erro"),
        "tentativas": row.get("Tentativas") or 0,
        "versao": row.get("Versao") or 1,
        "job_pai_id": row.get("JobPaiID"),
        "tem_arquivo_pdf": bool(row.get("ArquivoPdfGerado")),
        "tem_arquivo_cdr": bool(row.get("ArquivoCdrGerado")),
        "prova_revisao": _resolve_prova_revisao_from_row(row),
    }
    if include_logs:
        job["logs"] = list_job_logs(row["ID"], limit=20)
    return job


def _resolve_prova_revisao_from_row(row: dict[str, Any]) -> Optional[str]:
    revisao = (row.get("ProvaRevisao") or "").strip() or None
    if revisao:
        return revisao
    status = (row.get("Status") or "").strip()
    has_pdf = bool((row.get("ArquivoPdfGerado") or "").strip())
    if status == STATUS_COMPLETED and has_pdf:
        return PROVA_REVISAO_PENDING
    return None


def _basename_only(path: Optional[str]) -> Optional[str]:
    if not path:
        return None
    return os.path.basename(str(path).replace("\\", "/"))


def next_queue_position() -> int:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        "SELECT COALESCE(MAX(OrdemFila), 0) + 1 AS next_pos FROM tabPapelariaJobs"
    )
    return int(rows[0]["next_pos"]) if rows else 1


def _validate_os_exists(
    ano: int,
    nro: int,
    *,
    require_papelaria: bool = True,
) -> dict[str, Any]:
    """
    Confirma que a OS existe.

    require_papelaria=True (jobs Papelaria): exige nro >= 5000 ou produto de papelaria.
    require_papelaria=False (ex.: Credenciais DEPOL): qualquer OS válida.
    """
    if require_papelaria and nro < 5000:
        from services import papelaria_models_service as models_svc

        if not models_svc.is_papelaria_os_by_product(ano, nro):
            raise ValueError(
                "OS de papelaria deve ter número >= 5000 ou possuir produto de papelaria configurado."
            )
    rows = db.execute_query(
        """
        SELECT p.NroProtocolo, p.AnoProtocolo, d.TipoPublicacaoLink AS produto
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet
         AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s
        """,
        {"nro": nro, "ano": ano},
    )
    if not rows:
        raise LookupError("OS não encontrada.")
    return rows[0]


def _sanitize_dados(dados: dict[str, Any]) -> dict[str, str]:
    if not isinstance(dados, dict):
        raise ValueError("Campo 'dados' deve ser um objeto JSON.")

    cleaned: dict[str, str] = {}
    for key, value in dados.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError("Chaves de 'dados' inválidas.")
        key_stripped = key.strip()
        if re.search(r"[\\/]{2,}|\.{2}", key_stripped):
            raise ValueError("Chaves de 'dados' não podem conter caminhos.")
        if key_stripped == "__campos_dinamicos_layout":
            if not isinstance(value, str):
                raise ValueError("Layout de campos dinâmicos inválido.")
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("Layout de campos dinâmicos: JSON inválido.") from exc
            if not isinstance(parsed, dict):
                raise ValueError("Layout de campos dinâmicos deve ser um objeto.")
            cleaned[key_stripped] = value.strip()
            continue
        if key_stripped == "__exclusoes":
            if not isinstance(value, str):
                raise ValueError("Lista de exclusões inválida.")
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("Lista de exclusões: JSON inválido.") from exc
            if not isinstance(parsed, list):
                raise ValueError("Lista de exclusões deve ser uma lista.")
            cleaned[key_stripped] = value.strip()
            continue
        if key_stripped == INPUT_CDR_DADOS_KEY:
            continue
        if value is None:
            cleaned[key.strip()] = ""
            continue
        if not isinstance(value, (str, int, float, bool)):
            raise ValueError(f"Valor inválido para campo '{key_stripped}'.")
        text = str(value).strip()
        if _PATH_PATTERN.search(text) or "\\\\" in text:
            raise ValueError(f"Campo '{key_stripped}' não pode conter caminho de arquivo.")
        if len(text) > 2000:
            raise ValueError(f"Campo '{key_stripped}' excede tamanho máximo.")
        cleaned[key_stripped] = text

    payload = json.dumps(cleaned, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_DADOS_JSON_BYTES:
        raise ValueError("Payload de dados excede o limite permitido (32 KB).")
    return cleaned


def _validate_required_fields(
    modelo: dict[str, Any],
    dados: dict[str, str],
) -> list[str]:
    missing: list[str] = []
    exclusoes: list[str] = []
    exclusoes_raw = dados.get("__exclusoes")
    if exclusoes_raw:
        try:
            parsed = json.loads(exclusoes_raw) if isinstance(exclusoes_raw, str) else exclusoes_raw
            if isinstance(parsed, list):
                exclusoes = [str(item) for item in parsed]
        except Exception:
            pass

    for field in modelo.get("campos_formulario") or []:
        if not field.get("required"):
            continue
        key = field.get("key", "")
        if key in exclusoes:
            continue
        if not str(dados.get(key, "")).strip():
            missing.append(key)
    return missing


def _product_match_warning(os_produto: str, modelo_produto: str) -> Optional[str]:
    from services.papelaria_models_service import normalizar_texto_produto

    os_norm = normalizar_texto_produto(os_produto)
    mod_norm = normalizar_texto_produto(modelo_produto)
    if not os_norm or not mod_norm:
        return None
    if os_norm == mod_norm:
        return None
    if os_norm in mod_norm or mod_norm in os_norm:
        return (
            f"Modelo '{modelo_produto}' selecionado manualmente "
            f"(produto OS: '{os_produto}')."
        )
    return (
        f"Modelo '{modelo_produto}' pode não corresponder ao produto da OS "
        f"('{os_produto}')."
    )


def broadcast_job_update(job: dict[str, Any]) -> None:
    try:
        from routers.realtime import schedule_broadcast

        schedule_broadcast(
            {
                "type": "papelaria_job_update",
                "job_id": job["id"],
                "ano": job["ano_protocolo"],
                "nro": job["nro_protocolo"],
                "status": job["status"],
            }
        )
    except Exception as exc:
        logger.warning("Falha ao emitir papelaria_job_update: %s", exc)


def append_job_log(
    job_id: int,
    mensagem: str,
    nivel: str = "info",
    detalhe: Optional[dict[str, Any]] = None,
) -> None:
    ensure_papelaria_jobs_tables()
    db.execute_query(
        """
        INSERT INTO tabPapelariaJobLog (JobID, Nivel, Mensagem, DetalheJson)
        VALUES (%(job_id)s, %(nivel)s, %(msg)s, %(detalhe)s)
        """,
        {
            "job_id": job_id,
            "nivel": nivel,
            "msg": mensagem[:4000],
            "detalhe": json.dumps(detalhe, ensure_ascii=False) if detalhe else None,
        },
    )


def create_job(
    ano: int,
    nro: int,
    modelo_id: int,
    dados: dict[str, Any],
    solicitado_por: str,
    tipo_job: str = "create",
    job_pai_id: Optional[int] = None,
) -> dict[str, Any]:
    ensure_papelaria_jobs_tables()
    from services import papelaria_models_service as models_svc

    os_row = _validate_os_exists(ano, nro)
    modelo = models_svc.get_modelo_by_id(modelo_id)
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    dados_clean = _sanitize_dados(dados)
    missing = _validate_required_fields(modelo, dados_clean)
    if missing:
        raise ValueError(f"Campos obrigatórios ausentes: {', '.join(missing)}")

    if "gabinete" in dados_clean and dados_clean["gabinete"]:
        dados_clean["gabinete"] = models_svc.normalizar_gabinete(dados_clean["gabinete"])
    if "uf" in dados_clean and dados_clean["uf"]:
        dados_clean["uf"] = dados_clean["uf"].upper()

    ordem = next_queue_position()
    produto_os = (os_row.get("produto") or modelo["produto"] or "").strip()
    produto_job = modelo["produto"]

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": tipo_job,
        "produto": produto_job,
        "modelo_id": modelo_id,
        "arquivo": modelo["arquivo_modelo"],
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_PENDING,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": job_pai_id,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(job_id, "Job criado e aguardando processamento.", "info")
    warning = _product_match_warning(produto_os, produto_job)
    if warning:
        append_job_log(job_id, warning, "warning")
        job["warnings"] = [warning]

    broadcast_job_update(job)
    return job


def create_export_existing_cdr_job(
    ano: int,
    nro: int,
    modelo_id: int,
    dados: dict[str, Any],
    solicitado_por: str,
    arquivo_cdr: Optional[str] = None,
) -> dict[str, Any]:
    """Enfileira exportação de PDF a partir de um .cdr existente na pasta da OS."""
    ensure_papelaria_jobs_tables()
    from services import papelaria_models_service as models_svc

    os_row = _validate_os_exists(ano, nro)
    modelo = models_svc.get_modelo_by_id(modelo_id)
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    chosen = select_os_usable_cdr(ano, nro, arquivo_cdr)

    dados_clean = _sanitize_dados(dados)
    dados_clean[INPUT_CDR_DADOS_KEY] = chosen["relative_path"]
    if "gabinete" in dados_clean and dados_clean["gabinete"]:
        dados_clean["gabinete"] = models_svc.normalizar_gabinete(dados_clean["gabinete"])
    if "uf" in dados_clean and dados_clean["uf"]:
        dados_clean["uf"] = dados_clean["uf"].upper()

    ordem = next_queue_position()
    produto_os = (os_row.get("produto") or modelo["produto"] or "").strip()
    produto_job = modelo["produto"]

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": TIPO_JOB_EXPORT_EXISTING_CDR,
        "produto": produto_job,
        "modelo_id": modelo_id,
        "arquivo": modelo["arquivo_modelo"],
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_PENDING,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": None,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(
        job_id,
        f"Exportação de prova a partir do Corel existente ({chosen['filename']}).",
        "info",
    )
    warning = _product_match_warning(produto_os, produto_job)
    if warning:
        append_job_log(job_id, warning, "warning")
        job["warnings"] = [warning]

    broadcast_job_update(job)
    return job


def create_credenciais_depol_job(
    ano: int,
    nro: int,
    dados: dict[str, Any],
    solicitado_por: str,
) -> dict[str, Any]:
    """Enfileira geração multipágina de Credenciais DEPOL (sem modelo Papelaria)."""
    ensure_papelaria_jobs_tables()
    # DEPOL não é serviço de papelaria: aceita qualquer OS existente.
    _validate_os_exists(ano, nro, require_papelaria=False)

    if not isinstance(dados, dict):
        raise ValueError("Campo 'dados' deve ser um objeto JSON.")
    itens = dados.get("itens")
    if not isinstance(itens, list) or not itens:
        raise ValueError("Dados DEPOL sem itens.")
    payload = json.dumps(dados, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_DADOS_JSON_BYTES * 4:
        raise ValueError("Payload de dados DEPOL excede o limite permitido.")

    ordem = next_queue_position()
    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": TIPO_JOB_CREDENCIAIS_DEPOL,
        "produto": "Credenciais DEPOL",
        "modelo_id": None,
        "arquivo": "",
        "dados": payload,
        "status": STATUS_PENDING,
        "ordem": ordem,
        "ponto": solicitado_por,
        "job_pai": None,
    }

    def _insert_job(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao, JobPaiID
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, %(ordem)s, %(ponto)s, 1, %(job_pai)s
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    results = db.execute_transaction([_insert_job])
    job_id = int(results[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(
        job_id,
        f"Job Credenciais DEPOL criado ({len(itens)} credencial(is)).",
        "info",
    )
    broadcast_job_update(job)
    return job


def get_job(
    job_id: int,
    include_logs: bool = False,
    *,
    recover_stale: bool = True,
) -> Optional[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    if recover_stale:
        maybe_recover_processing_job(job_id)
    rows = db.execute_query(
        "SELECT * FROM tabPapelariaJobs WHERE ID = %(id)s LIMIT 1",
        {"id": job_id},
    )
    if not rows:
        return None
    return _row_to_job(rows[0], include_logs=include_logs)


def list_jobs_for_os(ano: int, nro: int, limit: int = 50) -> list[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT * FROM tabPapelariaJobs
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
        ORDER BY SolicitadoEm DESC, ID DESC
        LIMIT %(limit)s
        """,
        {"ano": ano, "nro": nro, "limit": max(1, min(limit, 100))},
    )
    return [_row_to_job(r) for r in rows]


def list_job_logs(job_id: int, limit: int = 50) -> list[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT ID, JobID, Nivel, Mensagem, DetalheJson, CriadoEm
        FROM tabPapelariaJobLog
        WHERE JobID = %(job_id)s
        ORDER BY CriadoEm ASC, ID ASC
        LIMIT %(limit)s
        """,
        {"job_id": job_id, "limit": max(1, min(limit, 200))},
    )
    return [
        {
            "id": r["ID"],
            "nivel": r.get("Nivel") or "info",
            "mensagem": r.get("Mensagem") or "",
            "criado_em": _format_datetime(r.get("CriadoEm")),
        }
        for r in rows
    ]


def _cancel_actor_label(solicitado_por: str) -> str:
    if str(solicitado_por).startswith("admin:"):
        return "administrador"
    return "usuário"


def normalize_pending_queue_orders() -> None:
    """Garante OrdemFila sequencial (1..n) nos jobs pending."""
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT ID FROM tabPapelariaJobs
        WHERE Status = %(pending)s
        ORDER BY Prioridade DESC, COALESCE(OrdemFila, 999999) ASC, ID ASC
        """,
        {"pending": STATUS_PENDING},
    )
    for i, row in enumerate(rows or [], start=1):
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET OrdemFila = %(ordem)s
            WHERE ID = %(id)s AND Status = %(pending)s
            """,
            {"ordem": i, "id": int(row["ID"]), "pending": STATUS_PENDING},
        )


def move_pending_job(
    job_id: int,
    direction: str,
    solicitado_por: str,
) -> dict[str, Any]:
    """Move job pending uma posição para cima ou para baixo na fila."""
    ensure_papelaria_jobs_tables()
    direction_l = (direction or "").strip().lower()
    if direction_l not in ("up", "down"):
        raise ValueError("direction deve ser 'up' ou 'down'.")

    normalize_pending_queue_orders()
    rows = db.execute_query(
        """
        SELECT ID, OrdemFila FROM tabPapelariaJobs
        WHERE Status = %(pending)s
        ORDER BY OrdemFila ASC, ID ASC
        """,
        {"pending": STATUS_PENDING},
    )
    if not rows:
        raise ValueError("Fila vazia.")

    ids = [int(r["ID"]) for r in rows]
    if job_id not in ids:
        raise ValueError("Somente jobs na fila (pending) podem ser reordenados.")

    idx = ids.index(job_id)
    if direction_l == "up":
        if idx == 0:
            job = get_job(job_id, recover_stale=False)
            if not job:
                raise LookupError("Job não encontrado.")
            return job
        swap_id = ids[idx - 1]
    else:
        if idx >= len(ids) - 1:
            job = get_job(job_id, recover_stale=False)
            if not job:
                raise LookupError("Job não encontrado.")
            return job
        swap_id = ids[idx + 1]

    ordem_job = int(rows[idx].get("OrdemFila") or (idx + 1))
    ordem_swap = int(rows[idx + (1 if direction_l == "down" else -1)].get("OrdemFila") or 0)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET OrdemFila = %(ordem)s
        WHERE ID = %(id)s AND Status = %(pending)s
        """,
        {"ordem": ordem_swap, "id": job_id, "pending": STATUS_PENDING},
    )
    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET OrdemFila = %(ordem)s
        WHERE ID = %(id)s AND Status = %(pending)s
        """,
        {"ordem": ordem_job, "id": swap_id, "pending": STATUS_PENDING},
    )

    actor = _cancel_actor_label(solicitado_por)
    append_job_log(
        job_id,
        f"Posição na fila alterada ({direction_l}) pelo {actor} {solicitado_por}.",
        "info",
    )
    updated = get_job(job_id, recover_stale=False)
    if not updated:
        raise LookupError("Job não encontrado.")
    broadcast_job_update(updated)
    swap_updated = get_job(swap_id, recover_stale=False)
    if swap_updated:
        broadcast_job_update(swap_updated)
    return updated


def cancel_job(job_id: int, solicitado_por: str) -> dict[str, Any]:
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")

    current_status = job["status"]
    if current_status not in CANCELLABLE_STATUSES:
        raise ValueError(
            f"Job não pode ser cancelado no status '{current_status}'."
        )

    if current_status == STATUS_PENDING:
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(status)s, ConcluidoEm = NOW(), Erro = NULL
            WHERE ID = %(id)s AND Status = %(pending)s
            """,
            {
                "id": job_id,
                "status": STATUS_CANCELLED,
                "pending": STATUS_PENDING,
            },
        )
    else:
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(status)s,
                ConcluidoEm = NOW(),
                WorkerID = NULL,
                IniciadoEm = NULL,
                Erro = %(erro)s
            WHERE ID = %(id)s AND Status = %(processing)s
            """,
            {
                "id": job_id,
                "status": STATUS_CANCELLED,
                "processing": STATUS_PROCESSING,
                "erro": (
                    f"Cancelado pelo {_cancel_actor_label(solicitado_por)} "
                    "durante processamento."
                ),
            },
        )

    updated = get_job(job_id, recover_stale=False)
    if not updated or updated["status"] != STATUS_CANCELLED:
        raise ValueError("Job não pôde ser cancelado (status alterado).")

    actor = _cancel_actor_label(solicitado_por)
    msg = (
        f"Job cancelado pelo {actor} {solicitado_por} durante processamento."
        if current_status == STATUS_PROCESSING
        else f"Job cancelado pelo {actor} {solicitado_por}."
    )
    append_job_log(job_id, msg, "info")
    broadcast_job_update(updated)
    return updated


def is_job_cancelled(job_id: int) -> bool:
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        "SELECT Status FROM tabPapelariaJobs WHERE ID = %(id)s LIMIT 1",
        {"id": job_id},
    )
    if not rows:
        return False
    return (rows[0].get("Status") or "") == STATUS_CANCELLED


def _worker_heartbeat_stale_seconds() -> int:
    raw = (os.environ.get("SAGRA_PAPELARIA_WORKER_HEARTBEAT_STALE_SEC") or "").strip()
    try:
        return max(30, int(raw))
    except ValueError:
        return _DEFAULT_WORKER_HEARTBEAT_STALE_SEC


def _parse_heartbeat_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


def _persist_worker_heartbeat(
    worker_id: str, heartbeat_at: datetime, meta: dict[str, Any]
) -> None:
    ensure_papelaria_jobs_tables()
    db.execute_query(
        """
        CREATE TABLE IF NOT EXISTS tabPapelariaWorkerHeartbeat (
            WorkerID VARCHAR(64) NOT NULL PRIMARY KEY,
            HeartbeatEm DATETIME NOT NULL,
            MetaJson JSON NULL,
            INDEX idx_heartbeat_em (HeartbeatEm)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """
    )
    meta_json = json.dumps(meta, ensure_ascii=False) if meta else None
    db.execute_query(
        """
        INSERT INTO tabPapelariaWorkerHeartbeat (WorkerID, HeartbeatEm, MetaJson)
        VALUES (%(wid)s, %(heartbeat_em)s, %(meta)s)
        ON DUPLICATE KEY UPDATE
            HeartbeatEm = VALUES(HeartbeatEm),
            MetaJson = VALUES(MetaJson)
        """,
        {
            "wid": worker_id,
            "heartbeat_em": heartbeat_at,
            "meta": meta_json,
        },
    )


def _worker_registry() -> dict[str, tuple[datetime, dict[str, Any]]]:
    """Estado dos workers: MySQL (persistente) + cache em memória (fallback)."""
    registry: dict[str, tuple[datetime, dict[str, Any]]] = {}
    try:
        ensure_papelaria_jobs_tables()
        rows = db.execute_query(
            """
            SELECT WorkerID, HeartbeatEm, MetaJson
            FROM tabPapelariaWorkerHeartbeat
            ORDER BY WorkerID
            """
        )
        for row in rows or []:
            wid = (row.get("WorkerID") or "").strip()
            ts = _parse_heartbeat_datetime(row.get("HeartbeatEm"))
            if not wid or ts is None:
                continue
            meta = _parse_json_field(row.get("MetaJson")) or {}
            if not isinstance(meta, dict):
                meta = {}
            registry[wid] = (ts, meta)
    except Exception as exc:
        logger.warning("Falha ao ler heartbeats de workers no banco: %s", exc)

    for wid, ts in _worker_heartbeats.items():
        if wid not in registry:
            registry[wid] = (ts, _worker_meta.get(wid) or {})
    return registry


def _processing_max_seconds() -> int:
    raw = (os.environ.get("SAGRA_PAPELARIA_PROCESSING_MAX_SEC") or "").strip()
    try:
        return max(120, int(raw))
    except ValueError:
        return _DEFAULT_PROCESSING_MAX_SEC


def _job_stall_seconds() -> int:
    """Tempo sem resposta do worker antes de redirecionar o job a outro worker."""
    raw = (os.environ.get("SAGRA_PAPELARIA_JOB_STALL_SEC") or "").strip()
    try:
        return max(15, int(raw))
    except ValueError:
        return _DEFAULT_JOB_STALL_SEC


def _job_cancelled_for_worker(job_id: int, worker_id: str) -> tuple[bool, Optional[str]]:
    """True se o job foi cancelado ou deixou de pertencer a este worker."""
    if is_job_cancelled(job_id):
        return True, "Job cancelado pelo usuário."
    job = get_job(job_id, recover_stale=False)
    if not job:
        return True, "Job não encontrado."
    if job["status"] != STATUS_PROCESSING:
        motivo = (job.get("erro") or "").strip()
        if job["status"] == STATUS_PENDING:
            return True, motivo or "Job redirecionado para outro worker."
        if job["status"] == STATUS_CANCELLED:
            return True, motivo or "Job cancelado."
        return True, f"Job não está mais em processamento (status: {job['status']})."
    if (job.get("worker_id") or "").strip() != (worker_id or "").strip():
        return True, "Job redirecionado para outro worker."
    return False, None


def _fleet_load_balance_enabled() -> bool:
    raw = (os.environ.get("SAGRA_PAPELARIA_FLEET_LOAD_BALANCE") or "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _load_score_margin() -> float:
    raw = (os.environ.get("SAGRA_PAPELARIA_LOAD_SCORE_MARGIN") or "").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 10.0


def _system_load_from_meta(meta: Optional[dict[str, Any]]) -> Optional[dict[str, float]]:
    if not meta:
        return None
    load = meta.get("system_load")
    if not isinstance(load, dict):
        return None
    try:
        cpu = float(load.get("cpu_percent", -1))
        mem = float(load.get("memory_percent", -1))
    except (TypeError, ValueError):
        return None
    if cpu < 0 or mem < 0 or cpu > 100 or mem > 100:
        return None
    score_raw = load.get("score")
    if score_raw is None:
        score = 0.5 * cpu + 0.5 * mem
    else:
        score = float(score_raw)
    return {
        "cpu_percent": round(cpu, 1),
        "memory_percent": round(mem, 1),
        "score": round(score, 1),
    }


def _worker_eligible_for_claim(worker_id: str) -> bool:
    """Só permite claim se o worker estiver entre os menos carregados da frota."""
    if not _fleet_load_balance_enabled():
        return True
    wid = (worker_id or "").strip()
    my_load = _system_load_from_meta(_worker_registry().get(wid, (None, {}))[1])
    if my_load is None:
        return True

    online_scores: list[float] = []
    for other_id, (_ts, other_meta) in _worker_registry().items():
        if not _is_worker_recently_alive(other_id):
            continue
        load = _system_load_from_meta(other_meta)
        if load is not None:
            online_scores.append(load["score"])

    if not online_scores:
        return True

    min_score = min(online_scores)
    return my_load["score"] <= min_score + _load_score_margin()


def _is_worker_recently_alive(worker_id: str, max_age_sec: Optional[int] = None) -> bool:
    wid = (worker_id or "").strip()
    if not wid:
        return False
    entry = _worker_registry().get(wid)
    if not entry:
        return False
    last = entry[0]
    limit = max_age_sec if max_age_sec is not None else _worker_heartbeat_stale_seconds()
    return (datetime.now() - last).total_seconds() <= limit


def _requeue_processing_job(job_id: int, motivo: str) -> bool:
    ensure_papelaria_jobs_tables()
    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(pending)s,
            WorkerID = NULL,
            IniciadoEm = NULL,
            Erro = %(erro)s
        WHERE ID = %(id)s AND Status = %(processing)s
        """,
        {
            "id": job_id,
            "pending": STATUS_PENDING,
            "processing": STATUS_PROCESSING,
            "erro": (motivo or "Reenfileirado.")[:4000],
        },
    )
    rows = db.execute_query(
        "SELECT ID FROM tabPapelariaJobs WHERE ID = %(id)s AND Status = %(pending)s",
        {"id": job_id, "pending": STATUS_PENDING},
    )
    if not rows:
        return False
    append_job_log(job_id, motivo[:4000], "warning")
    updated = get_job(job_id, recover_stale=False)
    if updated:
        broadcast_job_update(updated)
    return True


def requeue_orphaned_jobs_for_worker(
    worker_id: str,
    motivo: str = "Worker reiniciado — job reenfileirado.",
) -> list[int]:
    """Reenfileira jobs em processamento atribuídos ao worker (ex.: após reinício)."""
    ensure_papelaria_jobs_tables()
    wid = (worker_id or "").strip()
    if not wid:
        return []
    rows = db.execute_query(
        """
        SELECT ID FROM tabPapelariaJobs
        WHERE Status = %(processing)s AND WorkerID = %(worker_id)s
        ORDER BY ID ASC
        """,
        {"processing": STATUS_PROCESSING, "worker_id": wid},
    )
    requeued: list[int] = []
    for row in rows or []:
        job_id = int(row["ID"])
        if _requeue_processing_job(job_id, motivo):
            requeued.append(job_id)
    if requeued:
        logger.info(
            "Jobs reenfileirados para worker %s: %s",
            wid,
            requeued,
        )
    return requeued


def maybe_recover_processing_job(job_id: int) -> bool:
    """
    Se o job está em processing sem worker ativo, volta para pending.
    Chamado em consultas da UI e antes do claim.
    """
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        """
        SELECT ID, Status, WorkerID, IniciadoEm
        FROM tabPapelariaJobs
        WHERE ID = %(id)s
        LIMIT 1
        """,
        {"id": job_id},
    )
    if not rows:
        return False
    row = rows[0]
    if (row.get("Status") or "") != STATUS_PROCESSING:
        return False

    iniciado = row.get("IniciadoEm")
    if not isinstance(iniciado, datetime):
        return False

    age_sec = (datetime.now() - iniciado).total_seconds()
    worker_id = (row.get("WorkerID") or "").strip()
    stale_sec = _worker_heartbeat_stale_seconds()
    stall_sec = _job_stall_seconds()
    max_sec = _processing_max_seconds()

    if age_sec >= stall_sec and not _is_worker_recently_alive(
        worker_id, max_age_sec=stall_sec
    ):
        return _requeue_processing_job(
            job_id,
            (
                f"Worker não respondeu em {stall_sec} segundos — "
                "job redirecionado para outro worker."
            ),
        )

    if age_sec >= max_sec:
        return _requeue_processing_job(
            job_id,
            "Tempo máximo de processamento excedido — reenfileirado.",
        )

    if age_sec >= stale_sec and not _is_worker_recently_alive(worker_id):
        return _requeue_processing_job(
            job_id,
            "Worker interrompido — reenfileirado para nova tentativa.",
        )
    return False


def recover_stale_processing_jobs() -> list[int]:
    """Varre todos os jobs em processing e reenfileira os órfãos."""
    ensure_papelaria_jobs_tables()
    rows = db.execute_query(
        "SELECT ID FROM tabPapelariaJobs WHERE Status = %(processing)s ORDER BY ID ASC",
        {"processing": STATUS_PROCESSING},
    )
    recovered: list[int] = []
    for row in rows or []:
        job_id = int(row["ID"])
        if maybe_recover_processing_job(job_id):
            recovered.append(job_id)
    return recovered


def record_worker_heartbeat(worker_id: str, meta: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    wid = (worker_id or "").strip()
    if not wid:
        raise ValueError("worker_id é obrigatório.")
    now = datetime.now()
    _worker_heartbeats[wid] = now
    meta = meta or {}
    _worker_meta[wid] = meta
    try:
        _persist_worker_heartbeat(wid, now, meta)
    except Exception as exc:
        logger.warning("Falha ao persistir heartbeat do worker %s: %s", wid, exc)
    requeued: list[int] = []
    if meta.get("event") == "startup":
        requeued = requeue_orphaned_jobs_for_worker(wid)
    cancelled_job_id: Optional[int] = None
    cancelled_reason: Optional[str] = None
    processing_job_id = meta.get("processing_job_id")
    if processing_job_id is not None:
        try:
            pid = int(processing_job_id)
        except (TypeError, ValueError):
            pid = 0
        if pid > 0:
            maybe_recover_processing_job(pid)
            cancelado, motivo = _job_cancelled_for_worker(pid, wid)
            if cancelado:
                cancelled_job_id = pid
                cancelled_reason = motivo
    return {
        "worker_id": wid,
        "status": "ok",
        "heartbeat_em": now.isoformat(sep=" ", timespec="seconds"),
        "meta": meta,
        "requeued_jobs": requeued,
        "cancelled_job_id": cancelled_job_id,
        "cancelled_reason": cancelled_reason,
    }


def list_worker_heartbeats() -> list[dict[str, Any]]:
    now = datetime.now()
    stale_sec = _worker_heartbeat_stale_seconds()
    workers: list[dict[str, Any]] = []
    for wid, (ts, meta) in sorted(_worker_registry().items()):
        age = (now - ts).total_seconds()
        load = _system_load_from_meta(meta)
        entry: dict[str, Any] = {
            "worker_id": wid,
            "heartbeat_em": ts.isoformat(sep=" ", timespec="seconds"),
            "online": age <= stale_sec,
            "seconds_since_heartbeat": int(age),
        }
        if load is not None:
            entry["cpu_percent"] = load["cpu_percent"]
            entry["memory_percent"] = load["memory_percent"]
            entry["load_score"] = load["score"]
        workers.append(entry)
    return workers


def get_admin_worker_queue_snapshot(
    *,
    fila_limit: int = 80,
    recentes_limit: int = 25,
) -> dict[str, Any]:
    """Painel admin: fila ativa, workers e totais por status."""
    ensure_papelaria_jobs_tables()
    recover_stale_processing_jobs()

    count_rows = db.execute_query(
        """
        SELECT Status, COUNT(*) AS total
        FROM tabPapelariaJobs
        GROUP BY Status
        """
    )
    totais = {status: 0 for status in (
        STATUS_PENDING,
        STATUS_PROCESSING,
        STATUS_COMPLETED,
        STATUS_FAILED,
        STATUS_CANCELLED,
    )}
    for row in count_rows or []:
        status = row.get("Status") or ""
        if status in totais:
            totais[status] = int(row.get("total") or 0)

    fila_rows = db.execute_query(
        """
        SELECT * FROM tabPapelariaJobs
        WHERE Status IN (%(pending)s, %(processing)s)
        ORDER BY
          CASE Status WHEN %(processing)s THEN 0 ELSE 1 END,
          COALESCE(OrdemFila, 999999),
          Prioridade DESC,
          ID ASC
        LIMIT %(limit)s
        """,
        {
            "pending": STATUS_PENDING,
            "processing": STATUS_PROCESSING,
            "limit": max(1, min(fila_limit, 200)),
        },
    )

    recent_rows = db.execute_query(
        """
        SELECT * FROM tabPapelariaJobs
        WHERE Status IN (%(completed)s, %(failed)s, %(cancelled)s)
        ORDER BY COALESCE(ConcluidoEm, SolicitadoEm) DESC, ID DESC
        LIMIT %(limit)s
        """,
        {
            "completed": STATUS_COMPLETED,
            "failed": STATUS_FAILED,
            "cancelled": STATUS_CANCELLED,
            "limit": max(1, min(recentes_limit, 100)),
        },
    )

    workers = list_worker_heartbeats()
    now = datetime.now()
    return {
        "atualizado_em": now.isoformat(sep=" ", timespec="seconds"),
        "totais": totais,
        "workers": workers,
        "workers_online": sum(1 for w in workers if w.get("online")),
        "fila": [_row_to_job(row) for row in fila_rows or []],
        "recentes": [_row_to_job(row) for row in recent_rows or []],
    }


def resolve_os_papelaria_dir(ano: int, nro: int, create: bool = True) -> str:
    """Retorna caminho absoluto de {pasta_os}/Sefoc (artefatos Corel/PDF)."""
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")

    sefoc_dir = os.path.normpath(os.path.join(os_path, "Sefoc"))
    if create:
        os.makedirs(sefoc_dir, exist_ok=True)
    return sefoc_dir


def get_os_folder_basename(ano: int, nro: int) -> str:
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")
    return os.path.basename(os.path.normpath(os_path))


def _sanitize_relative_filename(name: str) -> str:
    text = (name or "").strip().replace("\\", "/")
    if not text or ".." in text or text.startswith("/"):
        raise ValueError("Nome de arquivo inválido.")
    base = os.path.basename(text)
    if not base or _UNSAFE_FILENAME.search(base):
        raise ValueError("Nome de arquivo inválido.")
    return base


def _max_prova_sefoc_version(sefoc_dir: str, prefix: str, nro: int) -> int:
    """Maior versão de prova já existente (padrão novo ou legado ProvaN_SEFOC)."""
    num_os = f"{int(nro):05d}"
    pattern_new = re.compile(
        rf"^{re.escape(prefix)}-ProvaSefoc (\d+)\.pdf$",
        re.IGNORECASE,
    )
    pattern_legacy = re.compile(
        rf"^{num_os}.*-Prova(\d+)_SEFOC\.pdf$",
        re.IGNORECASE,
    )
    max_ver = 0
    if not os.path.isdir(sefoc_dir):
        return max_ver
    for fname in os.listdir(sefoc_dir):
        for pattern in (pattern_new, pattern_legacy):
            match = pattern.match(fname)
            if match:
                max_ver = max(max_ver, int(match.group(1)))
                break
    return max_ver


def extract_prova_version_from_filename(filename: str) -> Optional[int]:
    """Extrai o número x de *-ProvaSefoc {x}.pdf ou legado Prova{x}_SEFOC."""
    base = os.path.basename((filename or "").strip())
    match = re.search(r"ProvaSefoc (\d+)\.pdf$", base, re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.search(r"Prova(\d+)_SEFOC\.pdf$", base, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


def build_output_filenames(ano: int, nro: int) -> tuple[str, str]:
    """
    Nomenclatura Sefoc:
    - CDR: {NUMOS-NomePastaOS}-BaseSefoc.cdr (substitui se já existir)
    - PDF: {NUMOS-NomePastaOS}-ProvaSefoc {x}.pdf (x = próxima versão)
    """
    prefix = get_os_folder_basename(ano, nro)
    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    cdr_name = f"{prefix}-BaseSefoc.cdr"
    next_ver = _max_prova_sefoc_version(sefoc_dir, prefix, nro) + 1
    pdf_name = f"{prefix}-ProvaSefoc {next_ver}.pdf"
    return cdr_name, pdf_name


def build_worker_job_payload(job_id: int) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")

    output_dir = resolve_os_papelaria_dir(
        job["ano_protocolo"],
        job["nro_protocolo"],
        create=True,
    )
    cdr_name, pdf_name = build_output_filenames(
        job["ano_protocolo"],
        job["nro_protocolo"],
    )

    if job["tipo_job"] == TIPO_JOB_CREDENCIAIS_DEPOL:
        return {
            "job_id": job["id"],
            "ano": job["ano_protocolo"],
            "nro": job["nro_protocolo"],
            "tipo_job": job["tipo_job"],
            "produto": job["produto"],
            "modelo_id": None,
            "arquivo_modelo": "",
            "campos": {},
            "dados": dict(job.get("dados") or {}),
            "campos_dinamicos_layout": {},
            "exclusoes": [],
            "preview_config": None,
            "frente_versao": None,
            "cores": None,
            "output_dir": output_dir,
            "output_cdr_name": cdr_name,
            "output_pdf_name": pdf_name,
            "tentativas": job.get("tentativas") or 0,
        }

    from services import papelaria_models_service as models_svc

    modelo = models_svc.get_modelo_by_id(job["modelo_id"] or 0)
    if not modelo:
        raise LookupError("Modelo do job não encontrado ou inativo.")

    dados = dict(job.get("dados") or {})
    campos_dinamicos_layout: dict[str, Any] = {}
    layout_raw = dados.pop("__campos_dinamicos_layout", None)
    if layout_raw:
        try:
            parsed_layout = json.loads(layout_raw) if isinstance(layout_raw, str) else layout_raw
            if isinstance(parsed_layout, dict):
                campos_dinamicos_layout = parsed_layout
        except json.JSONDecodeError:
            logger.warning("Job %s: layout campos dinâmicos inválido — ignorado.", job_id)

    exclusoes: list[str] = []
    exclusoes_raw = dados.pop("__exclusoes", None)
    if exclusoes_raw:
        try:
            parsed_exclusoes = json.loads(exclusoes_raw) if isinstance(exclusoes_raw, str) else exclusoes_raw
            if isinstance(parsed_exclusoes, list):
                exclusoes = [str(item) for item in parsed_exclusoes]
        except json.JSONDecodeError:
            logger.warning("Job %s: exclusões inválidas — ignorado.", job_id)

    input_cdr_rel = dados.pop(INPUT_CDR_DADOS_KEY, None)

    preview_config: dict[str, Any] | None = None
    preview_raw = modelo.get("preview_config_json")
    if preview_raw:
        try:
            from services import papelaria_live_preview_service as preview_svc

            preview_config = preview_svc.parse_preview_config_json(preview_raw)
        except ValueError:
            preview_config = None

    from services.papelaria_live_preview_service import overlay_campos_com_templates_preview

    payload: dict[str, Any] = {
        "job_id": job["id"],
        "ano": job["ano_protocolo"],
        "nro": job["nro_protocolo"],
        "tipo_job": job["tipo_job"],
        "produto": job["produto"],
        "modelo_id": job["modelo_id"],
        "arquivo_modelo": job["arquivo_modelo"],
        "campos": overlay_campos_com_templates_preview(
            modelo.get("campos") or {},
            preview_config,
        ),
        "dados": dados,
        "campos_dinamicos_layout": campos_dinamicos_layout,
        "exclusoes": exclusoes,
        "preview_config": preview_config,
        "frente_versao": modelo.get("frente_versao"),
        "cores": modelo.get("cores"),
        "output_dir": output_dir,
        "output_cdr_name": cdr_name,
        "output_pdf_name": pdf_name,
        "tentativas": job.get("tentativas") or 0,
    }

    if job["tipo_job"] == TIPO_JOB_EXPORT_EXISTING_CDR:
        payload["input_cdr_path"] = resolve_export_input_cdr_path(
            job["ano_protocolo"],
            job["nro_protocolo"],
            input_cdr_rel,
        )

    return payload


def claim_next_job(worker_id: str) -> Optional[dict[str, Any]]:
    ensure_papelaria_jobs_tables()
    wid = (worker_id or "").strip()
    if not wid:
        raise ValueError("worker_id é obrigatório.")

    recover_stale_processing_jobs()

    if not _worker_eligible_for_claim(wid):
        return None

    def _claim(cursor) -> Optional[int]:
        cursor.execute(
            """
            SELECT ID FROM tabPapelariaJobs
            WHERE Status = %(pending)s
            ORDER BY Prioridade DESC, OrdemFila ASC, ID ASC
            LIMIT 1
            FOR UPDATE
            """,
            {"pending": STATUS_PENDING},
        )
        row = cursor.fetchone()
        if not row:
            return None
        job_id = int(row["ID"])
        cursor.execute(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(processing)s,
                WorkerID = %(worker_id)s,
                IniciadoEm = NOW(),
                Tentativas = Tentativas + 1
            WHERE ID = %(id)s AND Status = %(pending)s
            """,
            {
                "id": job_id,
                "processing": STATUS_PROCESSING,
                "worker_id": wid,
                "pending": STATUS_PENDING,
            },
        )
        if cursor.rowcount == 0:
            return None
        return job_id

    results = db.execute_transaction([_claim])
    job_id = results[0] if results else None
    if not job_id:
        return None

    append_job_log(job_id, f"Job reivindicado pelo worker {wid}.", "info")
    try:
        payload = build_worker_job_payload(job_id)
    except LookupError as exc:
        # Job já está processing; sem fail o front fica em "Processando" e o worker
        # não consegue chamar /fail (não recebeu job_id).
        fail_job(job_id, wid, str(exc), retryable=False)
        raise
    job = get_job(job_id)
    if job:
        broadcast_job_update(job)
    return payload


def _assert_worker_owns_processing_job(job_id: int, worker_id: str) -> dict[str, Any]:
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    if job["status"] != STATUS_PROCESSING:
        raise ValueError(f"Job não está em processamento (status: {job['status']}).")
    if (job.get("worker_id") or "").strip() != (worker_id or "").strip():
        raise ValueError("Job está sendo processado por outro worker.")
    return job


def complete_job(
    job_id: int,
    worker_id: str,
    arquivo_cdr: str,
    arquivo_pdf: str,
    log_resumo: Optional[str] = None,
) -> dict[str, Any]:
    ensure_papelaria_jobs_tables()
    if is_job_cancelled(job_id):
        raise ValueError("Job foi cancelado pelo usuário.")
    job = _assert_worker_owns_processing_job(job_id, worker_id)

    cdr_rel = _sanitize_relative_filename(arquivo_cdr)
    pdf_rel = _sanitize_relative_filename(arquivo_pdf)

    output_dir = resolve_os_papelaria_dir(
        job["ano_protocolo"],
        job["nro_protocolo"],
        create=False,
    )
    pdf_abs = os.path.normpath(os.path.join(output_dir, pdf_rel))

    if job.get("tipo_job") == TIPO_JOB_EXPORT_EXISTING_CDR:
        dados_job = job.get("dados") or {}
        cdr_abs = resolve_export_input_cdr_path(
            job["ano_protocolo"],
            job["nro_protocolo"],
            dados_job.get(INPUT_CDR_DADOS_KEY) if isinstance(dados_job, dict) else None,
        )
        cdr_rel = os.path.basename(cdr_abs)
        paths_to_check = (pdf_abs,)
    else:
        cdr_abs = os.path.normpath(os.path.join(output_dir, cdr_rel))
        paths_to_check = (cdr_abs, pdf_abs)

    for path in paths_to_check:
        real_file = os.path.realpath(path)
        real_base = os.path.realpath(output_dir)
        if not real_base.endswith(os.sep):
            real_base = real_base + os.sep
        if not real_file.startswith(real_base):
            raise ValueError("Caminho de arquivo inválido.")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"Arquivo não encontrado no destino: {os.path.basename(path)}")

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(status)s,
            ArquivoCdrGerado = %(cdr)s,
            ArquivoPdfGerado = %(pdf)s,
            ProvaRevisao = %(prova_revisao)s,
            ConcluidoEm = NOW(),
            Erro = NULL
        WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
        """,
        {
            "id": job_id,
            "status": STATUS_COMPLETED,
            "cdr": cdr_rel,
            "pdf": pdf_rel,
            "prova_revisao": PROVA_REVISAO_PENDING,
            "processing": STATUS_PROCESSING,
            "worker_id": worker_id.strip(),
        },
    )

    updated = get_job(job_id)
    if not updated or updated["status"] != STATUS_COMPLETED:
        raise ValueError("Job não pôde ser concluído (status alterado).")

    msg = log_resumo or "Geração concluída com sucesso. Aguardando aprovação do técnico."
    append_job_log(job_id, msg[:4000], "info")
    broadcast_job_update(updated)
    if updated.get("tipo_job") == TIPO_JOB_CREDENCIAIS_DEPOL:
        try:
            from services import credenciais_depol_service as depol_svc

            depol_svc.on_job_completed(updated)
        except Exception as exc:
            logger.warning("Hook Credenciais DEPOL complete falhou (job %s): %s", job_id, exc)
    return updated


def fail_job(
    job_id: int,
    worker_id: str,
    erro: str,
    log_resumo: Optional[str] = None,
    retryable: bool = False,
) -> dict[str, Any]:
    ensure_papelaria_jobs_tables()
    if is_job_cancelled(job_id):
        raise ValueError("Job foi cancelado pelo usuário.")
    job = _assert_worker_owns_processing_job(job_id, worker_id)
    tentativas = int(job.get("tentativas") or 0)
    erro_msg = (erro or "Falha desconhecida.")[:4000]

    if retryable and tentativas < MAX_WORKER_RETRIES:
        db.execute_query(
            """
            UPDATE tabPapelariaJobs
            SET Status = %(pending)s,
                WorkerID = NULL,
                IniciadoEm = NULL,
                Erro = %(erro)s
            WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
            """,
            {
                "id": job_id,
                "pending": STATUS_PENDING,
                "erro": erro_msg,
                "processing": STATUS_PROCESSING,
                "worker_id": worker_id.strip(),
            },
        )
        updated = get_job(job_id)
        if not updated:
            raise RuntimeError("Falha ao reenfileirar job.")
        append_job_log(
            job_id,
            f"Falha retryable — reenfileirado (tentativa {tentativas}/{MAX_WORKER_RETRIES}).",
            "warning",
            {"erro": erro_msg},
        )
        if log_resumo:
            append_job_log(job_id, log_resumo[:4000], "error")
        broadcast_job_update(updated)
        return updated

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET Status = %(status)s,
            Erro = %(erro)s,
            ConcluidoEm = NOW()
        WHERE ID = %(id)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
        """,
        {
            "id": job_id,
            "status": STATUS_FAILED,
            "erro": erro_msg,
            "processing": STATUS_PROCESSING,
            "worker_id": worker_id.strip(),
        },
    )

    updated = get_job(job_id)
    if not updated or updated["status"] != STATUS_FAILED:
        raise ValueError("Job não pôde ser marcado como falha.")

    append_job_log(job_id, erro_msg, "error")
    if log_resumo and log_resumo != erro_msg:
        append_job_log(job_id, log_resumo[:4000], "error")
    broadcast_job_update(updated)
    if updated.get("tipo_job") == TIPO_JOB_CREDENCIAIS_DEPOL:
        try:
            from services import credenciais_depol_service as depol_svc

            depol_svc.on_job_failed(updated)
        except Exception as exc:
            logger.warning("Hook Credenciais DEPOL fail falhou (job %s): %s", job_id, exc)
    return updated


def worker_append_log(
    job_id: int,
    worker_id: str,
    mensagem: str,
    nivel: str = "info",
    detalhe: Optional[dict[str, Any]] = None,
) -> None:
    _assert_worker_owns_processing_job(job_id, worker_id)
    append_job_log(job_id, mensagem, nivel, detalhe)


def resolve_job_file_path(job_id: int, tipo: str) -> tuple[str, str]:
    """Retorna (caminho_absoluto, nome_download) — apenas backend."""
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")

    if job["status"] != STATUS_COMPLETED:
        raise FileNotFoundError(
            "Arquivo ainda não disponível. Aguardando processamento pelo worker CorelDRAW."
        )

    col_map = {"pdf": "ArquivoPdfGerado", "cdr": "ArquivoCdrGerado"}
    tipo_l = (tipo or "").strip().lower()
    if tipo_l not in col_map:
        raise ValueError("Tipo de arquivo inválido. Use 'pdf' ou 'cdr'.")

    rows = db.execute_query(
        f"SELECT {col_map[tipo_l]} AS path, NroProtocolo, AnoProtocolo "
        f"FROM tabPapelariaJobs WHERE ID = %(id)s",
        {"id": job_id},
    )
    rel_path = (rows[0].get("path") or "").strip() if rows else ""
    if not rel_path:
        raise FileNotFoundError(
            "Arquivo ainda não disponível. Aguardando processamento pelo worker CorelDRAW."
        )

    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(job["ano_protocolo"], job["nro_protocolo"])
    if not os_path:
        raise FileNotFoundError("Pasta da OS não encontrada.")

    sefoc_base = os.path.normpath(os.path.join(os_path, "Sefoc"))
    rel_norm = rel_path.replace("\\", "/")
    candidates = [
        os.path.normpath(os.path.join(sefoc_base, rel_norm)),
        os.path.normpath(os.path.join(sefoc_base, "Papelaria", rel_norm)),
    ]
    full_path = candidates[0]
    for candidate in candidates:
        if os.path.isfile(candidate):
            full_path = candidate
            break

    try:
        real_file = os.path.realpath(full_path)
        real_base = os.path.realpath(sefoc_base)
        if not real_base.endswith(os.sep):
            real_base = real_base + os.sep
        if not real_file.startswith(real_base):
            raise ValueError("Caminho de arquivo inválido.")
    except OSError as exc:
        raise FileNotFoundError("Arquivo não encontrado.") from exc

    if not os.path.isfile(full_path):
        raise FileNotFoundError(
            "Arquivo ainda não disponível. Aguardando processamento pelo worker CorelDRAW."
        )

    return full_path, os.path.basename(full_path)


def _assert_job_pending_prova_review(job: dict[str, Any]) -> None:
    if job.get("status") != STATUS_COMPLETED:
        raise ValueError("Job não está concluído.")
    revisao = job.get("prova_revisao")
    if revisao == PROVA_REVISAO_APPROVED:
        raise ValueError("Prova já foi aprovada.")
    if revisao == PROVA_REVISAO_DISCARDED:
        raise ValueError("Prova já foi descartada.")
    if revisao and revisao != PROVA_REVISAO_PENDING:
        raise ValueError("Prova não está aguardando revisão.")
    if not job.get("arquivo_pdf"):
        raise ValueError("Job não possui PDF de prova gerado.")


def _cleanup_job_preview_cache(job: dict[str, Any]) -> None:
    try:
        from services.papelaria_preview_service import _preview_dir_for_job

        sefoc_base = resolve_os_papelaria_dir(
            job["ano_protocolo"],
            job["nro_protocolo"],
            create=False,
        )
        cache_dir = _preview_dir_for_job(sefoc_base, int(job["id"]))
        if os.path.isdir(cache_dir):
            shutil.rmtree(cache_dir, ignore_errors=True)
    except Exception as exc:
        logger.warning(
            "Falha ao limpar cache de prévia do job %s: %s", job.get("id"), exc
        )


def approve_job_prova(job_id: int, aprovado_por: str) -> dict[str, Any]:
    """Aprova PDF gerado: andamento SEFOC + token de prova para envio por e-mail."""
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    _assert_job_pending_prova_review(job)

    pdf_name = str(job["arquivo_pdf"])
    prova_ver = extract_prova_version_from_filename(pdf_name)
    if prova_ver is None:
        raise ValueError("Não foi possível identificar a versão da prova no arquivo.")

    ano = int(job["ano_protocolo"])
    nro = int(job["nro_protocolo"])
    ponto = (aprovado_por or "").strip()
    obs = f"Enviar Prova {prova_ver}"

    def _approve_tx(cursor):
        from routers.analise_routes import add_movement_internal

        cod = add_movement_internal(
            cursor, nro, ano, "Encam. de Docum.", "SEFOC", ponto, obs
        )
        cursor.execute(
            """
            UPDATE tabPapelariaJobs
            SET ProvaRevisao = %(revisao)s
            WHERE ID = %(id)s AND Status = %(completed)s
              AND (
                ProvaRevisao = %(pending)s
                OR ProvaRevisao IS NULL
                OR TRIM(ProvaRevisao) = ''
              )
            """,
            {
                "revisao": PROVA_REVISAO_APPROVED,
                "id": job_id,
                "completed": STATUS_COMPLETED,
                "pending": PROVA_REVISAO_PENDING,
            },
        )
        if cursor.rowcount != 1:
            raise ValueError("Prova não pôde ser aprovada (status alterado).")
        return cod

    cod_status = db.execute_transaction([_approve_tx])[0]

    from routers.proof_portal_routes import ensure_proof_token

    proof_token = ensure_proof_token(
        nro,
        ano,
        str(prova_ver),
        pdf_name,
        ponto_envio=ponto,
    )

    try:
        pdf_path, _ = resolve_job_file_path(job_id, "pdf")
        rows = db.execute_query(
            """
            SELECT ID FROM tabProofTokens
            WHERE Token = %s AND NroProtocolo = %s AND AnoProtocolo = %s
            LIMIT 1
            """,
            (proof_token, nro, ano),
        )
        if rows:
            from services import papelaria_preview_service as preview_svc

            preview_svc.ensure_proof_preview_pages(
                ano, nro, int(rows[0]["ID"]), pdf_path
            )
    except Exception as exc:
        logger.warning(
            "Prévia portal não pré-gerada para job %s (OS %s/%s): %s",
            job_id,
            nro,
            ano,
            exc,
        )

    append_job_log(
        job_id,
        f"Prova v{prova_ver} aprovada por {ponto}. Andamento Encam. de Docum. registrado.",
        "info",
    )

    from routers.realtime import broadcast_os_system_update

    broadcast_os_system_update(
        nro,
        ano,
        "papelaria_aprovar_prova",
        setor="SEFOC",
        origem="papelaria",
    )

    if cod_status:
        from routers.mdb_writer import push_andamento_to_mdb_after_mysql

        push_andamento_to_mdb_after_mysql(
            cod_status,
            nro,
            ano,
            operation="insert",
            task_name="papelaria_aprovar_prova",
        )

    updated = get_job(job_id)
    if updated:
        broadcast_job_update(updated)
    return {
        "job": updated,
        "cod_status": cod_status,
        "prova_versao": prova_ver,
        "proof_token": proof_token,
    }


def discard_job_prova(job_id: int, descartado_por: str) -> dict[str, Any]:
    """Descarta PDF gerado e reverte para a versão anterior de prova na pasta Sefoc."""
    ensure_papelaria_jobs_tables()
    job = get_job(job_id)
    if not job:
        raise LookupError("Job não encontrado.")
    _assert_job_pending_prova_review(job)

    pdf_name = str(job["arquivo_pdf"])
    prova_ver = extract_prova_version_from_filename(pdf_name)
    output_dir = resolve_os_papelaria_dir(
        job["ano_protocolo"],
        job["nro_protocolo"],
        create=False,
    )
    pdf_abs = os.path.normpath(os.path.join(output_dir, pdf_name))
    real_file = os.path.realpath(pdf_abs)
    real_base = os.path.realpath(output_dir)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if real_file.startswith(real_base) and os.path.isfile(pdf_abs):
        os.remove(pdf_abs)

    _cleanup_job_preview_cache(job)

    db.execute_query(
        """
        UPDATE tabPapelariaJobs
        SET ArquivoPdfGerado = NULL,
            ProvaRevisao = %(revisao)s
        WHERE ID = %(id)s AND Status = %(completed)s
          AND (
            ProvaRevisao = %(pending)s
            OR ProvaRevisao IS NULL
            OR TRIM(ProvaRevisao) = ''
          )
        """,
        {
            "revisao": PROVA_REVISAO_DISCARDED,
            "id": job_id,
            "completed": STATUS_COMPLETED,
            "pending": PROVA_REVISAO_PENDING,
        },
    )

    updated = get_job(job_id)
    if not updated or updated.get("prova_revisao") != PROVA_REVISAO_DISCARDED:
        raise ValueError("Prova não pôde ser descartada (status alterado).")

    actor = (descartado_por or "").strip()
    ver_label = prova_ver if prova_ver is not None else "?"
    append_job_log(
        job_id,
        f"Prova v{ver_label} descartada por {actor}. PDF removido da pasta Sefoc.",
        "info",
    )
    broadcast_job_update(updated)
    return updated


def register_preparando_prova_andamento(ano: int, nro: int, ponto: str) -> str:
    """Registra andamento Em Execução / Preparando Prova (SEFOC)."""
    ensure_papelaria_jobs_tables()
    _validate_os_exists(ano, nro)
    ponto_clean = (ponto or "").strip()
    if not ponto_clean:
        raise ValueError("Ponto do usuário é obrigatório.")

    def _tx(cursor):
        from routers.analise_routes import add_movement_internal

        return add_movement_internal(
            cursor, nro, ano, "Em Execução", "SEFOC", ponto_clean, "Preparando Prova"
        )

    cod_status = db.execute_transaction([_tx])[0]

    from routers.realtime import broadcast_os_system_update

    broadcast_os_system_update(nro, ano, "papelaria_preparando_prova", setor="SEFOC", origem="papelaria")

    if cod_status:
        from routers.mdb_writer import push_andamento_to_mdb_after_mysql

        push_andamento_to_mdb_after_mysql(
            cod_status,
            nro,
            ano,
            operation="insert",
            task_name="papelaria_preparando_prova",
        )

    return cod_status


def _is_backup_cdr_filename(filename: str) -> bool:
    return CDR_BACKUP_NAME_FRAGMENT in (filename or "").lower()


def _is_usable_os_cdr_filename(filename: str) -> bool:
    if not (filename or "").lower().endswith(".cdr"):
        return False
    return not _is_backup_cdr_filename(filename)


def _normalize_os_relative_cdr(value: str) -> str:
    text = (value or "").strip().replace("\\", "/")
    if not text or text.startswith("/") or text.startswith("./"):
        raise ValueError("Nome de arquivo Corel inválido.")
    parts = [p for p in text.split("/") if p]
    if not parts or any(p in (".", "..") for p in parts) or ":" in text:
        raise ValueError("Nome de arquivo Corel inválido.")
    return "/".join(parts)


def _assert_file_under_os_root(path: str, os_root: str) -> str:
    real_file = os.path.realpath(path)
    real_base = os.path.realpath(os_root)
    if not real_base.endswith(os.sep):
        real_base = real_base + os.sep
    if not real_file.startswith(real_base):
        raise ValueError("Caminho de arquivo inválido.")
    return real_file


def _relative_cdr_from_os_root(os_root: str, abs_path: str) -> str:
    rel = os.path.relpath(abs_path, os_root).replace("\\", "/")
    return _normalize_os_relative_cdr(rel)


def list_os_usable_cdrs(ano: int, nro: int) -> list[dict[str, Any]]:
    """
    Lista .cdr utilizáveis na pasta da OS (Sefoc, Sefoc/Papelaria e raiz).
    Ignora arquivos cujo nome contém 'Cópia_de_segurança'.
    Ordena preferindo {prefix}-BaseSefoc.cdr e, em seguida, o mais recente.
    """
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")

    os_root = os.path.normpath(os_path)
    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    prefix = get_os_folder_basename(ano, nro)
    standard_name = f"{prefix}-BaseSefoc.cdr"
    ranked: list[tuple[int, float, str]] = []
    seen: set[str] = set()

    def _scan(directory: str, *, priority_offset: int) -> None:
        if not os.path.isdir(directory):
            return
        for fname in os.listdir(directory):
            if not _is_usable_os_cdr_filename(fname):
                continue
            path = os.path.normpath(os.path.join(directory, fname))
            if not os.path.isfile(path):
                continue
            try:
                real = _assert_file_under_os_root(path, os_root)
            except ValueError:
                continue
            if real in seen:
                continue
            seen.add(real)
            priority = priority_offset + (0 if fname == standard_name else 1)
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                mtime = 0.0
            ranked.append((priority, mtime, real))

    _scan(sefoc_dir, priority_offset=0)
    _scan(os.path.join(sefoc_dir, "Papelaria"), priority_offset=10)
    _scan(os_root, priority_offset=20)

    ranked.sort(key=lambda item: (item[0], -item[1]))
    result: list[dict[str, Any]] = []
    for _priority, mtime, abs_path in ranked:
        result.append(
            {
                "filename": os.path.basename(abs_path),
                "relative_path": _relative_cdr_from_os_root(os_root, abs_path),
                "absolute_path": abs_path,
                "mtime": mtime,
            }
        )
    return result


def select_os_usable_cdr(
    ano: int,
    nro: int,
    arquivo_cdr: Optional[str] = None,
) -> dict[str, Any]:
    """Escolhe um CDR da pasta da OS; exige arquivo_cdr se houver mais de um."""
    files = list_os_usable_cdrs(ano, nro)
    if not files:
        raise FileNotFoundError(
            "Nenhum arquivo Corel (.cdr) utilizável encontrado na pasta da OS. "
            "Arquivos de cópia de segurança são ignorados."
        )

    requested = (arquivo_cdr or "").strip()
    if requested:
        needle = _normalize_os_relative_cdr(requested)
        matches = [item for item in files if item["relative_path"] == needle]
        if not matches:
            basename = os.path.basename(needle).lower()
            by_name = [
                item for item in files if item["filename"].lower() == basename
            ]
            if len(by_name) == 1:
                matches = by_name
        if not matches:
            raise ValueError(
                "O arquivo Corel informado não foi encontrado na pasta da OS."
            )
        return matches[0]

    if len(files) > 1:
        raise ValueError(
            "Há mais de um arquivo Corel na pasta da OS. Informe qual deve ser usado."
        )
    return files[0]


def resolve_os_relative_cdr_path(ano: int, nro: int, relative_path: str) -> str:
    """Resolve um caminho relativo à pasta da OS para um .cdr existente."""
    from routers.os_routes import _get_os_folder_path

    os_path = _get_os_folder_path(ano, nro)
    if not os_path:
        raise LookupError("Pasta da OS não encontrada na rede.")
    os_root = os.path.normpath(os_path)
    rel = _normalize_os_relative_cdr(relative_path)
    abs_path = os.path.normpath(os.path.join(os_root, rel.replace("/", os.sep)))
    real = _assert_file_under_os_root(abs_path, os_root)
    if not os.path.isfile(real):
        raise FileNotFoundError(
            f"Corel da OS não encontrado: {os.path.basename(real)}"
        )
    if not _is_usable_os_cdr_filename(os.path.basename(real)):
        raise ValueError("Arquivo Corel inválido.")
    return real


def resolve_export_input_cdr_path(
    ano: int,
    nro: int,
    relative_path: Optional[str],
) -> str:
    """Caminho absoluto do CDR persistido no job; rediscovery só para jobs antigos."""
    if relative_path and str(relative_path).strip():
        return resolve_os_relative_cdr_path(ano, nro, str(relative_path))
    return discover_os_cdr_absolute_path(ano, nro)


def discover_os_cdr_absolute_path(ano: int, nro: int) -> str:
    """
    Localiza um .cdr utilizável na pasta da OS (Sefoc e raiz da OS).
    Ignora arquivos cujo nome contém 'Cópia_de_segurança'.
    Prefere {prefix}-BaseSefoc.cdr; senão, o mais recente na pasta.
    """
    files = list_os_usable_cdrs(ano, nro)
    if not files:
        raise FileNotFoundError(
            "Nenhum arquivo Corel (.cdr) utilizável encontrado na pasta da OS. "
            "Arquivos de cópia de segurança são ignorados."
        )
    return files[0]["absolute_path"]


def resolve_os_cdr_absolute_path(ano: int, nro: int) -> str:
    """Caminho absoluto de um .cdr utilizável na pasta Sefoc da OS."""
    return discover_os_cdr_absolute_path(ano, nro)


def list_os_cdr_path_payload(ano: int, nro: int) -> dict[str, Any]:
    files = list_os_usable_cdrs(ano, nro)
    if not files:
        raise FileNotFoundError(
            "Nenhum arquivo Corel (.cdr) utilizável encontrado na pasta da OS. "
            "Arquivos de cópia de segurança são ignorados."
        )
    chosen = files[0]
    return {
        "path": chosen["absolute_path"],
        "filename": chosen["filename"],
        "files": [
            {
                "filename": item["filename"],
                "relative_path": item["relative_path"],
                "mtime": item["mtime"],
            }
            for item in files
        ],
    }


def _resolve_prova_pdf_by_version(sefoc_dir: str, prefix: str, nro: int, version: int) -> tuple[str, str]:
    """Retorna (abs_path, basename) para a versão informada."""
    num_os = f"{int(nro):05d}"
    names = [f"{prefix}-ProvaSefoc {version}.pdf"]
    if os.path.isdir(sefoc_dir):
        for fname in os.listdir(sefoc_dir):
            if re.match(rf"^{num_os}.*-Prova{version}_SEFOC\.pdf$", fname, re.IGNORECASE):
                names.append(fname)
    for name in names:
        path = os.path.normpath(os.path.join(sefoc_dir, name))
        if os.path.isfile(path):
            return path, os.path.basename(path)
    raise FileNotFoundError(f"PDF de prova v{version} não encontrado na pasta Sefoc.")


def _job_for_pdf(ano: int, nro: int, pdf_basename: str) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT ID FROM tabPapelariaJobs
        WHERE AnoProtocolo = %(ano)s AND NroProtocolo = %(nro)s
          AND Status = %(completed)s
          AND ArquivoPdfGerado = %(pdf)s
        ORDER BY ID DESC
        LIMIT 1
        """,
        {
            "ano": ano,
            "nro": nro,
            "completed": STATUS_COMPLETED,
            "pdf": pdf_basename,
        },
    )
    if not rows:
        return None
    return get_job(int(rows[0]["ID"]))


def finalize_manual_corel_job(
    ano: int,
    nro: int,
    modelo_id: int,
    dados: dict[str, Any],
    solicitado_por: str,
) -> dict[str, Any]:
    """Registra job concluído após edição manual no CorelDRAW (PDF exportado na pasta Sefoc)."""
    ensure_papelaria_jobs_tables()
    from services import papelaria_models_service as models_svc

    os_row = _validate_os_exists(ano, nro)
    modelo = models_svc.get_modelo_by_id(modelo_id)
    if not modelo:
        raise LookupError("Modelo não encontrado ou inativo.")

    dados_clean = _sanitize_dados(dados)
    missing = _validate_required_fields(modelo, dados_clean)
    if missing:
        raise ValueError(f"Campos obrigatórios ausentes: {', '.join(missing)}")

    sefoc_dir = resolve_os_papelaria_dir(ano, nro, create=False)
    prefix = get_os_folder_basename(ano, nro)
    max_ver = _max_prova_sefoc_version(sefoc_dir, prefix, nro)
    if max_ver < 1:
        raise FileNotFoundError(
            "Nenhum PDF de prova encontrado. Exporte a prova no CorelDRAW antes de finalizar."
        )

    _pdf_abs, pdf_name = _resolve_prova_pdf_by_version(sefoc_dir, prefix, nro, max_ver)
    cdr_path = discover_os_cdr_absolute_path(ano, nro)
    cdr_name = os.path.basename(cdr_path)

    existing = _job_for_pdf(ano, nro, pdf_name)
    if existing:
        revisao = existing.get("prova_revisao")
        if revisao == PROVA_REVISAO_PENDING or revisao is None or str(revisao).strip() == "":
            return existing
        if revisao == PROVA_REVISAO_APPROVED:
            raise ValueError(
                f"A prova v{max_ver} já foi aprovada. Exporte uma nova versão do PDF no CorelDRAW."
            )

    produto_os = (os_row.get("produto") or modelo["produto"] or "").strip()
    produto_job = modelo["produto"]
    ponto = (solicitado_por or "").strip()

    insert_params = {
        "nro": nro,
        "ano": ano,
        "tipo": "manual_corel",
        "produto": produto_job,
        "modelo_id": modelo_id,
        "arquivo": modelo["arquivo_modelo"],
        "dados": json.dumps(dados_clean, ensure_ascii=False),
        "status": STATUS_COMPLETED,
        "ponto": ponto,
        "cdr": cdr_name,
        "pdf": pdf_name,
        "prova_revisao": PROVA_REVISAO_PENDING,
    }

    def _insert(cursor) -> int:
        cursor.execute(
            """
            INSERT INTO tabPapelariaJobs (
                NroProtocolo, AnoProtocolo, TipoJob, Produto, ModeloID, ArquivoModelo,
                DadosJson, Status, Prioridade, OrdemFila, SolicitadoPor, Versao,
                ArquivoCdrGerado, ArquivoPdfGerado, ProvaRevisao, ConcluidoEm
            ) VALUES (
                %(nro)s, %(ano)s, %(tipo)s, %(produto)s, %(modelo_id)s, %(arquivo)s,
                %(dados)s, %(status)s, 0, NULL, %(ponto)s, 1,
                %(cdr)s, %(pdf)s, %(prova_revisao)s, NOW()
            )
            """,
            insert_params,
        )
        return int(cursor.lastrowid)

    job_id = int(db.execute_transaction([_insert])[0])
    job = get_job(job_id)
    if not job:
        raise RuntimeError("Falha ao recuperar job criado.")

    append_job_log(
        job_id,
        f"Prova v{max_ver} registrada após edição manual no CorelDRAW ({pdf_name}).",
        "info",
    )
    warning = _product_match_warning(produto_os, produto_job)
    if warning:
        append_job_log(job_id, warning, "warning")
        job["warnings"] = [warning]

    broadcast_job_update(job)
    return job
