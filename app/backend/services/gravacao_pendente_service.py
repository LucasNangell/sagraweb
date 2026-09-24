"""Serviço de Gravação Pendente — sessões, arquivos na rede e chapas."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Optional

from fastapi import HTTPException

from database import db
from routers.andamento_helpers import format_gravacao_pendente_obs, format_ponto
from services.gravacao_externa_service import (
    SETOR_GRAV_EXTERNA,
    SITUACAO_SAIDA_P,
    build_session_detail,
    get_active_session,
    insert_session_with_arquivos_cursor,
)
from services.gravacao_externa_email_service import send_gravacao_notification_email
from services.network_files_service import validate_network_arquivos_input

try:
    import fitz  # type: ignore
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore
from services.os_vinculo_grupo_service import _clean_ponto, _lookup_usuario_nome

logger = logging.getLogger(__name__)

SITUACAO_GRAVACAO_PENDENTE = "Gravação Pendente"
DEFAULT_SETOR_ENVIO_EXTERNA = SETOR_GRAV_EXTERNA
SETOR_GRAVACAO_PENDENTE = "SEGEP"
ACTIVE_PENDENTE_STATUSES = frozenset({"ativa"})
ALLOWED_MAQUINAS_CONFIG = frozenset({"Komori", "SM74", "PM52"})
COTA_AJUSTE_MODES = frozenset({"set", "inc", "dec"})
ORIGEM_PENDENTE_ANDAMENTO = "andamento"
ORIGEM_PENDENTE_MANUAL = "manual"


def is_gravacao_pendente_situacao(situacao: str | None) -> bool:
    return str(situacao or "").strip() == SITUACAO_GRAVACAO_PENDENTE


def cancel_active_pendente_sessions_cursor(cursor, ano: int, os_id: int) -> None:
    """Encerra sessões ativas de Gravação Pendente (permite relançar com novos arquivos)."""
    cursor.execute(
        """
        UPDATE tab_os_gravacao_pendente
        SET Status = 'cancelada'
        WHERE OsAno = %s AND OsNro = %s AND Status = 'ativa'
        """,
        (ano, os_id),
    )


def cancel_active_pendente_sessions(ano: int, os_id: int) -> None:
    """Encerra sessões ativas quando a OS deixa de estar em Gravação Pendente."""
    db.execute_query(
        """
        UPDATE tab_os_gravacao_pendente
        SET Status = 'cancelada'
        WHERE OsAno = %s AND OsNro = %s AND Status = 'ativa'
        """,
        (ano, os_id),
    )
    logger.info("Sessões Gravação Pendente canceladas para OS %s/%s", os_id, ano)


def remove_pendente_from_queue(gravacao_pendente_id: int) -> dict[str, Any]:
    """Remove uma sessão (ou sua juntada) da fila ativa sem apagar o histórico."""
    try:
        pendente_id = int(gravacao_pendente_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("gravacao_pendente_id inválido") from exc
    if pendente_id <= 0:
        raise ValueError("gravacao_pendente_id inválido")

    def tx(cursor):
        cursor.execute(
            """
            SELECT Id, JuntadaGrupoId, Status
            FROM tab_os_gravacao_pendente
            WHERE Id = %s
            LIMIT 1
            FOR UPDATE
            """,
            (pendente_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail="Sessão de Gravação Pendente não encontrada.",
            )

        if isinstance(row, dict):
            juntada_raw = row.get("JuntadaGrupoId")
            status = str(row.get("Status") or "")
        else:
            juntada_raw = row[1] if len(row) > 1 else None
            status = str(row[2] if len(row) > 2 else "")
        if status not in ACTIVE_PENDENTE_STATUSES:
            raise HTTPException(
                status_code=409,
                detail="A OS não está mais na lista de Gravação Pendente.",
            )

        juntada_id = str(juntada_raw).strip() if juntada_raw else None
        target_ids = [pendente_id]
        if juntada_id:
            cursor.execute(
                """
                SELECT Id
                FROM tab_os_gravacao_pendente
                WHERE JuntadaGrupoId = %s AND Status = 'ativa'
                ORDER BY Id
                FOR UPDATE
                """,
                (juntada_id,),
            )
            target_ids = [
                int(group_row.get("Id") if isinstance(group_row, dict) else group_row[0])
                for group_row in (cursor.fetchall() or [])
            ]
            if pendente_id not in target_ids:
                target_ids.append(pendente_id)

        updated_ids: list[int] = []
        for target_id in target_ids:
            cursor.execute(
                """
                UPDATE tab_os_gravacao_pendente
                SET Status = 'cancelada'
                WHERE Id = %s AND Status = 'ativa'
                """,
                (target_id,),
            )
            if cursor.rowcount == 1:
                updated_ids.append(target_id)

        if pendente_id not in updated_ids:
            raise HTTPException(
                status_code=409,
                detail="A OS não está mais na lista de Gravação Pendente.",
            )
        return {
            "removed": True,
            "gravacao_pendente_id": pendente_id,
            "removed_ids": updated_ids,
            "juntada_grupo_id": juntada_id,
        }

    results = db.execute_transaction([tx])
    return results[0]


def reactivate_pendente_after_externa_cancel(ano: int, os_id: int) -> Optional[int]:
    """
    Reativa a sessão pendente enviada quando o andamento Gravação Externa é excluído.

    Os arquivos/chapas permanecem nas tabelas; só o Status volta de 'enviada' para 'ativa'
    para a UI e APIs voltarem a enxergar a sessão.
    """
    if get_active_pendente_session(ano, os_id):
        return None

    rows = db.execute_query(
        """
        SELECT OrigemPendenteId AS id
        FROM tab_os_gravacao_externa
        WHERE OsAno = %s AND OsNro = %s AND OrigemPendenteId IS NOT NULL
        ORDER BY Id DESC
        LIMIT 1
        """,
        (ano, os_id),
    )
    pendente_id: Optional[int] = None
    if rows and rows[0].get("id") is not None:
        pendente_id = int(rows[0]["id"])

    if pendente_id is None:
        rows = db.execute_query(
            """
            SELECT Id AS id
            FROM tab_os_gravacao_pendente
            WHERE OsAno = %s AND OsNro = %s AND Status = 'enviada'
            ORDER BY Id DESC
            LIMIT 1
            """,
            (ano, os_id),
        )
        if rows and rows[0].get("id") is not None:
            pendente_id = int(rows[0]["id"])

    if pendente_id is None:
        return None

    def tx(cursor):
        cursor.execute(
            """
            UPDATE tab_os_gravacao_pendente
            SET Status = 'ativa', EnviadaEm = NULL, EnviadaPorPonto = NULL
            WHERE Id = %s AND Status = 'enviada'
            """,
            (pendente_id,),
        )
        return cursor.rowcount

    updated = db.execute_transaction([tx])
    rowcount = updated[0] if updated else 0
    if rowcount:
        logger.info(
            "Sessão Gravação Pendente %s reativada após cancelamento Externa (OS %s/%s)",
            pendente_id,
            os_id,
            ano,
        )
        return pendente_id
    return None


def estimate_chapas_from_validated_arquivos(
    arquivos: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """
    Estima a quantidade total de chapas a partir da lista de arquivos já validada.

    Regra:
    - Se houver ao menos 1 arquivo TIF/TIFF: total_chapas = quantidade de TIF/TIFF.
    - Caso contrário (somente PDFs): total_chapas = soma de page_count dos PDFs.
      Nesse caso total_chapas / pdf_page_count representam o nº de **conjuntos de
      separação** esperados (uma página do espelho = um conjunto CMYK/PANTONE),
      não o número de arquivos TIF.

    Retorna um dicionário com:
        {
          "total_chapas": int,
          "fonte": "tif" | "pdf" | "none",
          "pdf_page_count": int | None,
          "expected_plate_count": int | None,
          "ink_analysis_status": "ok" | "partial" | "unavailable" | None,
        }
    """
    arquivos_list = list(arquivos)
    if not arquivos_list:
        return {
            "total_chapas": 0,
            "fonte": "none",
            "pdf_page_count": None,
            "expected_plate_count": None,
            "ink_analysis_status": None,
        }

    # Detecta extensão normalizada
    def _ext(nome: str) -> str:
        return os.path.splitext(str(nome or ""))[1].lower()

    tif_exts = {".tif", ".tiff"}
    pdf_ext = ".pdf"

    tif_count = 0
    pdf_paths: list[str] = []

    for item in arquivos_list:
        path = str(item.get("absolute_path") or "")
        nome = str(item.get("nome") or path)
        ext = _ext(nome or path)
        if ext in tif_exts:
            tif_count += 1
        elif ext == pdf_ext:
            pdf_paths.append(path)

    if tif_count > 0:
        return {
            "total_chapas": tif_count,
            "fonte": "tif",
            "pdf_page_count": None,
            "expected_plate_count": None,
            "ink_analysis_status": None,
        }

    if not pdf_paths or fitz is None:
        return {
            "total_chapas": 0,
            "fonte": "none",
            "pdf_page_count": None,
            "expected_plate_count": None,
            "ink_analysis_status": None,
        }

    total_pages = 0
    for full_path in pdf_paths:
        try:
            doc = fitz.open(full_path)
        except Exception as exc:  # pragma: no cover - erros de IO variam
            logger.warning("estimate_chapas: erro ao abrir PDF %s: %s", full_path, exc)
            continue
        try:
            total_pages += int(getattr(doc, "page_count", 0) or 0)
        except Exception as exc:  # pragma: no cover
            logger.warning("estimate_chapas: erro ao ler page_count %s: %s", full_path, exc)
        finally:
            try:
                doc.close()
            except Exception:
                pass

    if total_pages > 0:
        return {
            "total_chapas": total_pages,
            "fonte": "pdf",
            "pdf_page_count": total_pages,
            "expected_plate_count": None,
            "ink_analysis_status": None,
        }
    return {
        "total_chapas": 0,
        "fonte": "none",
        "pdf_page_count": None,
        "expected_plate_count": None,
        "ink_analysis_status": None,
    }


def has_active_pendente_session(ano: int, os_id: int) -> bool:
    rows = db.execute_query(
        """
        SELECT Id FROM tab_os_gravacao_pendente
        WHERE OsAno = %s AND OsNro = %s AND Status = 'ativa'
        LIMIT 1
        """,
        (ano, os_id),
    )
    return bool(rows)


def arquivos_are_pdf_only(arquivos: list[dict[str, Any]]) -> bool:
    """True when there is at least one arquivo and all are PDF (no TIF/TIFF)."""
    if not arquivos:
        return False
    for item in arquivos:
        nome = str(item.get("nome") or item.get("absolute_path") or "").strip()
        ext = Path(nome).suffix.lower()
        if ext != ".pdf":
            return False
    return True


def validate_chapas_input(
    chapas: list[dict[str, Any]],
    *,
    allow_empty: bool = False,
) -> list[dict[str, Any]]:
    if not chapas:
        if allow_empty:
            return []
        raise ValueError("Informe ao menos uma máquina com quantidade de chapas.")
    validated: list[dict[str, Any]] = []
    for item in chapas:
        maquina = str(item.get("maquina") or "").strip()
        if not maquina:
            continue
        try:
            qty = int(item.get("quantidade") or 0)
        except (TypeError, ValueError):
            qty = 0
        if qty <= 0:
            raise ValueError(f"Quantidade de chapas inválida para máquina {maquina}.")
        validated.append({"maquina": maquina, "quantidade": qty})
    if not validated:
        if allow_empty:
            return []
        raise ValueError("Informe ao menos uma máquina com quantidade de chapas.")
    return validated


def build_pendente_obs_text(
    chapas: list[dict[str, Any]],
    user_obs: str = "",
) -> str:
    return format_gravacao_pendente_obs(chapas, user_obs)


def lookup_os_solicitante(ano: int, os_id: int) -> str | None:
    """Mesmo Solicitante da lista de OSs da página inicial (tabProtocolos.NomeUsuario)."""
    rows = db.execute_query(
        """
        SELECT NomeUsuario
        FROM tabProtocolos
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
        LIMIT 1
        """,
        (os_id, ano),
    )
    if not rows:
        return None
    value = rows[0].get("NomeUsuario")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _lookup_os_solicitante_cursor(cursor, ano: int, os_id: int) -> str | None:
    cursor.execute(
        """
        SELECT NomeUsuario
        FROM tabProtocolos
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
        LIMIT 1
        """,
        (os_id, ano),
    )
    row = cursor.fetchone()
    if not row:
        return None
    value = row.get("NomeUsuario") if isinstance(row, dict) else None
    if value is None and not isinstance(row, dict) and len(row) > 0:
        value = row[0]
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_session_observacao(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def insert_pendente_session_cursor(
    cursor,
    *,
    ano: int,
    os_id: int,
    cod_status: str,
    ponto_fmt: str,
    lancado_por_nome: str | None,
    validated_arquivos: list[dict[str, Any]],
    validated_chapas: list[dict[str, Any]],
    cliente: str | None = None,
    juntada_grupo_id: str | None = None,
    observacao: str | None = None,
    origem: str = ORIGEM_PENDENTE_ANDAMENTO,
) -> int:
    # Relançamento: encerra sessão ativa anterior e grava a nova com os arquivos atuais.
    cancel_active_pendente_sessions_cursor(cursor, ano, os_id)
    cliente_snap = (cliente or "").strip() or _lookup_os_solicitante_cursor(cursor, ano, os_id)
    grupo_id = (juntada_grupo_id or "").strip() or None
    obs_text = _normalize_session_observacao(observacao)
    cursor.execute(
        """
        INSERT INTO tab_os_gravacao_pendente
            (OsAno, OsNro, CodStatus, Origem, LancadoPorPonto, LancadoPorNome, Cliente, Status,
             JuntadaGrupoId, Observacao)
        VALUES (%s, %s, %s, %s, %s, %s, %s, 'ativa', %s, %s)
        """,
        (
            ano,
            os_id,
            cod_status,
            origem,
            ponto_fmt,
            lancado_por_nome,
            cliente_snap,
            grupo_id,
            obs_text,
        ),
    )
    session_id = int(cursor.lastrowid)
    for arquivo in validated_arquivos:
        cursor.execute(
            """
            INSERT INTO tab_os_gravacao_pendente_arquivo
                (GravacaoPendenteId, AbsolutePath, NomeArquivo, TamanhoBytes, Ordem, Maquina)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                session_id,
                arquivo["absolute_path"],
                arquivo["nome"],
                arquivo.get("tamanho_bytes"),
                arquivo["ordem"],
                arquivo.get("maquina"),
            ),
        )
    for chapa in validated_chapas:
        cursor.execute(
            """
            INSERT INTO tab_os_gravacao_pendente_chapa
                (GravacaoPendenteId, Maquina, QuantidadeChapas)
            VALUES (%s, %s, %s)
            """,
            (session_id, chapa["maquina"], chapa["quantidade"]),
        )
    return session_id


