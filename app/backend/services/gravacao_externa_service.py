"""Serviço de Gravação Externa — sessões, arquivos e mensagens."""
from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import HTTPException
from PIL import Image

from database import db
from routers.andamento_helpers import format_ponto
from services.gravacao_externa_realtime_service import (
    push_gravacao_externa_iniciada,
    push_gravacao_externa_message,
)
from services.notification_push_service import insert_user_notification, push_user_notification
from services.gravacao_externa_email_service import send_gravacao_notification_email
from services.gravacao_componente import (
    COMPONENTE_TODOS,
    gravacao_componente_label,
    normalize_gravacao_componente,
    normalize_stored_gravacao_componente,
    with_gravacao_componente_obs_prefix,
)
from services.os_vinculo_grupo_service import _clean_ponto, _lookup_usuario_nome

logger = logging.getLogger(__name__)

# Legado (ainda aceito em reparo / cancelamento até limpar a fila)
SITUACAO_GRAVACAO_EXTERNA = "Gravação Externa"
SITUACAO_AGUARD_RETIRADA = "Aguard. Retirada"  # legado; conclusão passa a Gravação Ext. Concluída

SITUACAO_SAIDA_P = "Saída p/"
SITUACAO_RECEBIDO = "Recebido"
SITUACAO_GRAV_CONCLUIDA = "Gravação Ext. Concluída"
SITUACAO_GRAVACAO = "Gravação"  # legado; entrega passa a Recebido + setor Gravação

SETOR_GRAV_EXTERNA = "Grav. Externa"
SETOR_GRAVACAO_CONCLUIDA = "SEGEP"
SETOR_ENTREGA_CHAPAS = "Gravação"
SETOR_GRAVACAO = "Gravação"

SITUACOES_OPERACIONAIS_EXTERNA = frozenset({SITUACAO_SAIDA_P, SITUACAO_RECEBIDO})
ACTIVE_STATUSES = frozenset({"pendente", "iniciada"})
ALLOWED_EXTENSIONS = frozenset({".pdf", ".tif", ".tiff"})
MESSAGE_MAX_LENGTH = 8000
TIF_PREVIEW_MAX_EDGE = int(os.getenv("SAGRA_TIF_PREVIEW_MAX_EDGE", "2400"))


def is_gravacao_externa_situacao(situacao: str | None) -> bool:
    """Legado: andamento exatamente 'Gravação Externa'."""
    return str(situacao or "").strip() == SITUACAO_GRAVACAO_EXTERNA


def is_em_gravacao_externa_operacional(
    situacao: str | None,
    setor: str | None = None,
) -> bool:
    """OS ainda no fluxo operacional da Gravação Externa (antes de Gravação Ext. Concluída)."""
    sit = str(situacao or "").strip()
    setr = str(setor or "").strip()
    if sit == SITUACAO_GRAVACAO_EXTERNA:
        return True
    return setr == SETOR_GRAV_EXTERNA and sit in SITUACOES_OPERACIONAIS_EXTERNA


def cancel_active_externa_sessions(ano: int, os_id: int) -> None:
    """Encerra sessões ativas quando a OS deixa de estar em Gravação Externa."""
    db.execute_query(
        """
        UPDATE tab_os_gravacao_externa
        SET Status = 'cancelada'
        WHERE OsAno = %s AND OsNro = %s AND Status IN ('pendente', 'iniciada')
        """,
        (ano, os_id),
    )
    logger.info("Sessões Gravação Externa canceladas para OS %s/%s", os_id, ano)


def cancel_active_externa_sessions_cursor(cursor, ano: int, os_id: int) -> None:
    """Encerra sessões ativas de Gravação Externa (permite relançar com novos arquivos)."""
    cursor.execute(
        """
        UPDATE tab_os_gravacao_externa
        SET Status = 'cancelada'
        WHERE OsAno = %s AND OsNro = %s AND Status IN ('pendente', 'iniciada')
        """,
        (ano, os_id),
    )


