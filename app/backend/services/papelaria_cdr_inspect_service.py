"""Fila de inspeção de .cdr via worker CorelDRAW (objetos nomeados)."""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

from config_manager import PROJECT_ROOT, config_manager
from database import db

from services.papelaria_modelo_admin_service import _sanitize_cdr_filename
from services.papelaria_models_service import (
    COREL_MODELS_DEV_DIR,
    COREL_MODELS_DFS_DIR,
    ORDEM_VARIAVEIS,
    extrair_variaveis,
)

logger = logging.getLogger(__name__)
STATUS_PENDING = "pending"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
INSPECT_TTL_HOURS = 24

_table_ready = False


def ensure_papelaria_cdr_inspect_table() -> None:
    global _table_ready
    if _table_ready:
        return

    sql_path = PROJECT_ROOT / "deploy" / "sql" / "create_papelaria_cdr_inspect.sql"
    if sql_path.is_file():
        raw = sql_path.read_text(encoding="utf-8")
        for stmt in raw.split(";"):
            s = stmt.strip()
            if s:
                db.execute_query(s)

    _table_ready = True
    _ensure_inspect_layout_column()
    logger.info("Tabela tabPapelariaCdrInspect verificada/criada")


def _ensure_inspect_layout_column() -> None:
    rows = db.execute_query(
        """
        SELECT COUNT(*) AS cnt
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tabPapelariaCdrInspect'
          AND COLUMN_NAME = 'LayoutJson'
        """
    )
    if rows and rows[0].get("cnt"):
        return
    try:
        db.execute_query("ALTER TABLE tabPapelariaCdrInspect ADD COLUMN LayoutJson JSON NULL")
    except Exception as exc:
        logger.warning("Migração coluna LayoutJson em tabPapelariaCdrInspect: %s", exc)


def _inspect_dir() -> Path:
    """Diretório onde a API armazena .cdr pendentes de inspeção."""
    env = (os.getenv("SAGRA_PAPELARIA_INSPECT_DIR") or "").strip()
    if env:
        dest = Path(env)
    elif config_manager.is_development():
        dest = COREL_MODELS_DEV_DIR / "_inspect"
    else:
        dest = Path(COREL_MODELS_DFS_DIR) / "_inspect"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def _resolve_stored_cdr_path(stored: str) -> Path:
    """Resolve caminho absoluto a partir do valor persistido (relativo ou legado)."""
    raw = (stored or "").strip()
    if not raw:
        raise FileNotFoundError("Caminho do .cdr não registrado.")

    direct = Path(raw)
    if direct.is_file():
        return direct

    by_name = _inspect_dir() / direct.name
    if by_name.is_file():
        return by_name

    if not direct.is_absolute():
        candidate = _inspect_dir() / raw
        if candidate.is_file():
            return candidate
        return candidate

    return direct


def _ordenar_variaveis(variaveis: set[str]) -> list[str]:
    ordenadas: list[str] = []
    for var in ORDEM_VARIAVEIS:
        if var in variaveis:
            ordenadas.append(var)
    for var in sorted(variaveis):
        if var not in ordenadas:
            ordenadas.append(var)
    return ordenadas


def _row_to_inspect(row: dict[str, Any]) -> dict[str, Any]:
    campos = row.get("CamposJson")
    if isinstance(campos, str):
        try:
            campos = json.loads(campos)
        except json.JSONDecodeError:
            campos = None
    variaveis = row.get("VariaveisJson")
    if isinstance(variaveis, str):
        try:
            variaveis = json.loads(variaveis)
        except json.JSONDecodeError:
            variaveis = None
    layout = row.get("LayoutJson")
    if isinstance(layout, str):
        try:
            layout = json.loads(layout)
        except json.JSONDecodeError:
            layout = None
    return {
        "inspect_id": row["Token"],
        "filename": row.get("NomeArquivo") or "",
        "status": row.get("Status") or STATUS_PENDING,
        "campos": campos if isinstance(campos, dict) else {},
        "variaveis": variaveis if isinstance(variaveis, list) else [],
        "preview_layout": layout if isinstance(layout, dict) else None,
        "erro": row.get("Erro"),
        "worker_id": row.get("WorkerID"),
        "criado_em": row.get("CriadoEm"),
        "concluido_em": row.get("ConcluidoEm"),
    }


def create_inspect_request(content: bytes, filename: str) -> dict[str, Any]:
    ensure_papelaria_cdr_inspect_table()
    if not content:
        raise ValueError("Arquivo .cdr vazio.")

    safe_name = _sanitize_cdr_filename(filename)
    token = uuid.uuid4().hex
    stored_name = f"{token}.cdr"
    dest = _inspect_dir() / stored_name
    dest.write_bytes(content)

    db.execute_query(
        """
        INSERT INTO tabPapelariaCdrInspect
            (Token, NomeArquivo, CaminhoCdr, Status)
        VALUES (%(token)s, %(nome)s, %(path)s, %(status)s)
        """,
        {
            "token": token,
            "nome": safe_name,
            "path": stored_name,
            "status": STATUS_PENDING,
        },
    )
    return get_inspect_request(token) or {"inspect_id": token, "status": STATUS_PENDING}