def _map_pendente_session(row: dict[str, Any]) -> dict[str, Any]:
    juntada = row.get("JuntadaGrupoId")
    return {
        "id": int(row["Id"]),
        "os_ano": int(row["OsAno"]),
        "os_nro": int(row["OsNro"]),
        "cod_status": str(row.get("CodStatus") or ""),
        "origem": str(row.get("Origem") or ORIGEM_PENDENTE_ANDAMENTO),
        "lancado_por_ponto": str(row.get("LancadoPorPonto") or ""),
        "lancado_por_nome": row.get("LancadoPorNome"),
        "cliente": row.get("Cliente"),
        "status": str(row.get("Status") or "ativa"),
        "enviada_em": row.get("EnviadaEm"),
        "enviada_por_ponto": row.get("EnviadaPorPonto"),
        "juntada_grupo_id": str(juntada).strip() if juntada else None,
        "observacao": _normalize_session_observacao(row.get("Observacao")),
        "criado_em": row.get("CriadoEm"),
    }


def list_active_pendente_by_juntada(juntada_grupo_id: str) -> list[dict[str, Any]]:
    gid = (juntada_grupo_id or "").strip()
    if not gid:
        return []
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_pendente
        WHERE JuntadaGrupoId = %s AND Status = 'ativa'
        ORDER BY OsNro ASC, OsAno ASC, Id ASC
        """,
        (gid,),
    )
    return [_map_pendente_session(r) for r in rows or []]


def list_pendente_by_juntada(
    juntada_grupo_id: str,
    *,
    exclude_cancelada: bool = True,
) -> list[dict[str, Any]]:
    """Lista sessões pendentes do grupo (controle/histórico, não só ativas)."""
    gid = (juntada_grupo_id or "").strip()
    if not gid:
        return []
    sql = """
        SELECT * FROM tab_os_gravacao_pendente
        WHERE JuntadaGrupoId = %s
    """
    if exclude_cancelada:
        sql += " AND Status <> 'cancelada'"
    sql += " ORDER BY OsNro ASC, OsAno ASC, Id ASC"
    rows = db.execute_query(sql, (gid,))
    return [_map_pendente_session(r) for r in rows or []]


def os_exists(ano: int, os_id: int) -> bool:
    rows = db.execute_query(
        """
        SELECT 1 AS ok FROM tabProtocolos
        WHERE AnoProtocolo = %s AND NroProtocolo = %s
        LIMIT 1
        """,
        (ano, os_id),
    )
    return bool(rows)


def validate_gravacao_pendente_juntadas(
    *,
    principal_ano: int,
    principal_nr: int,
    juntadas: list[dict[str, Any]] | None,
) -> list[tuple[int, int]]:
    """Normaliza e valida OSs juntadas (exclui a principal). Retorna lista (ano, nr)."""
    if not juntadas:
        return []
    seen: set[tuple[int, int]] = set()
    result: list[tuple[int, int]] = []
    principal = (int(principal_ano), int(principal_nr))
    for raw in juntadas:
        try:
            nr = int(raw.get("numero") if "numero" in raw else raw.get("nr_os"))
            ano = int(raw.get("ano"))
        except (TypeError, ValueError) as exc:
            raise ValueError("Cada OS juntada precisa de número e ano válidos.") from exc
        key = (ano, nr)
        if key == principal:
            continue
        if key in seen:
            continue
        if not os_exists(ano, nr):
            raise ValueError(f"OS {nr}/{ano} não encontrada.")
        active = get_active_pendente_session(ano, nr)
        if active:
            raise ValueError(
                f"OS {nr}/{ano} já possui Gravação Pendente ativa. "
                "Encerre ou envie antes de juntá-la neste lançamento."
            )
        seen.add(key)
        result.append(key)
    return result


def create_manual_pendente_session(
    *,
    ano: int,
    os_id: int,
    operador_ponto: str,
    arquivos: list[dict[str, Any]],
    chapas: list[dict[str, Any]],
    observacao: str = "",
    juntadas: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Inclui uma OS na fila pendente sem criar ou alterar tabAndamento."""
    if not os_exists(ano, os_id):
        raise ValueError(f"OS {os_id}/{ano} não encontrada.")

    validated_arquivos = validate_network_arquivos_input(arquivos)
    validated_chapas = validate_chapas_input(
        chapas,
        allow_empty=arquivos_are_pdf_only(validated_arquivos),
    )
    membros = validate_gravacao_pendente_juntadas(
        principal_ano=ano,
        principal_nr=os_id,
        juntadas=juntadas,
    )
    targets = [(ano, os_id), *membros]
    grupo_id = str(uuid.uuid4()) if membros else None
    ponto_fmt = format_ponto(_clean_ponto(operador_ponto))
    lancado_por_nome = _lookup_usuario_nome(ponto_fmt)

    def tx(cursor):
        # Serializa inclusões da mesma OS e impede que duplo clique/replay substitua
        # silenciosamente uma sessão ativa criada pela primeira requisição.
        for target_ano, target_os in sorted(targets):
            cursor.execute(
                """
                SELECT NroProtocolo
                FROM tabProtocolos
                WHERE AnoProtocolo = %s AND NroProtocolo = %s
                FOR UPDATE
                """,
                (target_ano, target_os),
            )
            cursor.fetchone()
            cursor.execute(
                """
                SELECT Id
                FROM tab_os_gravacao_pendente
                WHERE OsAno = %s AND OsNro = %s AND Status = 'ativa'
                LIMIT 1
                """,
                (target_ano, target_os),
            )
            if cursor.fetchone():
                raise ValueError(
                    f"OS {target_os}/{target_ano} já está na lista de gravação pendente."
                )

        ids: list[int] = []
        for target_ano, target_os in targets:
            ids.append(
                insert_pendente_session_cursor(
                    cursor,
                    ano=target_ano,
                    os_id=target_os,
                    cod_status="manual",
                    ponto_fmt=ponto_fmt,
                    lancado_por_nome=lancado_por_nome,
                    validated_arquivos=validated_arquivos,
                    validated_chapas=validated_chapas,
                    juntada_grupo_id=grupo_id,
                    observacao=observacao,
                    origem=ORIGEM_PENDENTE_MANUAL,
                )
            )
        return ids

    db.execute_transaction([tx])
    session = get_active_pendente_session(ano, os_id)
    if not session:
        raise RuntimeError("Falha ao criar sessão de Gravação Pendente.")

    from services.gravacao_preview_cache_service import enqueue_preview_warmup

    enqueue_preview_warmup(validated_arquivos)
    return build_pendente_detail(session)


def format_os_list_label(nr_os: int, ano: int) -> str:
    return f"{int(nr_os):05d}/{str(int(ano))[-2:]}"