def remove_externa_from_queue(gravacao_externa_id: int) -> dict[str, Any]:
    """Remove uma sessão (ou sua juntada) da fila do Birô sem apagar seus dados."""
    try:
        externa_id = int(gravacao_externa_id)
    except (TypeError, ValueError) as exc:
        raise ValueError("gravacao_externa_id inválido") from exc
    if externa_id <= 0:
        raise ValueError("gravacao_externa_id inválido")

    def tx(cursor):
        cursor.execute(
            """
            SELECT Id, JuntadaGrupoId, Status
            FROM tab_os_gravacao_externa
            WHERE Id = %s
            LIMIT 1
            FOR UPDATE
            """,
            (externa_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(
                status_code=404,
                detail="Sessão de Gravação Externa não encontrada.",
            )

        if isinstance(row, dict):
            juntada_raw = row.get("JuntadaGrupoId")
            status = str(row.get("Status") or "")
        else:
            juntada_raw = row[1] if len(row) > 1 else None
            status = str(row[2] if len(row) > 2 else "")
        if status not in ACTIVE_STATUSES:
            raise HTTPException(
                status_code=409,
                detail="A OS não está mais na lista pendente do Birô.",
            )

        juntada_id = str(juntada_raw).strip() if juntada_raw else None
        target_ids = [externa_id]
        if juntada_id:
            cursor.execute(
                """
                SELECT Id
                FROM tab_os_gravacao_externa
                WHERE JuntadaGrupoId = %s
                  AND Status IN ('pendente', 'iniciada')
                ORDER BY Id
                FOR UPDATE
                """,
                (juntada_id,),
            )
            target_ids = [
                int(group_row.get("Id") if isinstance(group_row, dict) else group_row[0])
                for group_row in (cursor.fetchall() or [])
            ]
            if externa_id not in target_ids:
                target_ids.append(externa_id)

        updated_ids: list[int] = []
        for target_id in target_ids:
            cursor.execute(
                """
                UPDATE tab_os_gravacao_externa
                SET Status = 'cancelada'
                WHERE Id = %s AND Status IN ('pendente', 'iniciada')
                """,
                (target_id,),
            )
            if cursor.rowcount == 1:
                updated_ids.append(target_id)

        if externa_id not in updated_ids:
            raise HTTPException(
                status_code=409,
                detail="A OS não está mais na lista pendente do Birô.",
            )
        return {
            "removed": True,
            "gravacao_externa_id": externa_id,
            "removed_ids": updated_ids,
            "juntada_grupo_id": juntada_id,
        }

    results = db.execute_transaction([tx])
    return results[0]


def cleanup_stale_externa_sessions() -> list[dict[str, Any]]:
    """Legado sem efeito: a fila do Birô não depende mais do último andamento."""
    return []


def _normalize_relative_path(relative: str) -> str:
    cleaned = (relative or "").replace("\\", "/").strip().strip("/")
    if not cleaned:
        raise ValueError("Caminho relativo inválido.")
    parts = [part for part in cleaned.split("/") if part and part != "."]
    for part in parts:
        if part == "..":
            raise ValueError("Caminho relativo inválido.")
    return "/".join(parts)


def _resolve_os_root_path(ano: int, os_id: int) -> Optional[str]:
    from routers.os_routes import _get_os_folder_path

    path = _get_os_folder_path(ano, os_id)
    if path and os.path.isdir(path):
        return path
    local_path = os.path.abspath(f"storage_test/{ano}/{os_id}")
    if os.path.isdir(local_path):
        return local_path
    return None


def _resolve_os_file_path(ano: int, os_id: int, relative: str) -> str:
    from routers.os_routes import _resolve_os_relative_path

    root = _resolve_os_root_path(ano, os_id)
    if not root:
        raise ValueError("Pasta da OS não encontrada.")
    rel = _normalize_relative_path(relative)
    full = _resolve_os_relative_path(root, rel)
    if not os.path.isfile(full):
        raise ValueError(f"Arquivo não encontrado: {rel}")
    ext = Path(full).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Tipo de arquivo não permitido: {ext}")
    return full


def validate_arquivos_input(
    ano: int,
    os_id: int,
    arquivos: list[dict[str, str]],
) -> list[dict[str, Any]]:
    if not arquivos:
        raise ValueError("Selecione ao menos um arquivo para Gravação Externa.")
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, item in enumerate(arquivos):
        relative = _normalize_relative_path(str(item.get("relative") or ""))
        nome = str(item.get("nome") or Path(relative).name).strip() or Path(relative).name
        if relative in seen:
            continue
        seen.add(relative)
        full = _resolve_os_file_path(ano, os_id, relative)
        size = None
        try:
            size = os.path.getsize(full)
        except OSError:
            size = None
        validated.append(
            {
                "relative": relative,
                "nome": nome,
                "tamanho_bytes": size,
                "ordem": idx,
            }
        )
    if not validated:
        raise ValueError("Selecione ao menos um arquivo válido para Gravação Externa.")
    return validated


def has_active_session(ano: int, os_id: int) -> bool:
    rows = db.execute_query(
        """
        SELECT Id FROM tab_os_gravacao_externa
        WHERE OsAno = %s AND OsNro = %s AND Status IN ('pendente', 'iniciada')
        LIMIT 1
        """,
        (ano, os_id),
    )
    return bool(rows)


def insert_session_with_arquivos_cursor(
    cursor,
    *,
    ano: int,
    os_id: int,
    cod_status: str,
    ponto_fmt: str,
    lancado_por_nome: str | None,
    validated_arquivos: list[dict[str, Any]],
    origem_pendente_id: int | None = None,
    fornecedor_ponto: str | None = None,
    juntada_grupo_id: str | None = None,
    observacao: str | None = None,
    componente: str = COMPONENTE_TODOS,
    allow_replace_active: bool = True,
    allow_coexisting_parts: bool = False,
) -> int:
    """Cria sessão externa com arquivos.

    ``allow_coexisting_parts`` só deve ser usado para partes desmembradas por
    máquina de uma mesma sessão pendente: as partes são disjuntas e podem
    coexistir com o mesmo componente ativo no Birô.
    """
    componente_normalized = normalize_gravacao_componente(componente)
    if not allow_coexisting_parts:
        _guard_active_externa_componente_cursor(
            cursor,
            ano=ano,
            os_id=os_id,
            componente_normalized=componente_normalized,
            allow_replace_active=allow_replace_active,
        )
    fornecedor_fmt = (
        format_ponto(_clean_ponto(fornecedor_ponto)) if fornecedor_ponto else None
    ) or None
    grupo_id = (juntada_grupo_id or "").strip() or None
    obs_text = str(observacao or "").strip() or None
    cursor.execute(
        """
        INSERT INTO tab_os_gravacao_externa
            (OsAno, OsNro, CodStatus, Componente, LancadoPorPonto, LancadoPorNome, Status,
             OrigemPendenteId, FornecedorPonto, JuntadaGrupoId, Observacao)
        VALUES (%s, %s, %s, %s, %s, %s, 'pendente', %s, %s, %s, %s)
        """,
        (
            ano,
            os_id,
            cod_status,
            componente_normalized,
            ponto_fmt,
            lancado_por_nome,
            origem_pendente_id,
            fornecedor_fmt,
            grupo_id,
            obs_text,
        ),
    )
    session_id = int(cursor.lastrowid)
    for arquivo in validated_arquivos:
        abs_path = arquivo.get("absolute_path")
        relative = str(arquivo.get("relative") or "")
        if abs_path:
            cursor.execute(
                """
                INSERT INTO tab_os_gravacao_externa_arquivo
                    (GravacaoExternaId, RelativePath, AbsolutePath, NomeArquivo, TamanhoBytes, Ordem, Maquina)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    relative,
                    abs_path,
                    arquivo["nome"],
                    arquivo.get("tamanho_bytes"),
                    arquivo["ordem"],
                    arquivo.get("maquina"),
                ),
            )
        else:
            cursor.execute(
                """
                INSERT INTO tab_os_gravacao_externa_arquivo
                    (GravacaoExternaId, RelativePath, NomeArquivo, TamanhoBytes, Ordem, Maquina)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    relative,
                    arquivo["nome"],
                    arquivo.get("tamanho_bytes"),
                    arquivo["ordem"],
                    arquivo.get("maquina"),
                ),
            )
    return session_id


def _guard_active_externa_componente_cursor(
    cursor,
    *,
    ano: int,
    os_id: int,
    componente_normalized: str,
    allow_replace_active: bool,
) -> None:
    cursor.execute(
        """
        SELECT Id, Componente
        FROM tab_os_gravacao_externa
        WHERE OsAno = %s AND OsNro = %s AND Status IN ('pendente', 'iniciada')
        FOR UPDATE
        """,
        (ano, os_id),
    )
    active_rows = cursor.fetchall() or []
    active_components = {
        normalize_gravacao_componente(
            row.get("Componente") if isinstance(row, dict) else row[1]
        )
        for row in active_rows
    }
    if componente_normalized == COMPONENTE_TODOS:
        if active_components:
            if not allow_replace_active or any(
                active != COMPONENTE_TODOS for active in active_components
            ):
                raise ValueError(
                    "A OS já possui um envio ativo em gravação externa. Conclua ou remova esse envio antes de enviar todos os componentes."
                )
        if allow_replace_active:
            cancel_active_externa_sessions_cursor(cursor, ano, os_id)
    else:
        if COMPONENTE_TODOS in active_components:
            raise ValueError(
                "A OS já possui todos os componentes em gravação externa. Conclua ou remova esse envio antes de separar Capa e Miolo."
            )
        if componente_normalized in active_components:
            if not allow_replace_active:
                raise ValueError(
                    f"A OS já possui {gravacao_componente_label(componente_normalized)} em gravação externa. Conclua ou remova esse envio antes de enviar a mesma parte novamente."
                )
        if allow_replace_active:
            cursor.execute(
                """
                UPDATE tab_os_gravacao_externa
                SET Status = 'cancelada'
                WHERE OsAno = %s AND OsNro = %s
                  AND Status IN ('pendente', 'iniciada') AND Componente = %s
                """,
                (ano, os_id, componente_normalized),
            )


def create_session_with_arquivos(
    *,
    ano: int,
    os_id: int,
    cod_status: str,
    lancado_por_ponto: str,
    arquivos: list[dict[str, str]],
) -> int:
    validated = validate_arquivos_input(ano, os_id, arquivos)
    nome = _lookup_usuario_nome(lancado_por_ponto) or ""
    ponto_fmt = format_ponto(_clean_ponto(lancado_por_ponto))

    def tx(cursor):
        return insert_session_with_arquivos_cursor(
            cursor,
            ano=ano,
            os_id=os_id,
            cod_status=cod_status,
            ponto_fmt=ponto_fmt,
            lancado_por_nome=nome or None,
            validated_arquivos=validated,
        )

    return int(db.execute_transaction([tx])[0])


def _map_session_row(row: dict[str, Any]) -> dict[str, Any]:
    origem = row.get("OrigemPendenteId")
    juntada = row.get("JuntadaGrupoId")
    return {
        "id": int(row["Id"]),
        "os_ano": int(row["OsAno"]),
        "os_nro": int(row["OsNro"]),
        "cod_status": str(row.get("CodStatus") or ""),
        "componente": normalize_stored_gravacao_componente(row.get("Componente")),
        "lancado_por_ponto": str(row.get("LancadoPorPonto") or ""),
        "lancado_por_nome": row.get("LancadoPorNome"),
        "status": str(row.get("Status") or "pendente"),
        "iniciado_por_ponto": row.get("IniciadoPorPonto"),
        "iniciado_em": row.get("IniciadoEm"),
        "criado_em": row.get("CriadoEm"),
        "origem_pendente_id": int(origem) if origem is not None else None,
        "fornecedor_ponto": row.get("FornecedorPonto"),
        "juntada_grupo_id": str(juntada).strip() if juntada else None,
        "observacao": (str(row.get("Observacao") or "").strip() or None),
        "concluida_em": row.get("ConcluidaEm"),
        "concluida_por_ponto": row.get("ConcluidaPorPonto"),
        "entrega_lancada_em": row.get("EntregaLancadaEm"),
        "recebido_por_ponto": row.get("RecebidoPorPonto"),
        "recebido_por_nome": row.get("RecebidoPorNome"),
        "pagamento_nf_em": row.get("PagamentoNfEm"),
    }


def _map_arquivo_row(row: dict[str, Any]) -> dict[str, Any]:
    maquina = row.get("Maquina")
    return {
        "id": int(row["Id"]),
        "relative": str(row.get("RelativePath") or ""),
        "absolute_path": row.get("AbsolutePath"),
        "nome": str(row.get("NomeArquivo") or ""),
        "tamanho_bytes": row.get("TamanhoBytes"),
        "ordem": int(row.get("Ordem") or 0),
        "maquina": str(maquina).strip() if maquina else None,
    }


def _map_mensagem_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row["Id"]),
        "autor_ponto": str(row.get("AutorPonto") or ""),
        "autor_nome": row.get("AutorNome"),
        "autor_papel": str(row.get("AutorPapel") or ""),
        "mensagem": str(row.get("Mensagem") or ""),
        "criado_em": row.get("CriadoEm"),
    }


def get_active_session(ano: int, os_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa
        WHERE OsAno = %s AND OsNro = %s AND Status IN ('pendente', 'iniciada')
        ORDER BY Id DESC
        LIMIT 1
        """,
        (ano, os_id),
    )
    if not rows:
        return None
    return _map_session_row(rows[0])


def resolve_active_session(
    ano: int,
    os_id: int,
    session_id: int | None = None,
) -> Optional[dict[str, Any]]:
    if session_id is None:
        return get_active_session(ano, os_id)
    session = get_session_by_id(int(session_id))
    if (
        not session
        or int(session["os_ano"]) != int(ano)
        or int(session["os_nro"]) != int(os_id)
        or session["status"] not in ACTIVE_STATUSES
    ):
        return None
    return session


def get_session_by_id(session_id: int) -> Optional[dict[str, Any]]:
    rows = db.execute_query(
        "SELECT * FROM tab_os_gravacao_externa WHERE Id = %s LIMIT 1",
        (session_id,),
    )
    if not rows:
        return None
    return _map_session_row(rows[0])


def list_active_externa_by_juntada(juntada_grupo_id: str) -> list[dict[str, Any]]:
    """Sessões externas ativas (pendente/iniciada) do mesmo JuntadaGrupoId."""
    gid = (juntada_grupo_id or "").strip()
    if not gid:
        return []
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa
        WHERE JuntadaGrupoId = %s AND Status IN ('pendente', 'iniciada')
        ORDER BY OsNro ASC, OsAno ASC, Id ASC
        """,
        (gid,),
    )
    return [_map_session_row(r) for r in rows or []]


def list_concluida_aguardando_entrega_by_juntada(
    juntada_grupo_id: str,
) -> list[dict[str, Any]]:
    """Sessões concluídas ainda sem entrega do mesmo JuntadaGrupoId."""
    gid = (juntada_grupo_id or "").strip()
    if not gid:
        return []
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa
        WHERE JuntadaGrupoId = %s
          AND Status = 'concluida'
          AND EntregaLancadaEm IS NULL
        ORDER BY OsNro ASC, OsAno ASC, Id ASC
        """,
        (gid,),
    )
    return [_map_session_row(r) for r in rows or []]


def _resolve_active_externa_targets(
    session: dict[str, Any],
) -> list[dict[str, Any]]:
    """Âncora + irmãs ativas da juntada (ou só a sessão corrente)."""
    juntada_id = session.get("juntada_grupo_id")
    if juntada_id:
        targets = list_active_externa_by_juntada(str(juntada_id))
        if targets:
            return targets
    return [session]


def _fetch_arquivos(session_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa_arquivo
        WHERE GravacaoExternaId = %s
        ORDER BY Ordem ASC, Id ASC
        """,
        (session_id,),
    )
    return [_map_arquivo_row(r) for r in rows]