def get_inspect_request(token: str) -> Optional[dict[str, Any]]:
    ensure_papelaria_cdr_inspect_table()
    rows = db.execute_query(
        """
        SELECT Token, NomeArquivo, CaminhoCdr, Status, CamposJson, VariaveisJson,
               Erro, WorkerID, CriadoEm, ConcluidoEm
        FROM tabPapelariaCdrInspect
        WHERE Token = %(token)s
        LIMIT 1
        """,
        {"token": token.strip()},
    )
    if not rows:
        return None
    return _row_to_inspect(rows[0])


def claim_inspect_for_worker(worker_id: str) -> Optional[dict[str, Any]]:
    ensure_papelaria_cdr_inspect_table()
    wid = (worker_id or "").strip()
    if not wid:
        raise ValueError("worker_id é obrigatório.")

    _expire_stale_inspects()

    def _claim(cursor) -> Optional[str]:
        cursor.execute(
            """
            SELECT Token, CaminhoCdr, NomeArquivo
            FROM tabPapelariaCdrInspect
            WHERE Status = %(pending)s
            ORDER BY CriadoEm ASC
            LIMIT 1
            FOR UPDATE
            """,
            {"pending": STATUS_PENDING},
        )
        row = cursor.fetchone()
        if not row:
            return None
        token = row["Token"]
        cursor.execute(
            """
            UPDATE tabPapelariaCdrInspect
            SET Status = %(processing)s, WorkerID = %(worker_id)s
            WHERE Token = %(token)s AND Status = %(pending)s
            """,
            {
                "token": token,
                "processing": STATUS_PROCESSING,
                "worker_id": wid,
                "pending": STATUS_PENDING,
            },
        )
        if cursor.rowcount == 0:
            return None
        return token

    results = db.execute_transaction([_claim])
    token = results[0] if results else None
    if not token:
        return None

    rows = db.execute_query(
        """
        SELECT Token, CaminhoCdr, NomeArquivo
        FROM tabPapelariaCdrInspect
        WHERE Token = %(token)s
        LIMIT 1
        """,
        {"token": token},
    )
    if not rows:
        return None
    row = rows[0]
    try:
        cdr_path = _resolve_stored_cdr_path(row["CaminhoCdr"])
    except FileNotFoundError:
        fail_inspect(token, wid, "Caminho do .cdr não registrado.")
        return None
    if not cdr_path.is_file():
        fail_inspect(
            token,
            wid,
            f"Arquivo .cdr não encontrado no servidor da API: {row.get('CaminhoCdr')}",
        )
        return None
    return {
        "inspect_id": token,
        "filename": row.get("NomeArquivo") or cdr_path.name,
    }


def resolve_inspect_cdr_for_worker(token: str, worker_id: str) -> tuple[Path, str]:
    """Retorna (caminho_absoluto, nome_download) para o worker autenticado."""
    ensure_papelaria_cdr_inspect_table()
    _assert_worker_owns_inspect(token.strip(), worker_id.strip())
    rows = db.execute_query(
        """
        SELECT CaminhoCdr, NomeArquivo
        FROM tabPapelariaCdrInspect
        WHERE Token = %(token)s
        LIMIT 1
        """,
        {"token": token.strip()},
    )
    if not rows:
        raise LookupError("Inspeção não encontrada.")
    row = rows[0]
    path = _resolve_stored_cdr_path(row.get("CaminhoCdr") or "")
    if not path.is_file():
        raise FileNotFoundError(
            f"Arquivo .cdr não encontrado no servidor da API: {row.get('CaminhoCdr')}"
        )
    download_name = (row.get("NomeArquivo") or path.name).strip() or path.name
    return path, download_name