def format_juntada_membros_label(membros: list[dict[str, Any]]) -> str:
    labels = [
        format_os_list_label(int(m["nr_os"]), int(m["ano"]))
        for m in membros
        if m.get("nr_os") is not None and m.get("ano") is not None
    ]
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} e {labels[1]}"
    return f"{', '.join(labels[:-1])} e {labels[-1]}"


def list_juntada_membros(juntada_grupo_id: str) -> list[dict[str, Any]]:
    """Membros únicos (nr_os/ano) de um JuntadaGrupoId em pendente ou externa."""
    gid = (juntada_grupo_id or "").strip()
    if not gid:
        return []
    rows = db.execute_query(
        """
        SELECT OsNro AS nr_os, OsAno AS ano
        FROM tab_os_gravacao_pendente
        WHERE JuntadaGrupoId = %s AND Status <> 'cancelada'
        UNION
        SELECT OsNro AS nr_os, OsAno AS ano
        FROM tab_os_gravacao_externa
        WHERE JuntadaGrupoId = %s AND Status <> 'cancelada'
        ORDER BY nr_os ASC, ano ASC
        """,
        (gid, gid),
    )
    seen: set[tuple[int, int]] = set()
    result: list[dict[str, Any]] = []
    for row in rows or []:
        try:
            nr = int(row["nr_os"])
            ano = int(row["ano"])
        except (TypeError, ValueError, KeyError):
            continue
        key = (nr, ano)
        if key in seen:
            continue
        seen.add(key)
        result.append({"nr_os": nr, "ano": ano})
    return result


def juntada_membros_label(juntada_grupo_id: str | None) -> str:
    """Label '01209/26 e 01350/26' para prefixo de observação, ou string vazia."""
    gid = (juntada_grupo_id or "").strip()
    if not gid:
        return ""
    return format_juntada_membros_label(list_juntada_membros(gid))


def resolve_juntada_grupo_for_os(nro: int, ano: int) -> dict[str, Any] | None:
    """Retorna juntada mais recente da OS com irmãs, ou None."""
    rows = db.execute_query(
        """
        SELECT JuntadaGrupoId AS juntada_grupo_id, CriadoEm AS criado_em
        FROM tab_os_gravacao_pendente
        WHERE OsNro = %s AND OsAno = %s
          AND JuntadaGrupoId IS NOT NULL
          AND TRIM(JuntadaGrupoId) <> ''
          AND Status <> 'cancelada'
        UNION ALL
        SELECT JuntadaGrupoId AS juntada_grupo_id, CriadoEm AS criado_em
        FROM tab_os_gravacao_externa
        WHERE OsNro = %s AND OsAno = %s
          AND JuntadaGrupoId IS NOT NULL
          AND TRIM(JuntadaGrupoId) <> ''
          AND Status <> 'cancelada'
        ORDER BY criado_em DESC
        LIMIT 1
        """,
        (nro, ano, nro, ano),
    )
    if not rows:
        return None
    gid = str(rows[0].get("juntada_grupo_id") or "").strip()
    if not gid:
        return None
    membros = list_juntada_membros(gid)
    others = [m for m in membros if not (m["nr_os"] == nro and m["ano"] == ano)]
    if not others:
        return None
    return {
        "juntada_grupo_id": gid,
        "membros": membros,
        "membros_vinculo": [
            {"numero": int(m["nr_os"]), "ano": int(m["ano"])} for m in membros
        ],
    }


def _aggregate_list_items_by_juntada(
    items: list[dict[str, Any]],
    *,
    juntada_key: str = "juntada_grupo_id",
) -> list[dict[str, Any]]:
    """Agrupa itens da lista por JuntadaGrupoId; mantém âncora = menor nr_os."""
    groups: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for item in items:
        gid = str(item.get(juntada_key) or "").strip()
        if gid:
            key = f"g:{gid}"
        else:
            key = f"s:{item['ano']}-{item['nr_os']}"

        membro = {"nr_os": int(item["nr_os"]), "ano": int(item["ano"])}
        if key not in groups:
            order.append(key)
            groups[key] = {
                **item,
                "juntada_grupo_id": gid or None,
                "membros": [membro],
            }
            continue

        g = groups[key]
        if not any(
            m["nr_os"] == membro["nr_os"] and m["ano"] == membro["ano"] for m in g["membros"]
        ):
            g["membros"].append(membro)
        # Âncora: menor nr_os (desempate ano)
        if (membro["nr_os"], membro["ano"]) < (int(g["nr_os"]), int(g["ano"])):
            for field in (
                "nr_os",
                "ano",
                "solicitante",
                "produto",
                "titulo",
                "situacao",
                "setor",
                "last_update",
                "gravacao_pendente_id",
                "gravacao_pendente_status",
                "gravacao_externa_id",
                "gravacao_status",
                "lancado_por_ponto",
                "lancado_por_nome",
                "fornecedor_ponto",
                "gravacao_criado_em",
                "concluida_em",
                "concluida_por_ponto",
                "chapas_por_maquina",
                "total_chapas",
            ):
                if field in item:
                    g[field] = item[field]

    result = []
    for key in order:
        g = groups[key]
        g["membros"] = sorted(g["membros"], key=lambda m: (m["nr_os"], m["ano"]))
        result.append(g)
    return result


def _enrich_juntada_membros_from_sessions(
    aggregated: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Inclui membros de sessões ativas do mesmo JuntadaGrupoId mesmo se a OS
    filha saiu do filtro de SituacaoLink (ex.: andamento órfão/perdido)."""
    group_ids = sorted(
        {
            str(item.get("juntada_grupo_id") or "").strip()
            for item in aggregated
            if str(item.get("juntada_grupo_id") or "").strip()
        }
    )
    if not group_ids:
        return aggregated

    placeholders = ", ".join(["%s"] * len(group_ids))
    rows = db.execute_query(
        f"""
        SELECT OsNro AS nr_os, OsAno AS ano, JuntadaGrupoId AS juntada_grupo_id
        FROM tab_os_gravacao_pendente
        WHERE Status = 'ativa'
          AND JuntadaGrupoId IN ({placeholders})
        """,
        tuple(group_ids),
    )
    by_group: dict[str, list[dict[str, int]]] = {}
    for row in rows or []:
        gid = str(row.get("juntada_grupo_id") or "").strip()
        if not gid:
            continue
        by_group.setdefault(gid, []).append(
            {"nr_os": int(row["nr_os"]), "ano": int(row["ano"])}
        )

    for item in aggregated:
        gid = str(item.get("juntada_grupo_id") or "").strip()
        if not gid:
            continue
        membros = list(item.get("membros") or [])
        for extra in by_group.get(gid, []):
            if not any(
                m["nr_os"] == extra["nr_os"] and m["ano"] == extra["ano"] for m in membros
            ):
                membros.append(extra)
        item["membros"] = sorted(membros, key=lambda m: (m["nr_os"], m["ano"]))
    return aggregated


def repair_orphan_pendente_andamentos() -> list[dict[str, Any]]:
    """Recria andamento Gravação Pendente quando a sessão ativa referencia CodStatus ausente."""
    from routers.andamento_helpers import format_andamento_obs, format_gravacao_pendente_obs
    from routers.os_audit_service import log_andamento_added
    from services.andamento_operacional import insert_andamento_as_ultimo

    rows = db.execute_query(
        """
        SELECT gp.Id, gp.OsNro, gp.OsAno, gp.CodStatus, gp.LancadoPorPonto, gp.JuntadaGrupoId
        FROM tab_os_gravacao_pendente gp
        WHERE gp.Status = 'ativa'
          AND COALESCE(gp.Origem, 'andamento') <> 'manual'
          AND gp.CodStatus IS NOT NULL
          AND gp.CodStatus != ''
          AND NOT EXISTS (
            SELECT 1 FROM tabAndamento a
            WHERE a.CodStatus COLLATE utf8mb4_general_ci
                = gp.CodStatus COLLATE utf8mb4_general_ci
          )
        ORDER BY gp.Id ASC
        """
    )
    repaired: list[dict[str, Any]] = []
    for row in rows or []:
        os_id = int(row["OsNro"])
        ano = int(row["OsAno"])
        cod_status = str(row["CodStatus"] or "").strip()
        if not cod_status:
            continue
        ponto_fmt = format_ponto(_clean_ponto(str(row.get("LancadoPorPonto") or "")))
        chapas = _fetch_pendente_chapas(int(row["Id"]))
        juntada_id = row.get("JuntadaGrupoId")
        obs_body = format_gravacao_pendente_obs(chapas)
        from routers.andamento_helpers import with_juntada_obs_prefix

        obs_body = with_juntada_obs_prefix(
            obs_body,
            juntada_membros_label(str(juntada_id) if juntada_id else None),
        )
        obs = format_andamento_obs(obs_body)

        def tx(cursor, *, _cod=cod_status, _os=os_id, _ano=ano, _ponto=ponto_fmt, _obs=obs):
            insert_andamento_as_ultimo(
                cursor,
                cod_status=_cod,
                nro=_os,
                ano=_ano,
                situacao=SITUACAO_GRAVACAO_PENDENTE,
                setor=SETOR_GRAVACAO_PENDENTE,
                obs=_obs,
                ponto=_ponto,
            )
            log_andamento_added(
                cursor,
                nro=_os,
                ano=_ano,
                cod_status=_cod,
                situacao=SITUACAO_GRAVACAO_PENDENTE,
                setor=SETOR_GRAVACAO_PENDENTE,
                obs=_obs,
                ponto=_ponto,
                origem="repair_orphan_pendente_andamento",
            )
            return _cod

        db.execute_transaction([tx])

        def _sync() -> None:
            from routers.mdb_writer import sync_andamento_from_mysql_to_mdb

            sync_andamento_from_mysql_to_mdb(cod_status, os_id, ano, operation="insert")

        try:
            from routers.mdb_writer import dispatch_mdb_sync

            dispatch_mdb_sync(
                "repair_orphan_pendente",
                _sync,
                cod_status=cod_status,
                nro=os_id,
                ano=ano,
            )
        except Exception as exc:
            logger.warning(
                "Falha ao enfileirar sync MDB reparo pendente %s/%s %s: %s",
                os_id,
                ano,
                cod_status,
                exc,
            )

        repaired.append(
            {
                "os_id": os_id,
                "ano": ano,
                "cod_status": cod_status,
                "gravacao_pendente_id": int(row["Id"]),
            }
        )
    return repaired


def _map_pendente_arquivo(row: dict[str, Any]) -> dict[str, Any]:
    maquina = row.get("Maquina")
    return {
        "id": int(row["Id"]),
        "absolute_path": str(row.get("AbsolutePath") or ""),
        "nome": str(row.get("NomeArquivo") or ""),
        "tamanho_bytes": row.get("TamanhoBytes"),
        "ordem": int(row.get("Ordem") or 0),
        "maquina": str(maquina).strip() if maquina else None,
    }


def _map_pendente_chapa(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row["Id"]),
        "maquina": str(row.get("Maquina") or ""),
        "quantidade": int(row.get("QuantidadeChapas") or 0),
    }


def get_active_pendente_session(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_pendente
        WHERE OsAno = %s AND OsNro = %s AND Status = 'ativa'
        ORDER BY Id DESC
        LIMIT 1
        """,
        (ano, os_id),
    )
    if not rows:
        return None
    return _map_pendente_session(rows[0])