def _fetch_mensagens(session_id: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa_mensagem
        WHERE GravacaoExternaId = %s
        ORDER BY CriadoEm ASC, Id ASC
        """,
        (session_id,),
    )
    return [_map_mensagem_row(r) for r in rows]


def build_session_detail(session: dict[str, Any]) -> dict[str, Any]:
    sid = int(session["id"])
    return {
        **session,
        "arquivos": _fetch_arquivos(sid),
        "mensagens": _fetch_mensagens(sid),
    }


def list_os_gravacao_externa(
    *,
    ano: Optional[int] = None,
    search: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    fornecedor_ponto: Optional[str] = None,
) -> tuple[list[dict[str, Any]], int]:
    from services.andamento_operacional import ultimo_operacional_cod_subquery

    params: dict[str, Any] = {"limit": limit, "offset": offset}
    ultimo_cod = ultimo_operacional_cod_subquery("ge.OsNro", "ge.OsAno")
    filters = "WHERE ge.Status IN ('pendente', 'iniciada')"

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
                OR EXISTS (
                    SELECT 1 FROM tabDetalhesServico d
                    WHERE d.NroProtocoloLinkDet = p.NroProtocolo
                      AND d.AnoProtocoloLinkDet = p.AnoProtocolo
                      AND d.TipoPublicacaoLink LIKE %(search)s
                )
            )
        """
        params["search"] = term

    fornecedor_fmt = None
    if fornecedor_ponto:
        fornecedor_fmt = format_ponto(_clean_ponto(fornecedor_ponto)) or str(
            fornecedor_ponto
        ).strip()
        params["fornecedor_ponto"] = fornecedor_fmt
        filters += " AND ge.FornecedorPonto = %(fornecedor_ponto)s"

    count_sql = f"""
        SELECT COUNT(*) AS cnt FROM (
            SELECT COALESCE(
                ge.JuntadaGrupoId,
                CONCAT('s-', ge.Id)
            ) AS gkey
            FROM tab_os_gravacao_externa ge
            INNER JOIN tabProtocolos p
                ON p.AnoProtocolo = ge.OsAno
               AND p.NroProtocolo = ge.OsNro
            {filters}
            GROUP BY gkey
        ) t
    """
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
    count_row = db.execute_query(count_sql, count_params)
    total = int((count_row[0] if count_row else {}).get("cnt") or 0)

    list_sql = f"""
        SELECT
            p.NroProtocolo AS nr_os,
            p.AnoProtocolo AS ano,
            p.Titular AS solicitante,
            p.NomeUsuario AS nome_usuario,
            a.SituacaoLink AS situacao,
            a.SetorLink AS setor,
            a.`Data` AS last_update,
            ge.Id AS gravacao_externa_id,
            ge.Status AS gravacao_status,
            ge.LancadoPorPonto AS lancado_por_ponto,
            ge.LancadoPorNome AS lancado_por_nome,
            ge.FornecedorPonto AS fornecedor_ponto,
            uf.Nome AS fornecedor_nome,
            ge.CriadoEm AS gravacao_criado_em,
            ge.JuntadaGrupoId AS juntada_grupo_id,
            ge.Componente AS componente,
            (
                SELECT d.TipoPublicacaoLink
                FROM tabDetalhesServico d
                WHERE d.NroProtocoloLinkDet = p.NroProtocolo
                  AND d.AnoProtocoloLinkDet = p.AnoProtocolo
                LIMIT 1
            ) AS produto,
            (
                SELECT d.Titulo
                FROM tabDetalhesServico d
                WHERE d.NroProtocoloLinkDet = p.NroProtocolo
                  AND d.AnoProtocoloLinkDet = p.AnoProtocolo
                LIMIT 1
            ) AS titulo
        FROM tab_os_gravacao_externa ge
        INNER JOIN tabProtocolos p
            ON p.AnoProtocolo = ge.OsAno
           AND p.NroProtocolo = ge.OsNro
        LEFT JOIN tabAndamento a
            ON a.NroProtocoloLink = ge.OsNro
           AND a.AnoProtocoloLink = ge.OsAno
           AND a.CodStatus = {ultimo_cod}
        LEFT JOIN tabUsuarios uf
            ON uf.Ponto = NULLIF(
                CAST(
                    REPLACE(REPLACE(IFNULL(ge.FornecedorPonto, ''), '.', ''), '-', '')
                    AS UNSIGNED
                ),
                0
            )
        {filters}
        ORDER BY ge.CriadoEm DESC, ge.Id DESC
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
                "titulo": row.get("titulo"),
                "situacao": row.get("situacao"),
                "setor": row.get("setor"),
                "last_update": row.get("last_update"),
                "gravacao_externa_id": row.get("gravacao_externa_id"),
                "gravacao_status": row.get("gravacao_status") or "sem_sessao",
                "lancado_por_ponto": row.get("lancado_por_ponto"),
                "lancado_por_nome": row.get("lancado_por_nome"),
                "fornecedor_ponto": row.get("fornecedor_ponto"),
                "fornecedor_nome": row.get("fornecedor_nome"),
                "gravacao_criado_em": row.get("gravacao_criado_em"),
                "juntada_grupo_id": str(juntada).strip() if juntada else None,
                "componente": normalize_stored_gravacao_componente(row.get("componente")),
            }
        )
    from services.gravacao_pendente_service import (
        _aggregate_list_items_by_juntada,
        _enrich_juntada_membros_from_sessions,
    )

    aggregated = _enrich_juntada_membros_from_sessions(
        _aggregate_list_items_by_juntada(items)
    )
    return aggregated[offset : offset + limit], total


def user_can_access_session(
    session: dict[str, Any],
    *,
    ponto: str,
    has_operator_permission: bool,
    is_fornecedor: bool = False,
) -> bool:
    if has_operator_permission:
        return True
    from services.support_ponto_utils import ponto_matches

    if ponto_matches(session.get("fornecedor_ponto"), ponto):
        return True
    if is_fornecedor:
        return False
    return ponto_matches(session.get("lancado_por_ponto"), ponto)


def session_allows_operacao_fornecedor(
    session: dict[str, Any],
    ponto: str,
) -> bool:
    from services.support_ponto_utils import ponto_matches

    return ponto_matches(session.get("fornecedor_ponto"), ponto)


def user_can_send_mensagem(
    session: dict[str, Any],
    *,
    ponto: str,
    has_view_permission: bool,
    is_fornecedor: bool = False,
) -> bool:
    if session_allows_operacao_fornecedor(session, ponto):
        return True
    if is_fornecedor:
        return False
    return bool(has_view_permission)


def require_session_access(
    session: dict[str, Any],
    *,
    ponto: str,
    has_operator_permission: bool,
) -> None:
    if not user_can_access_session(
        session,
        ponto=ponto,
        has_operator_permission=has_operator_permission,
    ):
        raise HTTPException(status_code=403, detail="Acesso negado à sessão de Gravação Externa.")


def get_arquivo_for_session(
    session: dict[str, Any],
    arquivo_id: int,
) -> dict[str, Any]:
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa_arquivo
        WHERE Id = %s AND GravacaoExternaId = %s
        LIMIT 1
        """,
        (arquivo_id, session["id"]),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    return _map_arquivo_row(rows[0])


def resolve_arquivo_absolute_path(session: dict[str, Any], arquivo: dict[str, Any]) -> str:
    abs_path = arquivo.get("absolute_path")
    if abs_path:
        from services.network_files_service import validate_network_arquivos_input

        validated = validate_network_arquivos_input(
            [{"absolute_path": str(abs_path), "nome": arquivo.get("nome") or ""}]
        )
        return str(validated[0]["absolute_path"])
    try:
        return _resolve_os_file_path(
            int(session["os_ano"]),
            int(session["os_nro"]),
            str(arquivo["relative"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


class ZipBuildCancelled(Exception):
    """Job de ZIP substituído ou cancelado no meio da montagem."""


def session_zip_filename(session: dict[str, Any]) -> str:
    os_nro = int(session["os_nro"])
    os_ano = int(session["os_ano"])
    return f"gravacao_externa_OS_{os_nro:05d}_{os_ano}.zip"


def compute_arquivos_signature(arquivos: list[dict[str, Any]]) -> str:
    payload = [
        [
            int(arquivo.get("id") or 0),
            str(arquivo.get("relative") or ""),
            str(arquivo.get("absolute_path") or ""),
            str(arquivo.get("nome") or ""),
            int(arquivo.get("tamanho_bytes") or 0),
            int(arquivo.get("ordem") or 0),
        ]
        for arquivo in arquivos
    ]
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def write_session_arquivos_zip(
    session: dict[str, Any],
    dest_path: str,
    *,
    on_progress: Callable[[int, int, int], None] | None = None,
    should_abort: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    """Empacota os arquivos da sessão em dest_path (ZIP_STORED, Zip64)."""
    arquivos = _fetch_arquivos(int(session["id"]))
    if not arquivos:
        raise HTTPException(status_code=404, detail="Nenhum arquivo para download.")

    total = len(arquivos)
    bytes_prontos = 0
    used_names: set[str] = set()
    with zipfile.ZipFile(
        dest_path,
        "w",
        compression=zipfile.ZIP_STORED,
        allowZip64=True,
    ) as archive:
        for index, arquivo in enumerate(arquivos):
            if should_abort is not None and should_abort():
                raise ZipBuildCancelled()
            path = resolve_arquivo_absolute_path(session, arquivo)
            if not os.path.isfile(path):
                raise HTTPException(
                    status_code=404,
                    detail=f"Arquivo não encontrado: {arquivo.get('nome') or path}",
                )
            nome = str(arquivo.get("nome") or Path(path).name).strip() or "arquivo"
            candidate = nome
            counter = 1
            while candidate in used_names:
                stem, ext = os.path.splitext(nome)
                candidate = f"{stem}_{counter}{ext}"
                counter += 1
            used_names.add(candidate)
            archive.write(path, arcname=candidate)
            try:
                bytes_prontos += int(os.path.getsize(path))
            except OSError:
                bytes_prontos += int(arquivo.get("tamanho_bytes") or 0)
            if on_progress is not None:
                on_progress(index + 1, total, bytes_prontos)

    tamanho = int(os.path.getsize(dest_path)) if os.path.isfile(dest_path) else bytes_prontos
    return {
        "filename": session_zip_filename(session),
        "tamanho_bytes": tamanho,
        "total_arquivos": total,
        "bytes_prontos": bytes_prontos,
    }


def build_session_arquivos_zip(session: dict[str, Any]) -> tuple[str, str]:
    """Empacota todos os arquivos da sessão em um ZIP (ZIP_STORED em disco).

    Returns:
        (tmp_path, download_filename) — caller must delete tmp_path after send.
    """
    fd, tmp_path = tempfile.mkstemp(suffix=".zip", prefix="gravacao_externa_")
    os.close(fd)
    try:
        result = write_session_arquivos_zip(session, tmp_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    return tmp_path, str(result["filename"])


def _downscale_image_for_preview(img: Image.Image, max_edge: int) -> Image.Image:
    """Reduz imagem grande sem carregar RGB completo (suporta 1-bit offset)."""
    width, height = img.size
    longest = max(width, height)
    if longest <= max_edge:
        return img
    scale = longest / max_edge
    new_size = (max(1, int(width / scale)), max(1, int(height / scale)))
    return img.resize(new_size, Image.Resampling.BOX)


def _apply_plate_separation_tint(img: Image.Image, channel: str) -> Image.Image:
    from services.plate_filename_utils import PLATE_CHANNEL_RGB

    channel = channel.upper()
    rgb = PLATE_CHANNEL_RGB.get(channel)
    if not rgb:
        return _normalize_image_for_png(img)
    gray = img.convert("L") if img.mode != "L" else img
    paper = Image.new("RGB", gray.size, (255, 255, 255))
    ink_layer = Image.new("RGB", gray.size, rgb)
    mask = Image.eval(gray, lambda p: 255 - p)
    paper.paste(ink_layer, mask=mask)
    return paper


def _normalize_image_for_png(img: Image.Image) -> Image.Image:
    if img.mode == "1":
        return img.convert("L")
    if img.mode == "CMYK":
        return img.convert("RGB")
    if img.mode == "P":
        return img.convert("RGBA" if "transparency" in img.info else "RGB")
    if img.mode == "RGBA":
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        return background
    if img.mode not in ("RGB", "L"):
        return img.convert("RGB")
    return img


def render_tif_preview_png(file_path: str, *, filename: str | None = None) -> bytes:
    """Gera PNG de prévia para placas TIF grandes (offset / 1-bit na rede)."""
    from PIL import ImageFile

    from services.plate_filename_utils import parse_plate_color_from_filename

    display_name = filename or os.path.basename(file_path)
    plate_color = parse_plate_color_from_filename(display_name)
    ImageFile.LOAD_TRUNCATED_IMAGES = True
    old_max_pixels = Image.MAX_IMAGE_PIXELS
    try:
        # Placas offset excedem o limite anti-bomb do Pillow; a prévia é sempre reduzida.
        Image.MAX_IMAGE_PIXELS = None
        with Image.open(file_path) as img:
            width, height = img.size
            logger.info(
                "TIF preview: %s mode=%s size=%sx%s",
                os.path.basename(file_path),
                img.mode,
                width,
                height,
            )
            img.load()
            preview = _downscale_image_for_preview(img, TIF_PREVIEW_MAX_EDGE)
            if plate_color:
                preview = _apply_plate_separation_tint(preview, plate_color)
            else:
                preview = _normalize_image_for_png(preview)
            buffer = io.BytesIO()
            preview.save(buffer, format="PNG", compress_level=3)
            return buffer.getvalue()
    except Exception as exc:
        logger.error(
            "Falha ao converter TIF para preview (%s): %s",
            os.path.basename(file_path),
            exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Não foi possível gerar preview do arquivo TIF.",
        ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = old_max_pixels


def get_or_build_preview_png(file_path: str, *, filename: str | None = None) -> bytes:
    """Retorna PNG de preview do cache local ou gera e persiste."""
    from services.gravacao_preview_cache_service import get_or_build_cached_preview

    display_name = filename or os.path.basename(file_path)
    return get_or_build_cached_preview(file_path, display_name)


PLATE_COMPOSITE_ORDER = ("C", "M", "Y", "K")


def collect_plate_separations_for_group(
    arquivos: list[dict[str, Any]],
    group_key: str,
) -> dict[str, dict[str, Any]]:
    from services.plate_filename_utils import parse_plate_filename

    normalized_key = group_key.strip()
    result: dict[str, dict[str, Any]] = {}
    for arq in arquivos:
        nome = str(arq.get("nome") or "")
        parsed = parse_plate_filename(nome)
        if parsed.group_key != normalized_key or not parsed.color:
            continue
        result[parsed.color] = arq
    return result


def _load_tif_tinted_preview_layer(
    file_path: str,
    channel: str,
    max_edge: int,
) -> Image.Image:
    from PIL import ImageFile

    ImageFile.LOAD_TRUNCATED_IMAGES = True
    with Image.open(file_path) as img:
        img.load()
        preview = _downscale_image_for_preview(img, max_edge)
        return _apply_plate_separation_tint(preview, channel)


def render_plate_composite_png(
    file_paths_by_color: dict[str, str],
    *,
    max_edge: int = TIF_PREVIEW_MAX_EDGE,
) -> bytes:
    """Compõe separações CMYK tintadas (multiply) em um PNG de preview."""
    if len(file_paths_by_color) < 2:
        raise HTTPException(
            status_code=400,
            detail="Composição requer ao menos 2 separações.",
        )

    from PIL import ImageChops, ImageFile

    ImageFile.LOAD_TRUNCATED_IMAGES = True
    old_max_pixels = Image.MAX_IMAGE_PIXELS
    layers: list[Image.Image] = []
    try:
        Image.MAX_IMAGE_PIXELS = None
        for channel in PLATE_COMPOSITE_ORDER:
            path = file_paths_by_color.get(channel)
            if not path:
                continue
            layers.append(_load_tif_tinted_preview_layer(path, channel, max_edge))

        if len(layers) < 2:
            raise HTTPException(
                status_code=400,
                detail="Composição requer ao menos 2 separações.",
            )

        max_w = max(layer.size[0] for layer in layers)
        max_h = max(layer.size[1] for layer in layers)
        target_size = (max_w, max_h)
        composite = Image.new("RGB", target_size, (255, 255, 255))
        for index, layer in enumerate(layers):
            if layer.size != target_size:
                logger.warning(
                    "Composite preview: redimensionando camada %s de %s para %s",
                    index,
                    layer.size,
                    target_size,
                )
                layer = layer.resize(target_size, Image.Resampling.BOX)
            composite = ImageChops.multiply(composite, layer)

        buffer = io.BytesIO()
        composite.save(buffer, format="PNG", compress_level=3)
        return buffer.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Falha ao gerar preview composto CMYK: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Não foi possível gerar preview composto.",
        ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = old_max_pixels
        for layer in layers:
            layer.close()


def render_session_composite_preview(
    session: dict[str, Any],
    group_key: str,
    arquivos: list[dict[str, Any]],
) -> bytes:
    from services.gravacao_preview_cache_service import get_or_build_composite_preview

    separations = collect_plate_separations_for_group(arquivos, group_key)
    return get_or_build_composite_preview(
        separations,
        group_key,
        lambda arq: resolve_arquivo_absolute_path(session, arq),
    )


def _iniciar_uma_sessao_cursor(
    cursor,
    *,
    session: dict[str, Any],
    ponto_fmt: str,
    need_andamento: bool,
    obs: str,
) -> str | None:
    """Atualiza status e opcionalmente insere andamento Recebido para uma sessão."""
    from routers.os_audit_service import log_andamento_added
    from services.andamento_operacional import insert_andamento_as_ultimo

    os_id = int(session["os_nro"])
    ano = int(session["os_ano"])
    session_id = int(session["id"])

    if session["status"] != "iniciada":
        cursor.execute(
            """
            UPDATE tab_os_gravacao_externa
            SET Status = 'iniciada',
                IniciadoPorPonto = %s,
                IniciadoEm = NOW()
            WHERE Id = %s
            """,
            (ponto_fmt, session_id),
        )

    if not need_andamento:
        return None

    base_prefix = f"{os_id:05d}{ano}-"
    cursor.execute(
        "SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE %s",
        (f"{base_prefix}%",),
    )
    res = cursor.fetchone()
    next_seq = 1
    if res and res.get("max_cod"):
        try:
            next_seq = int(str(res["max_cod"]).split("-")[-1]) + 1
        except ValueError:
            next_seq = 1
    new_cod = f"{base_prefix}{next_seq:02d}"
    insert_andamento_as_ultimo(
        cursor,
        cod_status=new_cod,
        nro=os_id,
        ano=ano,
        situacao=SITUACAO_RECEBIDO,
        setor=SETOR_GRAV_EXTERNA,
        obs=obs,
        ponto=ponto_fmt,
    )
    log_andamento_added(
        cursor,
        nro=os_id,
        ano=ano,
        cod_status=new_cod,
        situacao=SITUACAO_RECEBIDO,
        setor=SETOR_GRAV_EXTERNA,
        obs=obs,
        ponto=ponto_fmt,
        origem="gravacao_externa_iniciar",
    )
    return new_cod


def iniciar_gravacao(
    *,
    ano: int,
    os_id: int,
    operador_ponto: str,
    gravacao_externa_id: int | None = None,
) -> dict[str, Any]:
    session = resolve_active_session(ano, os_id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")

    ponto_fmt = format_ponto(_clean_ponto(operador_ponto))
    targets = _resolve_active_externa_targets(session)

    # Avaliação prévia por OS (idempotência); chapas/obs por origem da sessão.
    from routers.andamento_helpers import (
        format_andamento_obs,
        format_gravacao_recebido_obs,
        with_juntada_obs_prefix,
    )
    from services.gravacao_pendente_service import juntada_membros_label

    work: list[tuple[dict[str, Any], bool, str]] = []
    any_status_change = False
    for target in targets:
        t_ano = int(target["os_ano"])
        t_nro = int(target["os_nro"])
        if target["status"] == "iniciada":
            continue
        if target["status"] != "iniciada":
            any_status_change = True
        chapas = _fetch_chapas_origem_pendente(target.get("origem_pendente_id"))
        obs = format_andamento_obs(
            with_gravacao_componente_obs_prefix(
                with_juntada_obs_prefix(
                    format_gravacao_recebido_obs(chapas),
                    juntada_membros_label(target.get("juntada_grupo_id")),
                ),
                target.get("componente"),
            )
        )
        work.append((target, True, obs))

    if not work:
        updated = (
            get_session_by_id(int(session["id"]))
            if gravacao_externa_id is not None
            else get_active_session(ano, os_id)
        ) or session
        updated["status"] = "iniciada"
        return build_session_detail(updated)

    def tx(cursor):
        codes: list[tuple[int, int, str]] = []
        for target, need_andamento, obs in work:
            new_cod = _iniciar_uma_sessao_cursor(
                cursor,
                session=target,
                ponto_fmt=ponto_fmt,
                need_andamento=need_andamento,
                obs=obs,
            )
            if new_cod:
                codes.append((int(target["os_ano"]), int(target["os_nro"]), new_cod))
        return codes

    codes = db.execute_transaction([tx])[0]
    for a, n, new_cod in codes:
        _notify_iniciar_gravacao(ano=a, os_id=n, new_cod=str(new_cod))

    updated = (
        get_session_by_id(int(session["id"]))
        if gravacao_externa_id is not None
        else get_active_session(ano, os_id)
    ) or session
    updated["status"] = "iniciada"

    launcher = str(session.get("lancado_por_ponto") or "")
    if any_status_change or session["status"] != "iniciada":
        send_gravacao_notification_email(
            event="iniciada",
            ano=ano,
            os_id=os_id,
            target_ponto=launcher,
            target_nome=session.get("lancado_por_nome"),
            operador_ponto=ponto_fmt,
        )
        push_gravacao_externa_iniciada(
            gravacao_externa_id=int(session["id"]),
            os_ano=ano,
            os_nro=os_id,
            lancado_por_ponto=launcher,
            status="iniciada",
        )
    return build_session_detail(updated)


def _resolve_autor_papel(
    session: dict[str, Any],
    ponto: str,
    *,
    has_view_permission: bool,
) -> str:
    from services.support_ponto_utils import ponto_matches

    if session_allows_operacao_fornecedor(session, ponto):
        return "operador"
    if has_view_permission or ponto_matches(session.get("lancado_por_ponto"), ponto):
        return "lancador"
    raise HTTPException(status_code=403, detail="Acesso negado.")


def list_internal_gravacao_externa_notification_pontos(
    *,
    exclude_ponto: str | None = None,
) -> list[str]:
    """Pontos internos ativos com acesso à aba OPs pendentes no Birô."""
    from security.user_permissions import is_user_permissions_customized

    try:
        users = (
            db.execute_query(
                """
                SELECT Ponto
                FROM tabUsuarios
                WHERE COALESCE(AuthAtivo, 1) = 1
                  AND COALESCE(Fornecedor, 0) <> 1
                """
            )
            or []
        )
        perm_rows = db.execute_query("SELECT * FROM user_permissions") or []
    except Exception as exc:
        logger.debug("list internal gravacao-externa pontos: %s", exc)
        return []

    perms_by_ponto: dict[str, dict[str, Any]] = {}
    for row in perm_rows:
        key = _clean_ponto(str(row.get("Ponto") or ""))
        if key:
            perms_by_ponto[key] = row

    exclude = _clean_ponto(exclude_ponto or "")
    result: list[str] = []
    seen: set[str] = set()
    for user in users:
        digits = _clean_ponto(str(user.get("Ponto") or ""))
        if not digits or digits == exclude or digits in seen:
            continue
        overlay = perms_by_ponto.get(digits)
        if overlay is None or not is_user_permissions_customized(overlay):
            include = True
        else:
            include = bool(overlay.get("sb_gravacao_externa"))
        if not include:
            continue
        seen.add(digits)
        result.append(format_ponto(digits) or digits)
    return result


def _notify_gravacao_externa_mensagem(
    *,
    session: dict[str, Any],
    sender_ponto: str,
    papel: str,
    thread_msg: dict[str, Any],
    ano: int,
    os_id: int,
) -> None:
    os_label = f"{os_id:05d}/{str(ano)[-2:]}"
    sender_clean = _clean_ponto(sender_ponto)
    if papel == "operador":
        targets = list_internal_gravacao_externa_notification_pontos(
            exclude_ponto=sender_ponto,
        )
        notif_msg = f"Nova mensagem de Gravação Externa na OS {os_label}."
    else:
        fornecedor = str(session.get("fornecedor_ponto") or "")
        targets = [fornecedor] if fornecedor else []
        notif_msg = f"Resposta sobre Gravação Externa na OS {os_label}."

    detalhes = json.dumps(
        {
            "tipo": "gravacao_externa_mensagem",
            "gravacao_externa_id": session["id"],
            "os_ano": ano,
            "os_nro": os_id,
            "message_id": thread_msg["id"],
        },
        ensure_ascii=False,
    )
    for target in targets:
        if not target or _clean_ponto(target) == sender_clean:
            continue
        notification_id = insert_user_notification(
            ponto=_clean_ponto(target) or target,
            nro=os_id,
            ano=ano,
            mensagem=notif_msg,
            detalhes_json=detalhes,
        )
        push_user_notification(
            target_ponto=target,
            mensagem=notif_msg,
            nro=os_id,
            ano=ano,
            notification_id=notification_id,
            action="gravacao_externa_mensagem",
            gravacao_message_id=int(thread_msg["id"]),
        )


def add_mensagem(
    *,
    ano: int,
    os_id: int,
    ponto: str,
    mensagem: str,
    has_view_permission: bool,
    is_fornecedor: bool = False,
    gravacao_externa_id: int | None = None,
) -> dict[str, Any]:
    text = (mensagem or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Mensagem vazia.")
    if len(text) > MESSAGE_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Mensagem excede {MESSAGE_MAX_LENGTH} caracteres.",
        )

    session = resolve_active_session(ano, os_id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")
    if not user_can_send_mensagem(
        session,
        ponto=ponto,
        has_view_permission=has_view_permission,
        is_fornecedor=is_fornecedor,
    ):
        raise HTTPException(status_code=403, detail="Acesso negado à sessão de Gravação Externa.")
    papel = _resolve_autor_papel(
        session,
        ponto,
        has_view_permission=has_view_permission,
    )
    nome = _lookup_usuario_nome(ponto) or ""
    ponto_fmt = format_ponto(_clean_ponto(ponto))

    def tx(cursor):
        cursor.execute(
            """
            INSERT INTO tab_os_gravacao_externa_mensagem
                (GravacaoExternaId, AutorPonto, AutorNome, AutorPapel, Mensagem)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (session["id"], ponto_fmt, nome or None, papel, text),
        )
        msg_id = int(cursor.lastrowid)
        cursor.execute(
            "SELECT * FROM tab_os_gravacao_externa_mensagem WHERE Id = %s",
            (msg_id,),
        )
        row = cursor.fetchone()
        return _map_mensagem_row(row)

    thread_msg = db.execute_transaction([tx])[0]
    _notify_gravacao_externa_mensagem(
        session=session,
        sender_ponto=ponto,
        papel=papel,
        thread_msg=thread_msg,
        ano=ano,
        os_id=os_id,
    )
    push_gravacao_externa_message(
        gravacao_externa_id=int(session["id"]),
        os_ano=ano,
        os_nro=os_id,
        thread_message=thread_msg,
        lancado_por_ponto=str(session.get("lancado_por_ponto") or ""),
    )
    return thread_msg


def list_mensagens(
    *,
    ano: int,
    os_id: int,
    ponto: str,
    is_operator: bool,
    has_view_permission: bool = False,
    gravacao_externa_id: int | None = None,
) -> list[dict[str, Any]]:
    session = resolve_active_session(ano, os_id, gravacao_externa_id)
    if not session:
        return []
    if has_view_permission:
        return _fetch_mensagens(int(session["id"]))
    if session_allows_operacao_fornecedor(session, ponto):
        return _fetch_mensagens(int(session["id"]))
    require_session_access(
        session,
        ponto=ponto,
        has_operator_permission=is_operator,
    )
    return _fetch_mensagens(int(session["id"]))


def validate_arquivos_absolute_input(
    arquivos: list[dict[str, str]],
) -> list[dict[str, Any]]:
    from services.network_files_service import validate_network_arquivos_input

    return validate_network_arquivos_input(arquivos)


def update_session_arquivos(
    *,
    ano: int,
    os_id: int,
    arquivos: list[dict[str, str]],
    gravacao_externa_id: int | None = None,
) -> dict[str, Any]:
    session = resolve_active_session(ano, os_id, gravacao_externa_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sessão de Gravação Externa não encontrada.")
    if session["status"] != "pendente":
        raise HTTPException(
            status_code=400,
            detail="Só é possível alterar arquivos antes de iniciar a gravação.",
        )
    validated = validate_arquivos_absolute_input(arquivos)

    def tx(cursor):
        cursor.execute(
            "DELETE FROM tab_os_gravacao_externa_arquivo WHERE GravacaoExternaId = %s",
            (session["id"],),
        )
        for arquivo in validated:
            cursor.execute(
                """
                INSERT INTO tab_os_gravacao_externa_arquivo
                    (GravacaoExternaId, RelativePath, AbsolutePath, NomeArquivo, TamanhoBytes, Ordem, Maquina)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    session["id"],
                    "",
                    arquivo["absolute_path"],
                    arquivo["nome"],
                    arquivo.get("tamanho_bytes"),
                    arquivo["ordem"],
                    arquivo.get("maquina"),
                ),
            )
        return session["id"]

    db.execute_transaction([tx])
    from services.gravacao_externa_realtime_service import push_gravacao_externa_arquivos_atualizados
    from services.gravacao_preview_cache_service import enqueue_preview_warmup

    enqueue_preview_warmup(validated)
    push_gravacao_externa_arquivos_atualizados(
        gravacao_externa_id=int(session["id"]),
        os_ano=ano,
        os_nro=os_id,
        lancado_por_ponto=str(session.get("lancado_por_ponto") or ""),
    )
    updated = (
        get_session_by_id(int(session["id"]))
        if gravacao_externa_id is not None
        else get_active_session(ano, os_id)
    ) or session
    return build_session_detail(updated)


def _resolve_ponto_andamento_gravacao_externa(
    cod_status: str,
    *,
    lancado_por_ponto: str = "",
    operador_ponto: str = "",
) -> str:
    """Ponto do andamento Gravação Externa (CodStatus da sessão), com fallbacks."""
    cod = str(cod_status or "").strip()
    if cod:
        rows = db.execute_query(
            "SELECT Ponto FROM tabAndamento WHERE CodStatus = %s LIMIT 1",
            (cod,),
        )
        if rows and rows[0].get("Ponto"):
            return str(rows[0]["Ponto"]).strip()
    if lancado_por_ponto:
        return format_ponto(_clean_ponto(lancado_por_ponto))
    return format_ponto(_clean_ponto(operador_ponto))


def _fetch_chapas_origem_pendente(origem_pendente_id: int | None) -> list[dict[str, Any]]:
    if not origem_pendente_id:
        return []
    rows = db.execute_query(
        """
        SELECT Maquina, QuantidadeChapas
        FROM tab_os_gravacao_pendente_chapa
        WHERE GravacaoPendenteId = %s
        ORDER BY Id
        """,
        (int(origem_pendente_id),),
    )
    return [
        {
            "maquina": str(r.get("Maquina") or "").strip(),
            "quantidade": int(r.get("QuantidadeChapas") or 0),
        }
        for r in (rows or [])
    ]


def _get_ultimo_operacional(ano: int, os_id: int) -> tuple[Optional[str], Optional[str]]:
    """Situação e setor do último andamento operacional (exclui espelhos Sub OS)."""
    from services.andamento_operacional import mirror_exclude_clause_for

    mirror = mirror_exclude_clause_for("a")
    rows = db.execute_query(
        f"""
        SELECT a.SituacaoLink AS situacao, a.SetorLink AS setor
        FROM tabAndamento a
        WHERE a.NroProtocoloLink = %s
          AND a.AnoProtocoloLink = %s
          AND {mirror}
        ORDER BY a.`Data` DESC, a.CodStatus DESC
        LIMIT 1
        """,
        (os_id, ano),
    )
    if not rows:
        return None, None
    situacao = rows[0].get("situacao")
    setor = rows[0].get("setor")
    return (
        str(situacao).strip() if situacao is not None else None,
        str(setor).strip() if setor is not None else None,
    )


def _get_ultimo_situacao_operacional(ano: int, os_id: int) -> Optional[str]:
    situacao, _setor = _get_ultimo_operacional(ano, os_id)
    return situacao


def _notify_andamento_mdb(
    *,
    task_name: str,
    ano: int,
    os_id: int,
    new_cod: str,
    situacao: str,
    setor: str,
    source: str,
    operation: str = "insert",
) -> None:
    from services.os_andamento_post_change_service import after_andamento_changed

    after_andamento_changed(
        os_id,
        ano,
        "history_added" if operation == "insert" else "history_updated",
        codstatus=new_cod,
        situacao=situacao,
        setor=setor,
        source=source,
    )

    def _sync_to_mdb() -> None:
        from routers.mdb_writer import sync_andamento_from_mysql_to_mdb

        sync_andamento_from_mysql_to_mdb(new_cod, os_id, ano, operation=operation)

    try:
        from routers.mdb_writer import dispatch_mdb_sync

        dispatch_mdb_sync(
            task_name,
            _sync_to_mdb,
            cod_status=new_cod,
            nro=os_id,
            ano=ano,
        )
    except Exception as exc:
        logger.warning(
            "Falha ao enfileirar sync MDB (%s) andamento %s: %s",
            task_name,
            new_cod,
            exc,
        )


def _notify_concluir_gravacao(
    *,
    ano: int,
    os_id: int,
    new_cod: str,
) -> None:
    """Materializa busca, WebSocket e replica andamento no MDB após concluir gravação."""
    _notify_andamento_mdb(
        task_name="gravacao_concluir",
        ano=ano,
        os_id=os_id,
        new_cod=new_cod,
        situacao=SITUACAO_GRAV_CONCLUIDA,
        setor=SETOR_GRAVACAO_CONCLUIDA,
        source="gravacao_externa_concluir",
        operation="insert",
    )


def _notify_iniciar_gravacao(
    *,
    ano: int,
    os_id: int,
    new_cod: str,
) -> None:
    _notify_andamento_mdb(
        task_name="gravacao_iniciar",
        ano=ano,
        os_id=os_id,
        new_cod=new_cod,
        situacao=SITUACAO_RECEBIDO,
        setor=SETOR_GRAV_EXTERNA,
        source="gravacao_externa_iniciar",
        operation="insert",
    )


def _build_concluida_sem_sessao_detail(
    *,
    ano: int,
    os_id: int,
    cod_status: str,
    concluida_por_ponto: str,
) -> dict[str, Any]:
    """Detalhe sintético compatível com GravacaoExternaDetailResponse após concluir sem sessão."""
    return {
        "id": 0,
        "os_ano": ano,
        "os_nro": os_id,
        "cod_status": cod_status,
        "lancado_por_ponto": "",
        "lancado_por_nome": None,
        "status": "concluida",
        "iniciado_por_ponto": None,
        "iniciado_em": None,
        "criado_em": None,
        "origem_pendente_id": None,
        "fornecedor_ponto": None,
        "concluida_em": None,
        "concluida_por_ponto": concluida_por_ponto,
        "entrega_lancada_em": None,
        "recebido_por_ponto": None,
        "recebido_por_nome": None,
        "pagamento_nf_em": None,
        "arquivos": [],
        "mensagens": [],
    }


def _concluir_gravacao_sem_sessao(
    *,
    ano: int,
    os_id: int,
    operador_ponto: str,
) -> dict[str, Any]:
    """Conclui OS em Gravação Externa sem sessão/arquivos: só andamento Gravação Ext. Concluída."""
    situacao, setor = _get_ultimo_operacional(ano, os_id)
    if not is_em_gravacao_externa_operacional(situacao, setor):
        raise HTTPException(
            status_code=400,
            detail="A OS precisa estar em Gravação Externa para concluir sem sessão.",
        )

    ponto_andamento = format_ponto(_clean_ponto(operador_ponto))

    from routers.andamento_helpers import format_andamento_obs, format_gravacao_concluida_obs
    from routers.os_audit_service import log_andamento_added
    from services.andamento_operacional import insert_andamento_as_ultimo

    obs = format_andamento_obs(format_gravacao_concluida_obs([]))
    base_prefix = f"{os_id:05d}{ano}-"

    def tx(cursor):
        cursor.execute(
            "SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE %s",
            (f"{base_prefix}%",),
        )
        res = cursor.fetchone()
        next_seq = 1
        if res and res.get("max_cod"):
            try:
                next_seq = int(str(res["max_cod"]).split("-")[-1]) + 1
            except ValueError:
                next_seq = 1
        new_cod = f"{base_prefix}{next_seq:02d}"

        insert_andamento_as_ultimo(
            cursor,
            cod_status=new_cod,
            nro=os_id,
            ano=ano,
            situacao=SITUACAO_GRAV_CONCLUIDA,
            setor=SETOR_GRAVACAO_CONCLUIDA,
            obs=obs,
            ponto=ponto_andamento,
        )
        log_andamento_added(
            cursor,
            nro=os_id,
            ano=ano,
            cod_status=new_cod,
            situacao=SITUACAO_GRAV_CONCLUIDA,
            setor=SETOR_GRAVACAO_CONCLUIDA,
            obs=obs,
            ponto=ponto_andamento,
            origem="gravacao_externa_concluir_sem_sessao",
        )
        return new_cod

    new_cod = str(db.execute_transaction([tx])[0])
    _notify_concluir_gravacao(ano=ano, os_id=os_id, new_cod=new_cod)

    return _build_concluida_sem_sessao_detail(
        ano=ano,
        os_id=os_id,
        cod_status=new_cod,
        concluida_por_ponto=ponto_andamento,
    )


def _concluir_uma_sessao_cursor(
    cursor,
    *,
    session: dict[str, Any],
    ponto_andamento: str,
    obs: str,
) -> str:
    """Marca sessão concluída e insere andamento Gravação Ext. Concluída."""
    from routers.os_audit_service import log_andamento_added
    from services.andamento_operacional import insert_andamento_as_ultimo

    os_id = int(session["os_nro"])
    ano = int(session["os_ano"])
    session_id = int(session["id"])

    cursor.execute(
        """
        UPDATE tab_os_gravacao_externa
        SET Status = 'concluida',
            ConcluidaEm = NOW(),
            ConcluidaPorPonto = %s
        WHERE Id = %s
        """,
        (ponto_andamento, session_id),
    )

    base_prefix = f"{os_id:05d}{ano}-"
    cursor.execute(
        "SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE %s",
        (f"{base_prefix}%",),
    )
    res = cursor.fetchone()
    next_seq = 1
    if res and res.get("max_cod"):
        try:
            next_seq = int(str(res["max_cod"]).split("-")[-1]) + 1
        except ValueError:
            next_seq = 1
    new_cod = f"{base_prefix}{next_seq:02d}"

    insert_andamento_as_ultimo(
        cursor,
        cod_status=new_cod,
        nro=os_id,
        ano=ano,
        situacao=SITUACAO_GRAV_CONCLUIDA,
        setor=SETOR_GRAVACAO_CONCLUIDA,
        obs=obs,
        ponto=ponto_andamento,
    )
    log_andamento_added(
        cursor,
        nro=os_id,
        ano=ano,
        cod_status=new_cod,
        situacao=SITUACAO_GRAV_CONCLUIDA,
        setor=SETOR_GRAVACAO_CONCLUIDA,
        obs=obs,
        ponto=ponto_andamento,
        origem="gravacao_externa_concluir",
    )
    return new_cod


def _run_concluir_targets(
    *,
    targets: list[dict[str, Any]],
    ponto_andamento: str,
    email_ano: int,
    email_os_id: int,
    email_launcher: str,
    email_launcher_nome: Any,
    push_session: dict[str, Any],
) -> list[tuple[int, int, str]]:
    """Conclui várias sessões ativas na mesma TX e notifica cada OS."""
    from routers.andamento_helpers import (
        format_andamento_obs,
        format_gravacao_concluida_obs,
        with_juntada_obs_prefix,
    )
    from services.gravacao_pendente_service import juntada_membros_label

    prepared: list[tuple[dict[str, Any], str]] = []
    for target in targets:
        if target.get("status") not in ("iniciada", "pendente"):
            continue
        chapas = _fetch_chapas_origem_pendente(target.get("origem_pendente_id"))
        obs = format_andamento_obs(
            with_gravacao_componente_obs_prefix(
                with_juntada_obs_prefix(
                    format_gravacao_concluida_obs(chapas),
                    juntada_membros_label(target.get("juntada_grupo_id")),
                ),
                target.get("componente"),
            )
        )
        prepared.append((target, obs))

    if not prepared:
        return []

    def tx(cursor):
        codes: list[tuple[int, int, str]] = []
        for target, obs in prepared:
            new_cod = _concluir_uma_sessao_cursor(
                cursor,
                session=target,
                ponto_andamento=ponto_andamento,
                obs=obs,
            )
            codes.append((int(target["os_ano"]), int(target["os_nro"]), new_cod))
        return codes

    codes = db.execute_transaction([tx])[0]
    for a, n, new_cod in codes:
        _notify_concluir_gravacao(ano=a, os_id=n, new_cod=str(new_cod))

    send_gravacao_notification_email(
        event="concluida",
        ano=email_ano,
        os_id=email_os_id,
        target_ponto=email_launcher,
        target_nome=email_launcher_nome,
        operador_ponto=ponto_andamento,
    )

    from services.gravacao_externa_realtime_service import push_gravacao_externa_concluida

    push_gravacao_externa_concluida(
        gravacao_externa_id=int(push_session["id"]),
        os_ano=email_ano,
        os_nro=email_os_id,
        lancado_por_ponto=email_launcher,
    )
    return codes


def concluir_gravacao(
    *,
    ano: int,
    os_id: int,
    operador_ponto: str,
    gravacao_externa_id: int | None = None,
) -> dict[str, Any]:
    session = resolve_active_session(ano, os_id, gravacao_externa_id)
    ponto_andamento = format_ponto(_clean_ponto(operador_ponto))

    if session:
        if session["status"] not in ("iniciada", "pendente", "concluida"):
            raise HTTPException(
                status_code=400,
                detail="A gravação precisa estar pendente ou iniciada para ser concluída.",
            )

        targets = _resolve_active_externa_targets(session)
        # Se âncora já veio como concluida (mock/edge) e há juntada, só as irmãs ativas.
        if session["status"] == "concluida":
            juntada_id = session.get("juntada_grupo_id")
            if not juntada_id:
                return build_session_detail(session)
            sisters = [
                t
                for t in list_active_externa_by_juntada(str(juntada_id))
                if int(t["id"]) != int(session["id"])
            ]
            if not sisters:
                return build_session_detail(session)
            targets = sisters

        if not targets:
            return build_session_detail(session)

        launcher = str(session.get("lancado_por_ponto") or "")
        _run_concluir_targets(
            targets=targets,
            ponto_andamento=ponto_andamento,
            email_ano=ano,
            email_os_id=os_id,
            email_launcher=launcher,
            email_launcher_nome=session.get("lancado_por_nome"),
            push_session=session,
        )

        concluded = get_session_by_id(int(session["id"]))
        if not concluded:
            concluded = {**session, "status": "concluida"}
        return build_session_detail(concluded)

    # Sem sessão ativa: reparar irmãs se a âncora já estiver concluída no grupo.
    concluded_anchor = get_concluida_session(ano, os_id, gravacao_externa_id)
    if concluded_anchor and concluded_anchor.get("juntada_grupo_id"):
        sisters = list_active_externa_by_juntada(
            str(concluded_anchor["juntada_grupo_id"])
        )
        if sisters:
            launcher = str(concluded_anchor.get("lancado_por_ponto") or "")
            _run_concluir_targets(
                targets=sisters,
                ponto_andamento=ponto_andamento,
                email_ano=ano,
                email_os_id=os_id,
                email_launcher=launcher,
                email_launcher_nome=concluded_anchor.get("lancado_por_nome"),
                push_session=concluded_anchor,
            )
            refreshed = get_session_by_id(int(concluded_anchor["id"])) or concluded_anchor
            return build_session_detail(refreshed)
        return build_session_detail(concluded_anchor)

    return _concluir_gravacao_sem_sessao(
        ano=ano, os_id=os_id, operador_ponto=operador_ponto
    )


def get_concluida_session(
    ano: int,
    os_id: int,
    session_id: int | None = None,
) -> Optional[dict[str, Any]]:
    if session_id is not None:
        session = get_session_by_id(int(session_id))
        if (
            not session
            or int(session["os_ano"]) != int(ano)
            or int(session["os_nro"]) != int(os_id)
            or session["status"] != "concluida"
            or session.get("entrega_lancada_em") is not None
        ):
            return None
        return session
    rows = db.execute_query(
        """
        SELECT * FROM tab_os_gravacao_externa
        WHERE OsAno = %s AND OsNro = %s AND Status = 'concluida'
        ORDER BY Id DESC
        LIMIT 1
        """,
        (ano, os_id),
    )
    if not rows:
        return None
    return _map_session_row(rows[0])


def list_os_gravacao_aguardando_entrega(
    *,
    ano: Optional[int] = None,
    search: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    fornecedor_ponto: Optional[str] = None,
) -> tuple[list[dict[str, Any]], int]:
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    filters = """
        WHERE ge.Status = 'concluida'
          AND ge.EntregaLancadaEm IS NULL
    """
    if ano:
        filters += " AND ge.OsAno = %(ano)s"
        params["ano"] = ano
    if fornecedor_ponto:
        params["fornecedor_ponto"] = (
            format_ponto(_clean_ponto(fornecedor_ponto)) or str(fornecedor_ponto).strip()
        )
        filters += " AND ge.FornecedorPonto = %(fornecedor_ponto)s"
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

    count_sql = f"""
        SELECT COUNT(*) AS cnt FROM (
            SELECT COALESCE(
                ge.JuntadaGrupoId,
                CONCAT('s-', ge.Id)
            ) AS gkey
            FROM tab_os_gravacao_externa ge
            INNER JOIN tabProtocolos p
                ON p.NroProtocolo = ge.OsNro AND p.AnoProtocolo = ge.OsAno
            {filters}
            GROUP BY gkey
        ) t
    """
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
    count_row = db.execute_query(count_sql, count_params)
    total = int((count_row[0] if count_row else {}).get("cnt") or 0)

    list_sql = f"""
        SELECT
            p.NroProtocolo AS nr_os,
            p.AnoProtocolo AS ano,
            p.Titular AS solicitante,
            p.NomeUsuario AS nome_usuario,
            ge.Id AS gravacao_externa_id,
            ge.Status AS gravacao_status,
            ge.LancadoPorPonto AS lancado_por_ponto,
            ge.LancadoPorNome AS lancado_por_nome,
            ge.FornecedorPonto AS fornecedor_ponto,
            uf.Nome AS fornecedor_nome,
            ge.ConcluidaEm AS concluida_em,
            ge.ConcluidaPorPonto AS concluida_por_ponto,
            ge.CriadoEm AS gravacao_criado_em,
            ge.OrigemPendenteId AS origem_pendente_id,
            ge.JuntadaGrupoId AS juntada_grupo_id,
            ge.Componente AS componente,
            (
                SELECT d.TipoPublicacaoLink
                FROM tabDetalhesServico d
                WHERE d.NroProtocoloLinkDet = p.NroProtocolo
                  AND d.AnoProtocoloLinkDet = p.AnoProtocolo
                LIMIT 1
            ) AS produto,
            (
                SELECT d.Titulo
                FROM tabDetalhesServico d
                WHERE d.NroProtocoloLinkDet = p.NroProtocolo
                  AND d.AnoProtocoloLinkDet = p.AnoProtocolo
                LIMIT 1
            ) AS titulo
        FROM tab_os_gravacao_externa ge
        INNER JOIN tabProtocolos p
            ON p.NroProtocolo = ge.OsNro AND p.AnoProtocolo = ge.OsAno
        LEFT JOIN tabUsuarios uf
            ON uf.Ponto = NULLIF(
                CAST(
                    REPLACE(REPLACE(IFNULL(ge.FornecedorPonto, ''), '.', ''), '-', '')
                    AS UNSIGNED
                ),
                0
            )
        {filters}
        ORDER BY ge.ConcluidaEm DESC, ge.Id DESC
        LIMIT 2000
    """
    list_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
    rows = db.execute_query(list_sql, list_params)
    items: list[dict[str, Any]] = []
    for row in rows or []:
        origem = row.get("origem_pendente_id")
        chapas = _fetch_chapas_origem_pendente(int(origem) if origem else None)
        juntada = row.get("juntada_grupo_id")
        items.append(
            {
                "nr_os": int(row["nr_os"]),
                "ano": int(row["ano"]),
                "solicitante": row.get("solicitante") or row.get("nome_usuario"),
                "produto": row.get("produto"),
                "titulo": row.get("titulo"),
                "situacao": SITUACAO_GRAV_CONCLUIDA,
                "setor": SETOR_GRAVACAO_CONCLUIDA,
                "last_update": row.get("concluida_em"),
                "gravacao_externa_id": row.get("gravacao_externa_id"),
                "gravacao_status": row.get("gravacao_status") or "concluida",
                "lancado_por_ponto": row.get("lancado_por_ponto"),
                "lancado_por_nome": row.get("lancado_por_nome"),
                "fornecedor_ponto": row.get("fornecedor_ponto"),
                "fornecedor_nome": row.get("fornecedor_nome"),
                "concluida_em": row.get("concluida_em"),
                "concluida_por_ponto": row.get("concluida_por_ponto"),
                "gravacao_criado_em": row.get("gravacao_criado_em"),
                "juntada_grupo_id": str(juntada).strip() if juntada else None,
                "componente": normalize_stored_gravacao_componente(row.get("componente")),
                "chapas_por_maquina": chapas,
                "total_chapas": sum(int(c.get("quantidade") or 0) for c in chapas),
            }
        )
    from services.gravacao_pendente_service import _aggregate_list_items_by_juntada

    aggregated = _aggregate_list_items_by_juntada(items)
    return aggregated[offset : offset + limit], total


def _notify_entrega_chapas(*, ano: int, os_id: int, new_cod: str) -> None:
    _notify_andamento_mdb(
        task_name="gravacao_entrega",
        ano=ano,
        os_id=os_id,
        new_cod=new_cod,
        situacao=SITUACAO_RECEBIDO,
        setor=SETOR_ENTREGA_CHAPAS,
        source="gravacao_externa_entrega",
        operation="insert",
    )


def _entrega_uma_sessao_cursor(
    cursor,
    *,
    session: dict[str, Any],
    recebido_fmt: str,
    recebido_nome: str,
    obs: str,
) -> str:
    """Lança entrega e andamento Recebido/Gravação para uma sessão concluída."""
    from routers.os_audit_service import log_andamento_added
    from services.andamento_operacional import insert_andamento_as_ultimo

    os_id = int(session["os_nro"])
    ano = int(session["os_ano"])
    session_id = int(session["id"])

    cursor.execute(
        """
        UPDATE tab_os_gravacao_externa
        SET EntregaLancadaEm = NOW(),
            RecebidoPorPonto = %s,
            RecebidoPorNome = %s
        WHERE Id = %s AND EntregaLancadaEm IS NULL
        """,
        (recebido_fmt, recebido_nome, session_id),
    )
    if cursor.rowcount == 0:
        raise HTTPException(
            status_code=400,
            detail="Recebimento de chapas já foi lançado para esta OS.",
        )

    base_prefix = f"{os_id:05d}{ano}-"
    cursor.execute(
        "SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE %s",
        (f"{base_prefix}%",),
    )
    res = cursor.fetchone()
    next_seq = 1
    if res and res.get("max_cod"):
        try:
            next_seq = int(str(res["max_cod"]).split("-")[-1]) + 1
        except ValueError:
            next_seq = 1
    new_cod = f"{base_prefix}{next_seq:02d}"

    insert_andamento_as_ultimo(
        cursor,
        cod_status=new_cod,
        nro=os_id,
        ano=ano,
        situacao=SITUACAO_RECEBIDO,
        setor=SETOR_ENTREGA_CHAPAS,
        obs=obs,
        ponto=recebido_fmt,
    )
    log_andamento_added(
        cursor,
        nro=os_id,
        ano=ano,
        cod_status=new_cod,
        situacao=SITUACAO_RECEBIDO,
        setor=SETOR_ENTREGA_CHAPAS,
        obs=obs,
        ponto=recebido_fmt,
        origem="gravacao_externa_entrega",
    )
    return new_cod


def lancar_entrega_chapas(
    *,
    ano: int,
    os_id: int,
    recebido_por_ponto: str,
    recebido_por_nome: str | None = None,
    gravacao_externa_id: int | None = None,
) -> dict[str, Any]:
    session = get_concluida_session(ano, os_id, gravacao_externa_id)
    if not session:
        raise HTTPException(
            status_code=404,
            detail="Sessão concluída de Gravação Externa não encontrada.",
        )
    if session.get("entrega_lancada_em"):
        raise HTTPException(
            status_code=400,
            detail="Recebimento de chapas já foi lançado para esta OS.",
        )

    recebido_fmt = format_ponto(_clean_ponto(recebido_por_ponto))
    if not recebido_fmt:
        raise HTTPException(status_code=400, detail="Informe o ponto de quem recebeu.")
    recebido_nome = (recebido_por_nome or "").strip()
    if not recebido_nome:
        recebido_nome = (
            _lookup_usuario_nome(recebido_fmt)
            or _lookup_usuario_nome(recebido_por_ponto)
            or ""
        )
    if not recebido_nome:
        raise HTTPException(
            status_code=400,
            detail="Informe o nome de quem recebeu.",
        )
    if len(recebido_nome) > 128:
        raise HTTPException(
            status_code=400,
            detail="Nome de quem recebeu deve ter no máximo 128 caracteres.",
        )

    juntada_id = session.get("juntada_grupo_id")
    if juntada_id:
        targets = list_concluida_aguardando_entrega_by_juntada(str(juntada_id)) or [
            session
        ]
    else:
        targets = [session]

    from routers.andamento_helpers import (
        format_andamento_obs,
        format_gravacao_entrega_obs,
        with_juntada_obs_prefix,
    )
    from services.gravacao_pendente_service import juntada_membros_label

    prepared: list[tuple[dict[str, Any], str]] = []
    for target in targets:
        chapas = _fetch_chapas_origem_pendente(target.get("origem_pendente_id"))
        obs = format_andamento_obs(
            with_gravacao_componente_obs_prefix(
                with_juntada_obs_prefix(
                    format_gravacao_entrega_obs(chapas),
                    juntada_membros_label(target.get("juntada_grupo_id")),
                ),
                target.get("componente"),
            )
        )
        prepared.append((target, obs))

    session_id = int(session["id"])

    def tx(cursor):
        codes: list[tuple[int, int, str]] = []
        for target, obs in prepared:
            new_cod = _entrega_uma_sessao_cursor(
                cursor,
                session=target,
                recebido_fmt=recebido_fmt,
                recebido_nome=recebido_nome,
                obs=obs,
            )
            codes.append((int(target["os_ano"]), int(target["os_nro"]), new_cod))
        return codes

    codes = db.execute_transaction([tx])[0]
    for a, n, new_cod in codes:
        _notify_entrega_chapas(ano=a, os_id=n, new_cod=str(new_cod))

    updated = get_session_by_id(session_id)
    if not updated:
        raise HTTPException(status_code=500, detail="Falha ao atualizar sessão após entrega.")
    return build_session_detail(updated)


def repair_legacy_gravacao_externa_andamentos() -> list[dict[str, Any]]:
    """One-shot: OSs em OPs em andamento com andamento legado → Saída p/ ou Recebido + sync MDB."""
    from routers.andamento_helpers import (
        format_andamento_obs,
        format_gravacao_envio_externa_obs,
        format_gravacao_recebido_obs,
        with_juntada_obs_prefix,
    )
    from services.andamento_operacional import ultimo_operacional_cod_subquery
    from services.gravacao_pendente_service import juntada_membros_label

    ultimo_cod = ultimo_operacional_cod_subquery("ge.OsNro", "ge.OsAno")
    rows = db.execute_query(
        f"""
        SELECT
            ge.Id AS ge_id,
            ge.OsNro AS os_nro,
            ge.OsAno AS os_ano,
            ge.Status AS ge_status,
            ge.OrigemPendenteId AS origem_pendente_id,
            ge.JuntadaGrupoId AS juntada_grupo_id,
            a.CodStatus AS cod_status
        FROM tab_os_gravacao_externa ge
        INNER JOIN tabAndamento a
            ON a.CodStatus = {ultimo_cod}
        WHERE ge.Status IN ('pendente', 'iniciada')
          AND a.SituacaoLink = %s
        ORDER BY ge.Id ASC
        """,
        (SITUACAO_GRAVACAO_EXTERNA,),
    )
    repaired: list[dict[str, Any]] = []
    for row in rows or []:
        os_id = int(row["os_nro"])
        ano = int(row["os_ano"])
        cod_status = str(row["cod_status"] or "").strip()
        status = str(row["ge_status"] or "").strip()
        if not cod_status:
            continue
        origem = row.get("origem_pendente_id")
        chapas = _fetch_chapas_origem_pendente(int(origem) if origem else None)
        juntada_label = juntada_membros_label(
            str(row.get("juntada_grupo_id") or "").strip() or None
        )
        if status == "iniciada":
            new_sit = SITUACAO_RECEBIDO
            new_setor = SETOR_GRAV_EXTERNA
            obs = format_andamento_obs(
                with_juntada_obs_prefix(
                    format_gravacao_recebido_obs(chapas),
                    juntada_label,
                )
            )
        else:
            new_sit = SITUACAO_SAIDA_P
            new_setor = SETOR_GRAV_EXTERNA
            obs = format_andamento_obs(
                with_juntada_obs_prefix(
                    format_gravacao_envio_externa_obs(chapas),
                    juntada_label,
                )
            )

        def tx(cursor, *, _cod=cod_status, _sit=new_sit, _setor=new_setor, _obs=obs):
            cursor.execute(
                """
                UPDATE tabAndamento
                SET SituacaoLink = %s,
                    SetorLink = %s,
                    `Observaçao` = %s
                WHERE CodStatus = %s
                """,
                (_sit, _setor, _obs, _cod),
            )
            return _cod

        db.execute_transaction([tx])
        _notify_andamento_mdb(
            task_name="gravacao_repair_legado",
            ano=ano,
            os_id=os_id,
            new_cod=cod_status,
            situacao=new_sit,
            setor=new_setor,
            source="repair_legacy_gravacao_externa",
            operation="update",
        )
        repaired.append(
            {
                "os_id": os_id,
                "ano": ano,
                "cod_status": cod_status,
                "situacao": new_sit,
                "setor": new_setor,
                "session_status": status,
            }
        )
    return repaired