def complete_inspect(
    token: str,
    worker_id: str,
    campos: dict[str, str],
    variaveis: list[str],
    preview_layout: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    ensure_papelaria_cdr_inspect_table()
    _assert_worker_owns_inspect(token, worker_id)

    vars_set: set[str] = set(variaveis or [])
    for texto in (campos or {}).values():
        vars_set.update(extrair_variaveis(str(texto)))
    variaveis_final = _ordenar_variaveis(vars_set)

    layout_json: Optional[str] = None
    if isinstance(preview_layout, dict) and preview_layout:
        layout_json = json.dumps(preview_layout, ensure_ascii=False)

    params = {
        "token": token,
        "status": STATUS_COMPLETED,
        "campos": json.dumps(campos or {}, ensure_ascii=False),
        "variaveis": json.dumps(variaveis_final, ensure_ascii=False),
        "processing": STATUS_PROCESSING,
        "worker_id": worker_id.strip(),
        "layout": layout_json,
    }

    if layout_json is not None:
        db.execute_query(
            """
            UPDATE tabPapelariaCdrInspect
            SET Status = %(status)s,
                CamposJson = %(campos)s,
                VariaveisJson = %(variaveis)s,
                LayoutJson = %(layout)s,
                Erro = NULL,
                ConcluidoEm = NOW()
            WHERE Token = %(token)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
            """,
            params,
        )
    else:
        db.execute_query(
            """
            UPDATE tabPapelariaCdrInspect
            SET Status = %(status)s,
                CamposJson = %(campos)s,
                VariaveisJson = %(variaveis)s,
                Erro = NULL,
                ConcluidoEm = NOW()
            WHERE Token = %(token)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
            """,
            params,
        )
    result = get_inspect_request(token)
    if not result or result["status"] != STATUS_COMPLETED:
        raise ValueError("Inspeção não pôde ser concluída (status alterado).")
    return result


def fail_inspect(token: str, worker_id: str, erro: str) -> dict[str, Any]:
    ensure_papelaria_cdr_inspect_table()
    try:
        _assert_worker_owns_inspect(token, worker_id)
    except ValueError:
        db.execute_query(
            """
            UPDATE tabPapelariaCdrInspect
            SET Status = %(status)s, Erro = %(erro)s, ConcluidoEm = NOW()
            WHERE Token = %(token)s AND Status IN (%(pending)s, %(processing)s)
            """,
            {
                "token": token,
                "status": STATUS_FAILED,
                "erro": (erro or "Falha desconhecida.")[:4000],
                "pending": STATUS_PENDING,
                "processing": STATUS_PROCESSING,
            },
        )
        result = get_inspect_request(token)
        if result:
            return result
        raise

    db.execute_query(
        """
        UPDATE tabPapelariaCdrInspect
        SET Status = %(status)s,
            Erro = %(erro)s,
            ConcluidoEm = NOW()
        WHERE Token = %(token)s AND Status = %(processing)s AND WorkerID = %(worker_id)s
        """,
        {
            "token": token,
            "status": STATUS_FAILED,
            "erro": (erro or "Falha desconhecida.")[:4000],
            "processing": STATUS_PROCESSING,
            "worker_id": worker_id.strip(),
        },
    )
    result = get_inspect_request(token)
    if not result:
        raise LookupError("Inspeção não encontrada.")
    return result


def consume_completed_inspect(token: str) -> dict[str, Any]:
    """Retorna inspeção concluída."""
    inspect = get_inspect_request(token)
    if not inspect:
        raise LookupError("Inspeção não encontrada.")
    if inspect["status"] != STATUS_COMPLETED:
        raise ValueError("Inspeção ainda não concluída.")
    return inspect


def _assert_worker_owns_inspect(token: str, worker_id: str) -> None:
    rows = db.execute_query(
        """
        SELECT Status, WorkerID
        FROM tabPapelariaCdrInspect
        WHERE Token = %(token)s
        LIMIT 1
        """,
        {"token": token},
    )
    if not rows:
        raise LookupError("Inspeção não encontrada.")
    row = rows[0]
    if row.get("Status") != STATUS_PROCESSING:
        raise ValueError(f"Inspeção não está em processamento (status: {row.get('Status')}).")
    if (row.get("WorkerID") or "").strip() != (worker_id or "").strip():
        raise ValueError("Inspeção está sendo processada por outro worker.")


def _expire_stale_inspects() -> None:
    cutoff = datetime.utcnow() - timedelta(hours=INSPECT_TTL_HOURS)
    rows = db.execute_query(
        """
        SELECT Token, CaminhoCdr, Status
        FROM tabPapelariaCdrInspect
        WHERE Status IN (%(pending)s, %(processing)s)
          AND CriadoEm < %(cutoff)s
        """,
        {
            "pending": STATUS_PENDING,
            "processing": STATUS_PROCESSING,
            "cutoff": cutoff.strftime("%Y-%m-%d %H:%M:%S"),
        },
    )
    for row in rows or []:
        token = row["Token"]
        db.execute_query(
            """
            UPDATE tabPapelariaCdrInspect
            SET Status = %(failed)s,
                Erro = %(erro)s,
                ConcluidoEm = NOW()
            WHERE Token = %(token)s
            """,
            {
                "token": token,
                "failed": STATUS_FAILED,
                "erro": "Inspeção expirada.",
            },
        )
        try:
            path = _resolve_stored_cdr_path(row.get("CaminhoCdr") or "")
        except FileNotFoundError:
            path = None
        if path and path.is_file():
            try:
                path.unlink()
            except OSError:
                pass