def _fetch_pendente_arquivos(session_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_pendente_arquivo
        WHERE GravacaoPendenteId = %s
        ORDER BY Ordem ASC, Id ASC
        """,
        (session_id,),
    )
    return [_map_pendente_arquivo(r) for r in rows]


def _fetch_pendente_chapas(session_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_pendente_chapa
        WHERE GravacaoPendenteId = %s
        ORDER BY Id ASC
        """,
        (session_id,),
    )
    return [_map_pendente_chapa(r) for r in rows]


def build_pendente_detail(session: dict[str, Any]) -> dict[str, Any]:
    sid = int(session["id"])
    return {
        **session,
        "arquivos": _fetch_pendente_arquivos(sid),
        "chapas": _fetch_pendente_chapas(sid),
    }


def list_os_gravacao_pendente(
    *,
    ano: Optional[int] = None,
    search: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    from services.andamento_operacional import ultimo_operacional_cod_subquery

    params: dict[str, Any] = {"limit": limit, "offset": offset}
    ultimo_cod = ultimo_operacional_cod_subquery("p.NroProtocolo", "p.AnoProtocolo")
    filters = """
        WHERE gp.Status = 'ativa'
    """

    if ano:
        filters += " AND p.AnoProtocolo = %(ano)s"
        params["ano"] = ano

    if search and search.strip():
        term = f"%{search.strip()}%"
        filters += """
            AND (
                CAST(p.NroProtocolo AS CHAR) LIKE %(search)s
                OR p.Titular LIKE %(search)s
                OR p.NomeUsuario LIKE %(search)s
            )
        """
        params["search"] = term

    list_sql = f"""
        SELECT
            p.NroProtocolo AS nr_os,
            p.AnoProtocolo AS ano,
            COALESCE(NULLIF(TRIM(gp.Cliente), ''), NULLIF(TRIM(p.NomeUsuario), '')) AS solicitante,
            p.NomeUsuario AS nome_usuario,
            a.SituacaoLink AS situacao,
            a.SetorLink AS setor,
            a.`Data` AS last_update,
            gp.Id AS gravacao_pendente_id,
            gp.Status AS gravacao_pendente_status,
            gp.LancadoPorPonto AS lancado_por_ponto,
            gp.LancadoPorNome AS lancado_por_nome,
            gp.CriadoEm AS gravacao_criado_em,
            gp.JuntadaGrupoId AS juntada_grupo_id,
            (
                SELECT d.TipoPublicacaoLink
                FROM tabDetalhesServico d
                WHERE d.NroProtocoloLinkDet = p.NroProtocolo
                  AND d.AnoProtocoloLinkDet = p.AnoProtocolo
                LIMIT 1
            ) AS produto
        FROM tab_os_gravacao_pendente gp
        INNER JOIN tabProtocolos p
            ON p.AnoProtocolo = gp.OsAno
           AND p.NroProtocolo = gp.OsNro
        LEFT JOIN tabAndamento a
            ON a.NroProtocoloLink = p.NroProtocolo
           AND a.AnoProtocoloLink = p.AnoProtocolo
           AND a.CodStatus = {ultimo_cod}
        {filters}
        ORDER BY gp.CriadoEm DESC, gp.Id DESC
        LIMIT 2000
    """
    list_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
    rows = db.execute_query(list_sql, list_params)
    items = []
    for row in rows or []:
        solicitante = row.get("solicitante") or row.get("nome_usuario")
        juntada = row.get("juntada_grupo_id")
        items.append(
            {
                "nr_os": int(row["nr_os"]),
                "ano": int(row["ano"]),
                "solicitante": solicitante,
                "produto": row.get("produto"),
                "situacao": row.get("situacao"),
                "setor": row.get("setor"),
                "last_update": row.get("last_update"),
                "gravacao_pendente_id": row.get("gravacao_pendente_id"),
                "gravacao_pendente_status": row.get("gravacao_pendente_status") or "sem_sessao",
                "lancado_por_ponto": row.get("lancado_por_ponto"),
                "lancado_por_nome": row.get("lancado_por_nome"),
                "gravacao_criado_em": row.get("gravacao_criado_em"),
                "juntada_grupo_id": str(juntada).strip() if juntada else None,
            }
        )
    aggregated = _enrich_juntada_membros_from_sessions(
        _aggregate_list_items_by_juntada(items)
    )
    count_group_sql = f"""
        SELECT COUNT(*) AS cnt FROM (
            SELECT COALESCE(gp.JuntadaGrupoId, CONCAT(p.AnoProtocolo, '-', p.NroProtocolo)) AS gkey
            FROM tab_os_gravacao_pendente gp
            INNER JOIN tabProtocolos p
                ON p.AnoProtocolo = gp.OsAno
               AND p.NroProtocolo = gp.OsNro
            LEFT JOIN tabAndamento a
                ON a.NroProtocoloLink = p.NroProtocolo
               AND a.AnoProtocoloLink = p.AnoProtocolo
               AND a.CodStatus = {ultimo_cod}
            {filters}
            GROUP BY gkey
        ) t
    """
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
    count_row = db.execute_query(count_group_sql, count_params)
    total = int((count_row[0] if count_row else {}).get("cnt") or len(aggregated))
    return aggregated[offset : offset + limit], total


_CONFIG_ROW_ID = 1


def get_controle_list_desde() -> datetime | None:
    """Início do controle de chapas; registros anteriores não aparecem na lista."""
    rows = db.execute_query(
        """
        SELECT ControleListDesde
        FROM tab_gravacao_pendente_config
        WHERE Id = %s
        LIMIT 1
        """,
        (_CONFIG_ROW_ID,),
    )
    if not rows:
        return None
    value = rows[0].get("ControleListDesde")
    return value if value is not None else None


def ensure_controle_list_desde() -> datetime:
    """Garante cutoff; se ainda nulo, define NOW() (lista zerada a partir daqui)."""
    current = get_controle_list_desde()
    if current is not None:
        return current
    db.execute_query(
        """
        UPDATE tab_gravacao_pendente_config
        SET ControleListDesde = NOW()
        WHERE Id = %s AND ControleListDesde IS NULL
        """,
        (_CONFIG_ROW_ID,),
    )
    current = get_controle_list_desde()
    if current is None:
        # Fallback extremo: usa agora sem persistir leitura inconsistente
        return datetime.now()
    return current


def _chapas_gravadas_concluidas_base_sql() -> str:
    # Uma vez por juntada (ou por sessão solo): evita N× chapas quando OSs foram juntadas.
    return """
        FROM tab_os_gravacao_pendente_chapa c
        INNER JOIN tab_os_gravacao_pendente gp
            ON gp.Id = c.GravacaoPendenteId
        INNER JOIN tab_os_gravacao_externa ge
            ON ge.OrigemPendenteId = gp.Id
        WHERE ge.Status = 'concluida'
          AND gp.Status <> 'cancelada'
          AND gp.CriadoEm >= %s
          AND gp.Id IN (
            SELECT MIN(gp2.Id)
            FROM tab_os_gravacao_pendente gp2
            INNER JOIN tab_os_gravacao_externa ge2
                ON ge2.OrigemPendenteId = gp2.Id
            WHERE ge2.Status = 'concluida'
              AND gp2.Status <> 'cancelada'
              AND gp2.CriadoEm >= %s
            GROUP BY COALESCE(gp2.JuntadaGrupoId, CONCAT('solo-', gp2.Id))
          )
        """


def get_total_chapas_gravadas_concluidas() -> int:
    desde = ensure_controle_list_desde()
    total_chapas_row = db.execute_query(
        f"""
        SELECT COALESCE(SUM(c.QuantidadeChapas), 0) AS total_chapas
        {_chapas_gravadas_concluidas_base_sql()}
        """,
        (desde, desde),
    )
    return int((total_chapas_row[0] if total_chapas_row else {}).get("total_chapas") or 0)


def get_chapas_gravadas_concluidas_por_maquina() -> dict[str, int]:
    """Totais gravados (concluídos) por máquina, mesma regra de juntada do total geral."""
    desde = ensure_controle_list_desde()
    rows = db.execute_query(
        f"""
        SELECT c.Maquina AS maquina, COALESCE(SUM(c.QuantidadeChapas), 0) AS total_chapas
        {_chapas_gravadas_concluidas_base_sql()}
        GROUP BY c.Maquina
        """,
        (desde, desde),
    )
    result = {m: 0 for m in ("Komori", "SM74", "PM52")}
    for row in rows or []:
        maquina = str(row.get("maquina") or "").strip()
        if maquina not in result:
            continue
        result[maquina] = int(row.get("total_chapas") or 0)
    return result


def get_cota_inicial_chapas() -> int:
    rows = db.execute_query(
        """
        SELECT CotaInicialChapas
        FROM tab_gravacao_pendente_config
        WHERE Id = %s
        LIMIT 1
        """,
        (_CONFIG_ROW_ID,),
    )
    if not rows:
        return 0
    return int(rows[0].get("CotaInicialChapas") or 0)


def update_cota_inicial_chapas(
    *,
    ponto: str,
    observacao: str,
    mode: str,
    valor: int,
) -> int:
    obs = str(observacao or "").strip()
    if not obs:
        raise ValueError("observacao é obrigatória")
    mode_norm = str(mode or "").strip().lower()
    if mode_norm not in COTA_AJUSTE_MODES:
        raise ValueError("mode deve ser set, inc ou dec")
    try:
        valor_int = int(valor)
    except (TypeError, ValueError) as exc:
        raise ValueError("valor deve ser um inteiro >= 0") from exc
    if valor_int < 0:
        raise ValueError("valor deve ser >= 0")

    current = get_cota_inicial_chapas()
    if mode_norm == "set":
        new_val = valor_int
    elif mode_norm == "inc":
        new_val = current + valor_int
    else:
        new_val = max(0, current - valor_int)
    delta = new_val - current
    ponto_fmt = format_ponto(_clean_ponto(ponto))

    def tx(cursor):
        cursor.execute(
            """
            UPDATE tab_gravacao_pendente_config
            SET CotaInicialChapas = %s,
                AtualizadoEm = NOW(),
                AtualizadoPorPonto = %s
            WHERE Id = %s
            """,
            (new_val, ponto_fmt, _CONFIG_ROW_ID),
        )
        cursor.execute(
            """
            INSERT INTO tab_gravacao_pendente_cota_ajuste_log
                (ValorAnterior, ValorNovo, Delta, Modo, Observacao, LancadoPorPonto)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (current, new_val, delta, mode_norm, obs, ponto_fmt),
        )
        return new_val

    return int(db.execute_transaction([tx])[0])


def adjust_cota_inicial_chapas(*, delta: int, ponto: str) -> int:
    """Compat: ajuste rápido ±1 com observação padrão."""
    if delta not in (-1, 1):
        raise ValueError("delta deve ser -1 ou 1")
    return update_cota_inicial_chapas(
        ponto=ponto,
        observacao="Ajuste rápido ±1",
        mode="inc" if delta == 1 else "dec",
        valor=1,
    )


def aggregate_cotas_by_maquina_from_fornecedores() -> dict[str, int]:
    """Soma cotas por máquina: só fornecedores ativos, 1 valor por ponto normalizado.

    Evita dobrar quando há linhas duplicadas (ex.: '999.999' e '999999') — o modal
    já deduplica via ``_clean_ponto``; o banner/recalc precisam da mesma regra.
    """
    active_keys = {
        _clean_ponto(str(item.get("ponto") or ""))
        for item in list_fornecedores()
    }
    active_keys.discard("")
    rows = db.execute_query(
        """
        SELECT FornecedorPonto, Maquina, CotaChapas
        FROM tab_gravacao_pendente_fornecedor_cota
        WHERE Maquina IN ('Komori', 'SM74', 'PM52')
        """
    )
    per_maquina: dict[str, dict[str, int]] = {
        m: {} for m in ("Komori", "SM74", "PM52")
    }
    for row in rows or []:
        key = _clean_ponto(str(row.get("FornecedorPonto") or ""))
        maquina = str(row.get("Maquina") or "").strip()
        if not key or key not in active_keys or maquina not in per_maquina:
            continue
        try:
            val = int(row.get("CotaChapas") or 0)
        except (TypeError, ValueError):
            val = 0
        if val < 0:
            val = 0
        prev = per_maquina[maquina].get(key)
        # Em duplicata, mantém o maior (cobre cópia órfã com o mesmo valor ou parcial).
        per_maquina[maquina][key] = val if prev is None else max(prev, val)
    return {m: sum(per_maquina[m].values()) for m in ("Komori", "SM74", "PM52")}


def recalc_cotas_from_fornecedores(*, ponto_atualizador: str) -> dict[str, Any]:
    """Cota máquina = soma fornecedores; cota inicial = soma das 3 máquinas."""
    ponto_fmt = format_ponto(_clean_ponto(ponto_atualizador))
    maquina_cotas = aggregate_cotas_by_maquina_from_fornecedores()
    for maquina, total in maquina_cotas.items():
        db.execute_query(
            """
            INSERT INTO tab_gravacao_pendente_maquina_config
                (Maquina, CotaChapas, PrecoChapa, AtualizadoEm, AtualizadoPorPonto)
            VALUES (%s, %s, 0, NOW(), %s)
            ON DUPLICATE KEY UPDATE
                CotaChapas = VALUES(CotaChapas),
                AtualizadoEm = NOW(),
                AtualizadoPorPonto = VALUES(AtualizadoPorPonto)
            """,
            (maquina, total, ponto_fmt),
        )

    new_global = sum(maquina_cotas.values())
    current = get_cota_inicial_chapas()
    delta = new_global - current
    if delta != 0:
        def tx(cursor):
            cursor.execute(
                """
                UPDATE tab_gravacao_pendente_config
                SET CotaInicialChapas = %s,
                    AtualizadoEm = NOW(),
                    AtualizadoPorPonto = %s
                WHERE Id = %s
                """,
                (new_global, ponto_fmt, _CONFIG_ROW_ID),
            )
            cursor.execute(
                """
                INSERT INTO tab_gravacao_pendente_cota_ajuste_log
                    (ValorAnterior, ValorNovo, Delta, Modo, Observacao, LancadoPorPonto)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    current,
                    new_global,
                    delta,
                    "recalc",
                    "Recálculo automático a partir das cotas por fornecedor/máquina",
                    ponto_fmt,
                ),
            )
            return new_global

        db.execute_transaction([tx])

    return {
        "cota_inicial_chapas": new_global,
        "maquinas": [
            {"maquina": m, "cota_chapas": maquina_cotas[m]} for m in ("Komori", "SM74", "PM52")
        ],
    }


def get_detalhes_config() -> dict[str, Any]:
    summary = build_historico_cota_summary()
    # Preços ainda vêm de maquina_config (legado) / fornecedor; cotas de máquina =
    # mesma agregação do banner (não a coluna CotaChapas possivelmente defasada).
    maquina_rows = db.execute_query(
        """
        SELECT Maquina, PrecoChapa
        FROM tab_gravacao_pendente_maquina_config
        ORDER BY FIELD(Maquina, 'Komori', 'SM74', 'PM52'), Maquina
        """
    )
    precos_maquina: dict[str, float] = {}
    for row in maquina_rows or []:
        nome = str(row.get("Maquina") or "").strip()
        preco = row.get("PrecoChapa")
        if isinstance(preco, Decimal):
            precos_maquina[nome] = float(preco)
        else:
            try:
                precos_maquina[nome] = float(preco or 0)
            except (TypeError, ValueError):
                precos_maquina[nome] = 0.0

    maquinas: list[dict[str, Any]] = []
    for item in summary.get("maquinas") or []:
        nome = str(item.get("maquina") or "")
        maquinas.append(
            {
                "maquina": nome,
                "cota_chapas": int(item.get("cota_chapas") or 0),
                "preco_chapa": precos_maquina.get(nome, 0.0),
            }
        )

    cota_rows = db.execute_query(
        """
        SELECT FornecedorPonto, Maquina, CotaChapas, PrecoChapa
        FROM tab_gravacao_pendente_fornecedor_cota
        """
    )
    cotas_by_ponto: dict[str, dict[str, int]] = {}
    precos_by_ponto: dict[str, dict[str, float]] = {}

    def _preco_float(raw: Any) -> float:
        if isinstance(raw, Decimal):
            return float(raw)
        try:
            return float(raw or 0)
        except (TypeError, ValueError):
            return 0.0

    for row in cota_rows or []:
        key = _clean_ponto(str(row.get("FornecedorPonto") or ""))
        maquina = str(row.get("Maquina") or "").strip()
        if not key or maquina not in ALLOWED_MAQUINAS_CONFIG:
            continue
        bucket = cotas_by_ponto.setdefault(
            key, {"Komori": 0, "SM74": 0, "PM52": 0}
        )
        bucket[maquina] = int(row.get("CotaChapas") or 0)
        precos = precos_by_ponto.setdefault(
            key, {"Komori": 0.0, "SM74": 0.0, "PM52": 0.0}
        )
        precos[maquina] = _preco_float(row.get("PrecoChapa"))

    fornecedor_cotas: list[dict[str, Any]] = []
    for item in list_fornecedores():
        ponto = str(item.get("ponto") or "")
        key = _clean_ponto(ponto)
        fornecedor_cotas.append(
            {
                "ponto": ponto,
                "nome": item.get("nome"),
                "cotas": cotas_by_ponto.get(
                    key, {"Komori": 0, "SM74": 0, "PM52": 0}
                ),
                "precos": precos_by_ponto.get(
                    key, {"Komori": 0.0, "SM74": 0.0, "PM52": 0.0}
                ),
            }
        )

    return {
        **summary,
        "maquinas": maquinas,
        "fornecedor_cotas": fornecedor_cotas,
    }


def upsert_maquina_config(
    maquina: str,
    preco_chapa: float | Decimal | int,
    ponto: str,
) -> dict[str, Any]:
    """Atualiza só o preço; cota da máquina vem do recálculo por fornecedor."""
    nome = str(maquina or "").strip()
    if nome not in ALLOWED_MAQUINAS_CONFIG:
        raise ValueError("Máquina inválida. Use Komori, SM74 ou PM52.")
    try:
        preco = float(preco_chapa)
    except (TypeError, ValueError) as exc:
        raise ValueError("preco_chapa inválido") from exc
    if preco < 0:
        raise ValueError("preco_chapa deve ser >= 0")
    ponto_fmt = format_ponto(_clean_ponto(ponto))
    db.execute_query(
        """
        INSERT INTO tab_gravacao_pendente_maquina_config
            (Maquina, CotaChapas, PrecoChapa, AtualizadoEm, AtualizadoPorPonto)
        VALUES (%s, 0, %s, NOW(), %s)
        ON DUPLICATE KEY UPDATE
            PrecoChapa = VALUES(PrecoChapa),
            AtualizadoEm = NOW(),
            AtualizadoPorPonto = VALUES(AtualizadoPorPonto)
        """,
        (nome, preco, ponto_fmt),
    )
    rows = db.execute_query(
        """
        SELECT CotaChapas FROM tab_gravacao_pendente_maquina_config
        WHERE Maquina = %s LIMIT 1
        """,
        (nome,),
    )
    cota_atual = int((rows[0] if rows else {}).get("CotaChapas") or 0)
    return {"maquina": nome, "cota_chapas": cota_atual, "preco_chapa": preco}


def upsert_fornecedor_cota(
    fornecedor_ponto: str,
    maquina: str,
    cota_chapas: int,
    ponto: str,
    *,
    preco_chapa: float | Decimal | int | None = None,
    recalc: bool = True,
) -> dict[str, Any]:
    fornecedor_fmt = resolve_fornecedor_ponto(fornecedor_ponto)
    nome_maq = str(maquina or "").strip()
    if nome_maq not in ALLOWED_MAQUINAS_CONFIG:
        raise ValueError("Máquina inválida. Use Komori, SM74 ou PM52.")
    try:
        cota_int = int(cota_chapas)
    except (TypeError, ValueError) as exc:
        raise ValueError("cota_chapas deve ser um inteiro >= 0") from exc
    if cota_int < 0:
        raise ValueError("cota_chapas deve ser >= 0")

    preco: float | None = None
    if preco_chapa is not None:
        try:
            preco = float(preco_chapa)
        except (TypeError, ValueError) as exc:
            raise ValueError("preco_chapa inválido") from exc
        if preco < 0:
            raise ValueError("preco_chapa deve ser >= 0")

    ponto_fmt = format_ponto(_clean_ponto(ponto))
    if preco is None:
        db.execute_query(
            """
            INSERT INTO tab_gravacao_pendente_fornecedor_cota
                (FornecedorPonto, Maquina, CotaChapas, PrecoChapa, AtualizadoEm, AtualizadoPorPonto)
            VALUES (%s, %s, %s, 0, NOW(), %s)
            ON DUPLICATE KEY UPDATE
                CotaChapas = VALUES(CotaChapas),
                AtualizadoEm = NOW(),
                AtualizadoPorPonto = VALUES(AtualizadoPorPonto)
            """,
            (fornecedor_fmt, nome_maq, cota_int, ponto_fmt),
        )
    else:
        db.execute_query(
            """
            INSERT INTO tab_gravacao_pendente_fornecedor_cota
                (FornecedorPonto, Maquina, CotaChapas, PrecoChapa, AtualizadoEm, AtualizadoPorPonto)
            VALUES (%s, %s, %s, %s, NOW(), %s)
            ON DUPLICATE KEY UPDATE
                CotaChapas = VALUES(CotaChapas),
                PrecoChapa = VALUES(PrecoChapa),
                AtualizadoEm = NOW(),
                AtualizadoPorPonto = VALUES(AtualizadoPorPonto)
            """,
            (fornecedor_fmt, nome_maq, cota_int, preco, ponto_fmt),
        )
    result: dict[str, Any] = {
        "ponto": fornecedor_fmt,
        "maquina": nome_maq,
        "cota_chapas": cota_int,
    }
    if preco is not None:
        result["preco_chapa"] = preco
    if recalc:
        result["recalc"] = recalc_cotas_from_fornecedores(ponto_atualizador=ponto_fmt)
    return result


def update_pagamento_nf(
    *,
    gravacao_externa_id: int,
    pagamento_nf_em: datetime | None,
) -> dict[str, Any]:
    try:
        ge_id = int(gravacao_externa_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("gravacao_externa_id inválido") from exc
    rows = db.execute_query(
        """
        SELECT Id FROM tab_os_gravacao_externa
        WHERE Id = %s
        LIMIT 1
        """,
        (ge_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Gravação Externa não encontrada.")
    db.execute_query(
        """
        UPDATE tab_os_gravacao_externa
        SET PagamentoNfEm = %s
        WHERE Id = %s
        """,
        (pagamento_nf_em, ge_id),
    )
    return {"gravacao_externa_id": ge_id, "pagamento_nf_em": pagamento_nf_em}


def _latest_externa_id_for_pendente_cursor(cursor, pendente_id: int) -> int | None:
    cursor.execute(
        """
        SELECT Id
        FROM tab_os_gravacao_externa
        WHERE OrigemPendenteId = %s
        ORDER BY Id DESC
        LIMIT 1
        """,
        (pendente_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        return int(row["Id"]) if row.get("Id") is not None else None
    return int(row[0]) if row[0] is not None else None


def update_controle_lancamento(
    *,
    gravacao_pendente_id: int,
    chapas: list[dict[str, Any]],
    criado_em: datetime | None,
    enviada_em: datetime | None,
    fornecedor_ponto: str | None,
    concluida_em: datetime | None,
    entrega_lancada_em: datetime | None,
    recebido_por_ponto: str | None,
    recebido_por_nome: str | None,
    pagamento_nf_em: datetime | None,
) -> dict[str, Any]:
    """Atualiza campos editáveis do controle e replica no grupo de juntada."""
    try:
        pendente_id = int(gravacao_pendente_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("gravacao_pendente_id inválido") from exc

    validated_chapas = validate_chapas_input(chapas, allow_empty=True)

    fornecedor_fmt: str | None = None
    fornecedor_raw = str(fornecedor_ponto or "").strip()
    if fornecedor_raw:
        fornecedor_fmt = resolve_fornecedor_ponto(fornecedor_raw)

    recebido_ponto = str(recebido_por_ponto or "").strip() or None
    if recebido_ponto:
        recebido_ponto = format_ponto(_clean_ponto(recebido_ponto)) or recebido_ponto
    recebido_nome = str(recebido_por_nome or "").strip() or None

    def tx(cursor):
        cursor.execute(
            """
            SELECT Id, JuntadaGrupoId
            FROM tab_os_gravacao_pendente
            WHERE Id = %s
            LIMIT 1
            FOR UPDATE
            """,
            (pendente_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Lançamento do controle não encontrado.")
        if isinstance(row, dict):
            juntada_raw = row.get("JuntadaGrupoId")
        else:
            juntada_raw = row[1] if len(row) > 1 else None
        juntada_id = str(juntada_raw).strip() if juntada_raw else None

        target_ids: list[int] = [pendente_id]
        if juntada_id:
            cursor.execute(
                """
                SELECT Id
                FROM tab_os_gravacao_pendente
                WHERE JuntadaGrupoId = %s
                  AND Status <> 'cancelada'
                ORDER BY Id ASC
                """,
                (juntada_id,),
            )
            group_rows = cursor.fetchall() or []
            target_ids = []
            for gr in group_rows:
                if isinstance(gr, dict):
                    target_ids.append(int(gr["Id"]))
                else:
                    target_ids.append(int(gr[0]))
            if pendente_id not in target_ids:
                target_ids.append(pendente_id)

        updated_externa_ids: list[int] = []
        for sid in target_ids:
            cursor.execute(
                """
                UPDATE tab_os_gravacao_pendente
                SET CriadoEm = %s, EnviadaEm = %s
                WHERE Id = %s
                """,
                (criado_em, enviada_em, sid),
            )
            cursor.execute(
                "DELETE FROM tab_os_gravacao_pendente_chapa WHERE GravacaoPendenteId = %s",
                (sid,),
            )
            for chapa in validated_chapas:
                cursor.execute(
                    """
                    INSERT INTO tab_os_gravacao_pendente_chapa
                        (GravacaoPendenteId, Maquina, QuantidadeChapas)
                    VALUES (%s, %s, %s)
                    """,
                    (sid, chapa["maquina"], chapa["quantidade"]),
                )

            ge_id = _latest_externa_id_for_pendente_cursor(cursor, sid)
            if ge_id is None:
                continue
            cursor.execute(
                """
                UPDATE tab_os_gravacao_externa
                SET FornecedorPonto = %s,
                    ConcluidaEm = %s,
                    EntregaLancadaEm = %s,
                    RecebidoPorPonto = %s,
                    RecebidoPorNome = %s,
                    PagamentoNfEm = %s
                WHERE Id = %s
                """,
                (
                    fornecedor_fmt,
                    concluida_em,
                    entrega_lancada_em,
                    recebido_ponto,
                    recebido_nome,
                    pagamento_nf_em,
                    ge_id,
                ),
            )
            updated_externa_ids.append(ge_id)

        return {
            "gravacao_pendente_id": pendente_id,
            "updated_pendente_ids": target_ids,
            "updated_externa_ids": updated_externa_ids,
            "juntada_grupo_id": juntada_id,
            "chapas": validated_chapas,
            "total_chapas": sum(c["quantidade"] for c in validated_chapas),
            "criado_em": criado_em,
            "enviada_em": enviada_em,
            "fornecedor_ponto": fornecedor_fmt,
            "concluida_em": concluida_em,
            "entrega_lancada_em": entrega_lancada_em,
            "recebido_por_ponto": recebido_ponto,
            "recebido_por_nome": recebido_nome,
            "pagamento_nf_em": pagamento_nf_em,
        }

    return db.execute_transaction([tx])[0]


def delete_controle_lancamento(gravacao_pendente_id: int) -> int:
    try:
        pendente_id = int(gravacao_pendente_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("gravacao_pendente_id inválido") from exc

    def tx(cursor):
        cursor.execute(
            """
            SELECT Id
            FROM tab_os_gravacao_pendente
            WHERE Id = %s
            LIMIT 1
            FOR UPDATE
            """,
            (pendente_id,),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Lançamento do controle não encontrado.")
        cursor.execute(
            "DELETE FROM tab_os_gravacao_pendente WHERE Id = %s",
            (pendente_id,),
        )
        return pendente_id

    return int(db.execute_transaction([tx])[0])


def build_historico_cota_summary() -> dict[str, Any]:
    """Cotas por máquina e total = soma das cotas por fornecedor ativos (deduplicada)."""
    total = get_total_chapas_gravadas_concluidas()
    by_name = aggregate_cotas_by_maquina_from_fornecedores()
    gravadas = get_chapas_gravadas_concluidas_por_maquina()
    maquinas = [
        {
            "maquina": m,
            "cota_chapas": by_name[m],
            "chapas_restantes": by_name[m] - gravadas.get(m, 0),
        }
        for m in ("Komori", "SM74", "PM52")
    ]
    cota_total = sum(by_name.values())
    return {
        # Campo legado no payload: valor efetivo = soma das cotas de fornecedor.
        "cota_inicial_chapas": cota_total,
        "total_chapas_geral": total,
        "chapas_restantes": cota_total - total,
        "maquinas": maquinas,
    }


def list_fornecedores() -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT Ponto, Nome
        FROM tabUsuarios
        WHERE Fornecedor = 1
          AND COALESCE(AuthAtivo, 1) = 1
        ORDER BY Nome
        """
    )
    items: list[dict[str, Any]] = []
    for row in rows or []:
        ponto_raw = row.get("Ponto")
        if ponto_raw is None or str(ponto_raw).strip() == "":
            continue
        items.append(
            {
                "ponto": format_ponto(_clean_ponto(str(ponto_raw))),
                "nome": row.get("Nome"),
            }
        )
    return items


def resolve_fornecedor_ponto(fornecedor_ponto: str | None) -> str:
    fornecedores = list_fornecedores()
    if not fornecedores:
        raise HTTPException(
            status_code=400,
            detail="Nenhum fornecedor cadastrado. Cadastre um usuário com flag Fornecedor.",
        )
    chosen_raw = str(fornecedor_ponto or "").strip()
    if not chosen_raw:
        if len(fornecedores) == 1:
            return str(fornecedores[0]["ponto"])
        raise HTTPException(
            status_code=400,
            detail="Selecione o fornecedor para envio à Gravação Externa.",
        )

    from services.support_ponto_utils import ponto_matches

    chosen = format_ponto(_clean_ponto(chosen_raw)) or chosen_raw
    for item in fornecedores:
        if ponto_matches(item.get("ponto"), chosen):
            return str(item["ponto"])
    raise HTTPException(status_code=400, detail="Fornecedor inválido ou inativo.")


def list_historico_concluidas(
    *,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int, int]:
    desde = ensure_controle_list_desde()

    # Uma linha por OS (sessão pendente mais recente após o cutoff).
    count_row = db.execute_query(
        """
        SELECT COUNT(*) AS cnt
        FROM (
            SELECT gp.OsAno, gp.OsNro
            FROM tab_os_gravacao_pendente gp
            WHERE gp.Status <> 'cancelada'
              AND gp.CriadoEm >= %s
            GROUP BY gp.OsAno, gp.OsNro
        ) uniq
        """,
        (desde,),
    )
    total = int((count_row[0] if count_row else {}).get("cnt") or 0)

    total_chapas = get_total_chapas_gravadas_concluidas()

    rows = db.execute_query(
        """
        SELECT
            gp.Id AS gravacao_pendente_id,
            ge.Id AS gravacao_externa_id,
            gp.OsAno AS ano,
            gp.OsNro AS nr_os,
            gp.JuntadaGrupoId AS juntada_grupo_id,
            gp.LancadoPorPonto AS lancado_por_ponto,
            gp.LancadoPorNome AS lancado_por_nome,
            gp.CriadoEm AS criado_em,
            gp.EnviadaEm AS enviada_em,
            ge.FornecedorPonto AS fornecedor_ponto,
            uf.Nome AS fornecedor_nome,
            ge.IniciadoEm AS iniciado_em,
            ge.IniciadoPorPonto AS iniciado_por_ponto,
            ge.ConcluidaEm AS concluida_em,
            ge.EntregaLancadaEm AS entrega_lancada_em,
            ge.RecebidoPorPonto AS recebido_por_ponto,
            COALESCE(NULLIF(TRIM(ge.RecebidoPorNome), ''), ur.Nome) AS recebido_por_nome,
            ge.PagamentoNfEm AS pagamento_nf_em,
            COALESCE(NULLIF(TRIM(gp.Cliente), ''), NULLIF(TRIM(p.NomeUsuario), '')) AS solicitante,
            (
                SELECT d.Titulo
                FROM tabDetalhesServico d
                WHERE d.NroProtocoloLinkDet = gp.OsNro
                  AND d.AnoProtocoloLinkDet = gp.OsAno
                LIMIT 1
            ) AS titulo,
            (
                SELECT COALESCE(SUM(c.QuantidadeChapas), 0)
                FROM tab_os_gravacao_pendente_chapa c
                WHERE c.GravacaoPendenteId = gp.Id
            ) AS total_chapas_os
        FROM tab_os_gravacao_pendente gp
        INNER JOIN (
            SELECT OsAno, OsNro, MAX(Id) AS max_id
            FROM tab_os_gravacao_pendente
            WHERE Status <> 'cancelada'
              AND CriadoEm >= %s
            GROUP BY OsAno, OsNro
        ) latest_gp ON latest_gp.max_id = gp.Id
        LEFT JOIN (
            SELECT ge1.*
            FROM tab_os_gravacao_externa ge1
            INNER JOIN (
                SELECT OrigemPendenteId, MAX(Id) AS max_id
                FROM tab_os_gravacao_externa
                WHERE OrigemPendenteId IS NOT NULL
                GROUP BY OrigemPendenteId
            ) latest ON latest.max_id = ge1.Id
        ) ge ON ge.OrigemPendenteId = gp.Id
        LEFT JOIN tabProtocolos p
            ON p.NroProtocolo = gp.OsNro AND p.AnoProtocolo = gp.OsAno
        LEFT JOIN tabUsuarios uf
            ON uf.Ponto = NULLIF(
                CAST(
                    REPLACE(REPLACE(IFNULL(ge.FornecedorPonto, ''), '.', ''), '-', '')
                    AS UNSIGNED
                ),
                0
            )
        LEFT JOIN tabUsuarios ur
            ON ur.Ponto = NULLIF(
                CAST(
                    REPLACE(REPLACE(IFNULL(ge.RecebidoPorPonto, ''), '.', ''), '-', '')
                    AS UNSIGNED
                ),
                0
            )
        ORDER BY gp.CriadoEm DESC, gp.Id DESC
        LIMIT %s OFFSET %s
        """,
        (desde, limit, offset),
    )

    items = []
    for row in rows or []:
        pendente_id = row.get("gravacao_pendente_id")
        chapas_rows = []
        if pendente_id:
            chapas_rows = db.execute_query(
                """
                SELECT Maquina, QuantidadeChapas
                FROM tab_os_gravacao_pendente_chapa
                WHERE GravacaoPendenteId = %s
                ORDER BY Id ASC
                """,
                (pendente_id,),
            )
        ge_id = row.get("gravacao_externa_id")
        juntada_raw = row.get("juntada_grupo_id")
        juntada_id = str(juntada_raw).strip() if juntada_raw else None
        membros = [{"nr_os": int(row["nr_os"]), "ano": int(row["ano"])}]
        items.append(
            {
                "gravacao_pendente_id": int(pendente_id) if pendente_id is not None else None,
                "gravacao_externa_id": int(ge_id) if ge_id is not None else None,
                "ano": int(row["ano"]),
                "nr_os": int(row["nr_os"]),
                "juntada_grupo_id": juntada_id,
                "membros": membros,
                "solicitante": row.get("solicitante"),
                "titulo": row.get("titulo"),
                "lancado_por_ponto": row.get("lancado_por_ponto"),
                "lancado_por_nome": row.get("lancado_por_nome"),
                "iniciado_por_ponto": row.get("iniciado_por_ponto"),
                "iniciado_em": row.get("iniciado_em"),
                "criado_em": row.get("criado_em"),
                "enviada_em": row.get("enviada_em"),
                "fornecedor_ponto": row.get("fornecedor_ponto"),
                "fornecedor_nome": row.get("fornecedor_nome"),
                "concluida_em": row.get("concluida_em"),
                "entrega_lancada_em": row.get("entrega_lancada_em"),
                "recebido_por_ponto": row.get("recebido_por_ponto"),
                "recebido_por_nome": row.get("recebido_por_nome"),
                "pagamento_nf_em": row.get("pagamento_nf_em"),
                "total_chapas": int(row.get("total_chapas_os") or 0),
                "chapas_por_maquina": [
                    {
                        "maquina": str(c.get("Maquina") or ""),
                        "quantidade": int(c.get("QuantidadeChapas") or 0),
                    }
                    for c in (chapas_rows or [])
                ],
            }
        )
    _enrich_historico_juntada_membros(items)
    return items, total, total_chapas


def _enrich_historico_juntada_membros(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Inclui membros não cancelados do mesmo JuntadaGrupoId (mantém 1 linha por OS)."""
    group_ids = sorted(
        {
            str(item.get("juntada_grupo_id") or "").strip()
            for item in items
            if str(item.get("juntada_grupo_id") or "").strip()
        }
    )
    if not group_ids:
        return items

    placeholders = ", ".join(["%s"] * len(group_ids))
    rows = db.execute_query(
        f"""
        SELECT OsNro AS nr_os, OsAno AS ano, JuntadaGrupoId AS juntada_grupo_id
        FROM tab_os_gravacao_pendente
        WHERE Status <> 'cancelada'
          AND JuntadaGrupoId IN ({placeholders})
        """,
        tuple(group_ids),
    )
    by_group: dict[str, list[dict[str, int]]] = {}
    for row in rows or []:
        gid = str(row.get("juntada_grupo_id") or "").strip()
        if not gid:
            continue
        by_group.setdefault(gid, []).append(
            {"nr_os": int(row["nr_os"]), "ano": int(row["ano"])}
        )

    for item in items:
        gid = str(item.get("juntada_grupo_id") or "").strip()
        if not gid:
            continue
        membros = list(item.get("membros") or [])
        for extra in by_group.get(gid, []):
            if not any(
                m["nr_os"] == extra["nr_os"] and m["ano"] == extra["ano"] for m in membros
            ):
                membros.append(extra)
        item["membros"] = sorted(membros, key=lambda m: (m["nr_os"], m["ano"]))
    return items


def user_can_access_pendente_session(
    session: dict[str, Any],
    *,
    ponto: str,
    has_pendente_permission: bool,
) -> bool:
    if has_pendente_permission:
        return True
    from services.support_ponto_utils import ponto_matches

    return ponto_matches(session.get("lancado_por_ponto"), ponto)


def require_pendente_session_access(
    session: dict[str, Any],
    *,
    ponto: str,
    has_pendente_permission: bool,
) -> None:
    if not user_can_access_pendente_session(
        session,
        ponto=ponto,
        has_pendente_permission=has_pendente_permission,
    ):
        raise HTTPException(status_code=403, detail="Acesso negado à sessão de Gravação Pendente.")


def update_pendente_session_arquivos(
    *,
    ano: int,
    os_id: int,
    arquivos: list[dict[str, str]],
    chapas: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    session = get_active_pendente_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Pendente não encontrada.")
    if session["status"] != "ativa":
        raise HTTPException(
            status_code=400,
            detail="Só é possível alterar arquivos antes de enviar para Gravação Externa.",
        )
    validated = validate_network_arquivos_input(arquivos)
    validated_chapas = (
        validate_chapas_input(
            chapas,
            allow_empty=arquivos_are_pdf_only(validated),
        )
        if chapas is not None
        else None
    )

    targets = [session]
    juntada_id = session.get("juntada_grupo_id")
    if juntada_id:
        targets = list_active_pendente_by_juntada(str(juntada_id)) or [session]

    def tx(cursor):
        for target in targets:
            sid = int(target["id"])
            cursor.execute(
                "DELETE FROM tab_os_gravacao_pendente_arquivo WHERE GravacaoPendenteId = %s",
                (sid,),
            )
            for idx, arquivo in enumerate(validated):
                cursor.execute(
                    """
                    INSERT INTO tab_os_gravacao_pendente_arquivo
                        (GravacaoPendenteId, AbsolutePath, NomeArquivo, TamanhoBytes, Ordem, Maquina)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        sid,
                        arquivo["absolute_path"],
                        arquivo["nome"],
                        arquivo.get("tamanho_bytes"),
                        idx,
                        arquivo.get("maquina"),
                    ),
                )
            if validated_chapas is not None:
                cursor.execute(
                    "DELETE FROM tab_os_gravacao_pendente_chapa WHERE GravacaoPendenteId = %s",
                    (sid,),
                )
                for chapa in validated_chapas:
                    cursor.execute(
                        """
                        INSERT INTO tab_os_gravacao_pendente_chapa
                            (GravacaoPendenteId, Maquina, QuantidadeChapas)
                        VALUES (%s, %s, %s)
                        """,
                        (sid, chapa["maquina"], chapa["quantidade"]),
                    )
        return int(session["id"])

    db.execute_transaction([tx])
    from services.gravacao_preview_cache_service import enqueue_preview_warmup

    enqueue_preview_warmup(validated)
    updated = get_active_pendente_session(ano, os_id) or session
    return build_pendente_detail(updated)


def update_pendente_session_observacao(
    *,
    ano: int,
    os_id: int,
    observacao: str,
) -> dict[str, Any]:
    session = get_active_pendente_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Pendente não encontrada.")
    if session["status"] != "ativa":
        raise HTTPException(
            status_code=400,
            detail="Só é possível alterar a observação antes de enviar para Gravação Externa.",
        )
    obs_text = _normalize_session_observacao(observacao)
    targets = [session]
    juntada_id = session.get("juntada_grupo_id")
    if juntada_id:
        targets = list_active_pendente_by_juntada(str(juntada_id)) or [session]

    def tx(cursor):
        for target in targets:
            cursor.execute(
                "UPDATE tab_os_gravacao_pendente SET Observacao = %s WHERE Id = %s",
                (obs_text, int(target["id"])),
            )
        return int(session["id"])

    db.execute_transaction([tx])
    updated = get_active_pendente_session(ano, os_id) or session
    return build_pendente_detail(updated)


def _enviar_uma_pendente_para_externa_cursor(
    cursor,
    *,
    pendente: dict[str, Any],
    arquivos: list[dict[str, Any]],
    ponto_fmt: str,
    setor_link: str,
    fornecedor_fmt: str | None,
) -> str:
    """Marca pendente como enviada, cria andamento + sessão externa. Retorna new_cod."""
    ano = int(pendente["os_ano"])
    os_id = int(pendente["os_nro"])
    cursor.execute(
        """
        UPDATE tab_os_gravacao_pendente
        SET Status = 'enviada', EnviadaEm = NOW(), EnviadaPorPonto = %s
        WHERE Id = %s AND Status = 'ativa'
        """,
        (ponto_fmt, pendente["id"]),
    )
    if cursor.rowcount != 1:
        raise HTTPException(
            status_code=409,
            detail=f"OS {os_id}/{ano}: lançamento já enviado para Gravação Externa.",
        )

    from routers.andamento_helpers import (
        format_andamento_obs,
        format_gravacao_envio_externa_obs,
        with_juntada_obs_prefix,
    )
    from routers.os_audit_service import log_andamento_added
    from services.andamento_operacional import insert_andamento_as_ultimo, next_cod_status_for_os

    chapas_rows = []
    cursor.execute(
        """
        SELECT Maquina, QuantidadeChapas
        FROM tab_os_gravacao_pendente_chapa
        WHERE GravacaoPendenteId = %s
        ORDER BY Id
        """,
        (int(pendente["id"]),),
    )
    for r in cursor.fetchall() or []:
        chapas_rows.append(
            {
                "maquina": str(r.get("Maquina") or "").strip(),
                "quantidade": int(r.get("QuantidadeChapas") or 0),
            }
        )

    obs_body = with_juntada_obs_prefix(
        format_gravacao_envio_externa_obs(chapas_rows),
        juntada_membros_label(pendente.get("juntada_grupo_id")),
    )
    obs = format_andamento_obs(obs_body)
    new_cod = next_cod_status_for_os(cursor, os_id, ano)
    insert_andamento_as_ultimo(
        cursor,
        cod_status=new_cod,
        nro=os_id,
        ano=ano,
        situacao=SITUACAO_SAIDA_P,
        setor=setor_link,
        obs=obs,
        ponto=ponto_fmt,
    )
    log_andamento_added(
        cursor,
        nro=os_id,
        ano=ano,
        cod_status=new_cod,
        situacao=SITUACAO_SAIDA_P,
        setor=setor_link,
        obs=obs,
        ponto=ponto_fmt,
        origem="gravacao_pendente_enviar",
    )

    externa_arquivos = []
    for idx, arq in enumerate(arquivos):
        externa_arquivos.append(
            {
                "relative": "",
                "nome": arq["nome"],
                "absolute_path": arq["absolute_path"],
                "tamanho_bytes": arq.get("tamanho_bytes"),
                "ordem": idx,
                "maquina": arq.get("maquina"),
            }
        )

    insert_session_with_arquivos_cursor(
        cursor,
        ano=ano,
        os_id=os_id,
        cod_status=new_cod,
        ponto_fmt=str(pendente.get("lancado_por_ponto") or ponto_fmt),
        lancado_por_nome=pendente.get("lancado_por_nome"),
        validated_arquivos=externa_arquivos,
        origem_pendente_id=int(pendente["id"]),
        fornecedor_ponto=fornecedor_fmt,
        juntada_grupo_id=pendente.get("juntada_grupo_id"),
        observacao=pendente.get("observacao"),
    )

    return new_cod


def enviar_para_gravacao_externa(
    *,
    ano: int,
    os_id: int,
    operador_ponto: str,
    setor: str = DEFAULT_SETOR_ENVIO_EXTERNA,
    fornecedor_ponto: str | None = None,
) -> dict[str, Any]:
    """Registra andamento Gravação Externa e cria sessão externa a partir da pendente.

    Se a sessão fizer parte de uma juntada, envia todas as sessões ativas do grupo.
    """
    setor_link = (setor or DEFAULT_SETOR_ENVIO_EXTERNA).strip() or DEFAULT_SETOR_ENVIO_EXTERNA
    fornecedor_fmt = resolve_fornecedor_ponto(fornecedor_ponto)

    pendente = get_active_pendente_session(ano, os_id)
    if not pendente:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Pendente não encontrada.")

    targets = [pendente]
    juntada_id = pendente.get("juntada_grupo_id")
    if juntada_id:
        targets = list_active_pendente_by_juntada(str(juntada_id)) or [pendente]

    detail = build_pendente_detail(pendente)
    arquivos = detail.get("arquivos") or []
    if not arquivos:
        raise HTTPException(status_code=400, detail="Nenhum arquivo na sessão pendente.")

    ponto_fmt = format_ponto(_clean_ponto(operador_ponto))

    def tx(cursor):
        codes: list[tuple[int, int, str]] = []
        for target in targets:
            # Usa arquivos da âncora (mesmos paths em todas as sessões do grupo).
            new_cod = _enviar_uma_pendente_para_externa_cursor(
                cursor,
                pendente=target,
                arquivos=arquivos,
                ponto_fmt=ponto_fmt,
                setor_link=setor_link,
                fornecedor_fmt=fornecedor_fmt,
            )
            codes.append((int(target["os_ano"]), int(target["os_nro"]), new_cod))
        return codes

    codes = db.execute_transaction([tx])[0]
    for a, n, new_cod in codes:
        _notify_enviar_gravacao_externa(
            ano=a,
            os_id=n,
            new_cod=str(new_cod),
            setor=setor_link,
        )
    send_gravacao_notification_email(
        event="encaminhada",
        ano=ano,
        os_id=os_id,
        target_ponto=fornecedor_fmt,
        target_nome=_lookup_usuario_nome(fornecedor_fmt),
        operador_ponto=ponto_fmt,
    )
    session = get_active_session(ano, os_id)
    if not session:
        raise HTTPException(status_code=500, detail="Falha ao criar sessão externa.")
    from services.gravacao_preview_cache_service import enqueue_preview_warmup

    enqueue_preview_warmup(arquivos)
    return build_session_detail(session)


def _notify_enviar_gravacao_externa(
    *,
    ano: int,
    os_id: int,
    new_cod: str,
    setor: str,
) -> None:
    """Materializa busca, WebSocket e replica andamento no MDB (mesmo padrão do POST history)."""
    from services.os_andamento_post_change_service import after_andamento_changed

    after_andamento_changed(
        os_id,
        ano,
        "history_added",
        codstatus=new_cod,
        situacao=SITUACAO_SAIDA_P,
        setor=setor,
        source="enviar_gravacao_externa",
    )

    session = get_active_session(ano, os_id)
    if session:
        from services.gravacao_externa_realtime_service import push_gravacao_externa_sessao_criada

        push_gravacao_externa_sessao_criada(
            gravacao_externa_id=int(session["id"]),
            os_ano=ano,
            os_nro=os_id,
            lancado_por_ponto=str(session.get("lancado_por_ponto") or ""),
        )

    def _sync_to_mdb() -> None:
        from routers.mdb_writer import sync_andamento_from_mysql_to_mdb

        sync_andamento_from_mysql_to_mdb(new_cod, os_id, ano, operation="insert")

    try:
        from routers.mdb_writer import dispatch_mdb_sync

        dispatch_mdb_sync(
            "gravacao_enviar_externa",
            _sync_to_mdb,
            cod_status=new_cod,
            nro=os_id,
            ano=ano,
        )
    except Exception as exc:
        logger.warning("Falha ao enfileirar sync MDB após enviar gravação externa: %s", exc)


def repair_orphan_gravacao_externa_sessions() -> list[dict[str, Any]]:
    """Recria andamento Gravação Externa quando a sessão existe mas o CodStatus sumiu do MySQL."""
    rows = db.execute_query(
        """
        SELECT ge.Id, ge.OsNro, ge.OsAno, ge.CodStatus, ge.LancadoPorPonto, ge.LancadoPorNome,
               ge.JuntadaGrupoId
        FROM tab_os_gravacao_externa ge
        WHERE ge.Status IN ('pendente', 'iniciada')
          AND NOT EXISTS (
            SELECT 1 FROM tabAndamento a
            WHERE a.CodStatus COLLATE utf8mb4_general_ci
                = ge.CodStatus COLLATE utf8mb4_general_ci
          )
        ORDER BY ge.Id ASC
        """
    )
    repaired: list[dict[str, Any]] = []
    for row in rows or []:
        os_id = int(row["OsNro"])
        ano = int(row["OsAno"])
        cod_status = str(row["CodStatus"] or "").strip()
        if not cod_status:
            continue
        ponto_fmt = format_ponto(_clean_ponto(str(row.get("LancadoPorPonto") or "")))
        juntada_label = juntada_membros_label(
            str(row.get("JuntadaGrupoId") or "").strip() or None
        )

        def tx(
            cursor,
            *,
            _cod=cod_status,
            _os=os_id,
            _ano=ano,
            _ponto=ponto_fmt,
            _juntada_label=juntada_label,
        ):
            from routers.andamento_helpers import (
                format_andamento_obs,
                format_gravacao_envio_externa_obs,
                with_juntada_obs_prefix,
            )
            from routers.os_audit_service import log_andamento_added
            from services.andamento_operacional import insert_andamento_as_ultimo

            obs = format_andamento_obs(
                with_juntada_obs_prefix(
                    format_gravacao_envio_externa_obs([]),
                    _juntada_label,
                )
            )
            insert_andamento_as_ultimo(
                cursor,
                cod_status=_cod,
                nro=_os,
                ano=_ano,
                situacao=SITUACAO_SAIDA_P,
                setor=DEFAULT_SETOR_ENVIO_EXTERNA,
                obs=obs,
                ponto=_ponto,
            )
            log_andamento_added(
                cursor,
                nro=_os,
                ano=_ano,
                cod_status=_cod,
                situacao=SITUACAO_SAIDA_P,
                setor=DEFAULT_SETOR_ENVIO_EXTERNA,
                obs=obs,
                ponto=_ponto,
                origem="repair_gravacao_externa_orfa",
            )
            return _cod

        db.execute_transaction([tx])
        _notify_enviar_gravacao_externa(
            ano=ano,
            os_id=os_id,
            new_cod=cod_status,
            setor=DEFAULT_SETOR_ENVIO_EXTERNA,
        )
        repaired.append(
            {
                "os_id": os_id,
                "ano": ano,
                "cod_status": cod_status,
                "ultimo_status": cod_status,
            }
        )
    return repaired


def repair_gravacao_externa_ultimo_status(ano: int, os_id: int) -> Optional[str]:
    """Recalcula UltimoStatus quando Gravação Externa ficou sem flag ativa."""

    def tx(cursor):
        from services.andamento_operacional import recalc_ultimo_status_operacional

        return recalc_ultimo_status_operacional(cursor, os_id, ano)

    promoted = db.execute_transaction([tx])[0]
    if promoted:
        _notify_enviar_gravacao_externa(
            ano=ano,
            os_id=os_id,
            new_cod=str(promoted),
            setor=DEFAULT_SETOR_ENVIO_EXTERNA,
        )
    return promoted
