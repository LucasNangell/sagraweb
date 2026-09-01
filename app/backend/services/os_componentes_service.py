"""
Serviço MySQL-only: componentes persistentes, Sub OS lógica e andamentos independentes.
Espelho de andamento na tabAndamento usa UltimoStatus=0 para preservar status da OS principal.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from database import db
from routers.andamento_helpers import format_ponto
from routers.os_audit_service import ensure_audit_table, insert_entries, _entry

logger = logging.getLogger(__name__)

_FROZEN_SITUACOES = frozenset({"Entregue", "Cancelada", "Cancelado"})
_LEGACY_TIPOS = frozenset({"CAPA", "MIOLO", "ENCARTE"})

SOURCE_MANUAL_SUB_OS = "manual_sub_os"
SOURCE_INHERITED_MAIN_OS = "inherited_main_os"

# Fragmento SQL: andamento exclusivo/manual (não herdado da OS principal).
MANUAL_ANDAMENTO_SQL = """
(
    sa.source_type = 'manual_sub_os'
    OR (
        COALESCE(sa.source_type, '') NOT IN ('inherited_main_os')
        AND COALESCE(sa.herdado_da_os_principal, 0) = 0
        AND NOT (
            sa.source_cod_status IS NOT NULL
            AND TRIM(sa.source_cod_status) <> ''
            AND (sa.cod_status_espelho IS NULL OR TRIM(sa.cod_status_espelho) = '')
        )
    )
)
"""


def sub_os_listable_count_scalar_sql(
    *,
    nro_col: str = "p.NroProtocolo",
    ano_col: str = "p.AnoProtocolo",
) -> str:
    """Subquery correlacionada — Sub OSs ativas (OS dividida), inclusive só herdadas."""
    return f"""
        (SELECT COUNT(*)
         FROM tab_os_sub_os AS s_cnt
         WHERE s_cnt.nro_protocolo = {nro_col}
           AND s_cnt.ano_protocolo = {ano_col}
           AND s_cnt.ativo = 1)"""


def _format_db_datetime(value: Any) -> Optional[str]:
    """Converte datetime/date do MySQL para string ISO-like (API/JSON)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value).strip()
    return text or None


def _normalize_sub_os_history_row(row: Dict[str, Any]) -> Dict[str, Any]:
    source_type = row.get("source_type") or SOURCE_MANUAL_SUB_OS
    if not row.get("source_type") and row.get("herdado_da_os_principal"):
        source_type = SOURCE_INHERITED_MAIN_OS
    return {
        "id": int(row["id"]),
        "situacao": row.get("situacao") or "",
        "setor": row.get("setor") or "",
        "observacao": row.get("observacao"),
        "data": _format_db_datetime(row.get("data")),
        "ultimo_status": bool(row.get("ultimo_status")),
        "ponto": row.get("ponto"),
        "cod_status_espelho": row.get("cod_status_espelho"),
        "source_type": source_type,
        "source_cod_status": row.get("source_cod_status"),
        "herdado_da_os_principal": bool(row.get("herdado_da_os_principal")),
        "criado_em": _format_db_datetime(row.get("criado_em")),
        "criado_por": row.get("criado_por"),
    }


def normalize_componente_nome(nome: str) -> str:
    text = (nome or "").strip()
    if not text:
        return ""
    normalized = unicodedata.normalize("NFKD", text)
    ascii_text = "".join(c for c in normalized if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", ascii_text).strip().lower()


def build_sub_os_display_name(nro: int, componente_nome: str) -> str:
    return f"{nro} [{componente_nome.strip()}]"


def format_mirror_obs(nro: int, componente_nome: str, obs_text: str) -> str:
    """
    Observação espelhada na primeira linha: ``14h26 - OS 886 [Capa]``.
    Texto do usuário na linha seguinte, se houver.
    """
    now = datetime.now()
    hora = f"{now.hour:02d}h{now.minute:02d}"
    primeira_linha = f"{hora} - OS {nro} [{componente_nome.strip()}]"
    user = (obs_text or "").strip()
    return primeira_linha if not user else f"{primeira_linha}\n{user}"


def is_os_frozen(nro: int, ano: int, *, cursor=None) -> Tuple[bool, Optional[str]]:
    """True se a OS principal está Entregue/Cancelada (congela Sub OS)."""
    query = """
        SELECT SituacaoLink
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s AND UltimoStatus = 1
        ORDER BY Data DESC, CodStatus DESC
        LIMIT 1
    """
    if cursor is not None:
        cursor.execute(query, (nro, ano))
        row = cursor.fetchone()
    else:
        rows = db.execute_query(query, (nro, ano))
        row = rows[0] if rows else None
    situacao = (row.get("SituacaoLink") if row else "") or ""
    situacao = str(situacao).strip()
    return situacao in _FROZEN_SITUACOES, situacao or None


def _componente_from_payload(comp: Any) -> Dict[str, Any]:
    if hasattr(comp, "model_dump"):
        data = comp.model_dump()
        lotes = data.get("lotes") or []
        data["lotes"] = [
            l.model_dump() if hasattr(l, "model_dump") else l for l in lotes
        ]
        return data
    if isinstance(comp, dict):
        return comp
    return {
        "componente_id": getattr(comp, "componente_id", None),
        "id": getattr(comp, "id", None),
        "nome": getattr(comp, "nome", None),
        "tipo": getattr(comp, "tipo", None),
        "lotes": getattr(comp, "lotes", None) or [],
        "acabamentos": getattr(comp, "acabamentos", None) or [],
        "verso_em_branco": bool(getattr(comp, "verso_em_branco", False)),
    }


def _resolve_componente_nome(comp: Dict[str, Any]) -> str:
    nome = (comp.get("nome") or "").strip()
    if nome:
        return nome
    tipo = (comp.get("tipo") or "").strip().upper()
    labels = {"CAPA": "Capa", "MIOLO": "Miolo", "ENCARTE": "Encarte"}
    return labels.get(tipo, tipo or "Componente")


def _resolve_componente_id(comp: Dict[str, Any]) -> Optional[int]:
    raw = comp.get("componente_id") or comp.get("id")
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _lote_to_dict(lote: Any) -> Dict[str, Any]:
    """Serializa lote do payload (Pydantic ou dict) para techspec_json."""
    if hasattr(lote, "model_dump"):
        raw = lote.model_dump(exclude_none=False)
    elif isinstance(lote, dict):
        raw = dict(lote)
    else:
        raw = {}
    return {
        "id": raw.get("id") or "",
        "paginas": int(raw.get("paginas") or 0),
        "maquina_link": raw.get("maquina_link") or "",
        "papel_link": raw.get("papel_link") or "",
        "cores_link": raw.get("cores_link") or "",
        "papel_desc": raw.get("papel_desc") or "",
        "cores_desc": raw.get("cores_desc") or "",
        "impressao": str(raw.get("impressao") or "").strip(),
        "frente_verso": bool(raw.get("frente_verso")),
        "formato": str(raw.get("formato") or "").strip(),
        "acabamentos": [
            _acabamento_to_dict(a) for a in (raw.get("acabamentos") or []) if a
        ],
    }


def _acabamento_to_dict(item: Any) -> Dict[str, Any]:
    if hasattr(item, "model_dump"):
        raw = item.model_dump(exclude_none=False)
    elif isinstance(item, dict):
        raw = dict(item)
    else:
        raw = {}
    label = str(raw.get("label") or "").strip()
    variacao_label = str(raw.get("variacao_label") or "").strip()
    out: Dict[str, Any] = {"label": label or variacao_label}
    if raw.get("catalog_id") is not None:
        out["catalog_id"] = raw.get("catalog_id")
    if raw.get("variacao_id") is not None:
        out["variacao_id"] = raw.get("variacao_id")
    if variacao_label:
        out["variacao_label"] = variacao_label
    obs = str(raw.get("obs") or "").strip()
    if obs:
        out["obs"] = obs
    return out


def sync_componentes_from_techspec(
    cursor,
    *,
    nro: int,
    ano: int,
    techspec: Any,
    ponto: Optional[str] = None,
) -> None:
    """Persiste componentes do TechSpec no MySQL (upsert por ID ou tipo legado)."""
    if techspec is None:
        return

    componentes = getattr(techspec, "componentes", None)
    if componentes is None and isinstance(techspec, dict):
        componentes = techspec.get("componentes")
    if componentes is None:
        return
    componentes = list(componentes or [])

    cursor.execute(
        """
        SELECT id, nome, nome_normalizado, tipo, ativo, techspec_json, ordem
        FROM tab_os_componentes
        WHERE nro_protocolo = %s AND ano_protocolo = %s
        """,
        (nro, ano),
    )
    existing_rows = cursor.fetchall() or []
    by_id = {int(r["id"]): r for r in existing_rows}
    by_tipo = {
        str(r.get("tipo") or "").upper(): r
        for r in existing_rows
        if r.get("tipo")
    }

    seen_ids: set[int] = set()
    for ordem, comp_raw in enumerate(componentes):
        comp = _componente_from_payload(comp_raw)
        nome = _resolve_componente_nome(comp)
        if not nome:
            continue
        nome_norm = normalize_componente_nome(nome)
        tipo = (comp.get("tipo") or "").strip().upper() or None
        if tipo and tipo not in _LEGACY_TIPOS:
            tipo = None
        lotes = [_lote_to_dict(l) for l in (comp.get("lotes") or [])]
        acabamentos = [
            _acabamento_to_dict(a) for a in (comp.get("acabamentos") or []) if a
        ]
        gerais_raw = getattr(techspec, "acabamentosGerais", None)
        if gerais_raw is None and isinstance(techspec, dict):
            gerais_raw = techspec.get("acabamentosGerais") or techspec.get(
                "acabamentos_gerais"
            )
        acabamentos_gerais = [
            _acabamento_to_dict(a) for a in (gerais_raw or []) if a
        ]
        techspec_json = json.dumps(
            {
                "lotes": lotes,
                "acabamentos": acabamentos,
                "acabamentos_gerais": acabamentos_gerais,
            },
            ensure_ascii=False,
        )
        comp_id = _resolve_componente_id(comp)

        row = None
        if comp_id and comp_id in by_id:
            row = by_id[comp_id]
        elif tipo and tipo in by_tipo:
            row = by_tipo[tipo]

        if row:
            cid = int(row["id"])
            seen_ids.add(cid)
            cursor.execute(
                """
                UPDATE tab_os_componentes
                SET nome = %s, nome_normalizado = %s, tipo = %s, ordem = %s,
                    ativo = 1, techspec_json = %s, atualizado_em = NOW(), atualizado_por = %s
                WHERE id = %s AND nro_protocolo = %s AND ano_protocolo = %s
                """,
                (nome, nome_norm, tipo, ordem, techspec_json, ponto, cid, nro, ano),
            )
            cursor.execute(
                """
                UPDATE tab_os_sub_os
                SET display_name = %s
                WHERE componente_id = %s AND nro_protocolo = %s AND ano_protocolo = %s
                """,
                (build_sub_os_display_name(nro, nome), cid, nro, ano),
            )
        else:
            cursor.execute(
                """
                INSERT INTO tab_os_componentes
                (nro_protocolo, ano_protocolo, nome, nome_normalizado, tipo, ordem, ativo,
                 techspec_json, criado_por)
                VALUES (%s, %s, %s, %s, %s, %s, 1, %s, %s)
                """,
                (nro, ano, nome, nome_norm, tipo, ordem, techspec_json, ponto),
            )
            new_id = cursor.lastrowid
            seen_ids.add(int(new_id))
            ensure_audit_table(cursor)
            insert_entries(
                cursor,
                [
                    _entry(
                        nro=nro,
                        ano=ano,
                        acao="CREATE",
                        entidade="componente",
                        ponto=ponto,
                        ref_cod=str(new_id),
                        descricao=f"Componente '{nome}' criado",
                    )
                ],
            )

    for row in existing_rows:
        cid = int(row["id"])
        if cid in seen_ids:
            continue
        has_sub = _componente_has_sub_os_history(cursor, cid) or _componente_has_sub_os(
            cursor, cid
        )
        if has_sub:
            cursor.execute(
                "UPDATE tab_os_componentes SET ativo = 0 WHERE id = %s",
                (cid,),
            )
        else:
            cursor.execute(
                "DELETE FROM tab_os_componentes WHERE id = %s AND nro_protocolo = %s AND ano_protocolo = %s",
                (cid, nro, ano),
            )


def _componente_has_sub_os_history(cursor, componente_id: int) -> bool:
    cursor.execute(
        """
        SELECT 1
        FROM tab_os_sub_os s
        JOIN tab_os_sub_os_andamento a ON a.sub_os_id = s.id
        WHERE s.componente_id = %s
        LIMIT 1
        """,
        (componente_id,),
    )
    return cursor.fetchone() is not None


def _componente_has_sub_os(cursor, componente_id: int) -> bool:
    """True se existe Sub OS vinculada, mesmo sem andamento."""
    cursor.execute(
        "SELECT 1 FROM tab_os_sub_os WHERE componente_id = %s LIMIT 1",
        (componente_id,),
    )
    return cursor.fetchone() is not None


def load_componentes_for_os(nro: int, ano: int, *, ativos_only: bool = True) -> List[Dict[str, Any]]:
    where = "nro_protocolo = %s AND ano_protocolo = %s"
    params: list[Any] = [nro, ano]
    if ativos_only:
        where += " AND ativo = 1"
    rows = db.execute_query(
        f"""
        SELECT id, nome, nome_normalizado, tipo, ordem, ativo, techspec_json,
               criado_em, criado_por, atualizado_em, atualizado_por
        FROM tab_os_componentes
        WHERE {where}
        ORDER BY ordem ASC, id ASC
        """,
        tuple(params),
    )
    result: List[Dict[str, Any]] = []
    for row in rows or []:
        lotes: list = []
        acabamentos: list = []
        acabamentos_gerais: list = []
        verso_em_branco = False
        raw_json = row.get("techspec_json")
        if raw_json:
            try:
                parsed = json.loads(raw_json) if isinstance(raw_json, str) else raw_json
                lotes = parsed.get("lotes") or []
                acabamentos = parsed.get("acabamentos") or []
                acabamentos_gerais = parsed.get("acabamentos_gerais") or []
                verso_em_branco = bool(parsed.get("verso_em_branco"))
            except (json.JSONDecodeError, TypeError, AttributeError):
                lotes = []
                acabamentos = []
                acabamentos_gerais = []
                verso_em_branco = False
        result.append(
            {
                "id": int(row["id"]),
                "nome": row["nome"],
                "nome_normalizado": row["nome_normalizado"],
                "tipo": row.get("tipo"),
                "ordem": int(row.get("ordem") or 0),
                "ativo": bool(row.get("ativo")),
                "lotes": lotes,
                "acabamentos": acabamentos,
                "acabamentos_gerais": acabamentos_gerais,
                "verso_em_branco": verso_em_branco,
            }
        )
    return result


def techspec_from_componentes_rows(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    componentes = []
    acabamentos_gerais: list = []
    for row in rows:
        if not acabamentos_gerais:
            acabamentos_gerais = row.get("acabamentos_gerais") or []
        comp: Dict[str, Any] = {
            "componente_id": row["id"],
            "nome": row["nome"],
            "lotes": row.get("lotes") or [],
            "acabamentos": row.get("acabamentos") or [],
        }
        if row.get("tipo"):
            comp["tipo"] = row["tipo"]
        if row.get("verso_em_branco"):
            comp["verso_em_branco"] = True
        componentes.append(comp)
    return {
        "version": 1,
        "componentes": componentes,
        "acabamentosGerais": acabamentos_gerais,
    }


def get_sub_os_current_status(sub_os_id: int) -> Optional[Dict[str, Any]]:
    """
    Status atual da Sub OS — exclusivamente tab_os_sub_os_andamento.
    Preferência: ultimo_status=1; fallback: mais recente por data/id.
    """
    rows = db.execute_query(
        """
        SELECT id, situacao, setor, observacao, data, ultimo_status
        FROM tab_os_sub_os_andamento
        WHERE sub_os_id = %s AND ultimo_status = 1
        ORDER BY data DESC, id DESC
        LIMIT 1
        """,
        (sub_os_id,),
    )
    if rows:
        return rows[0]
    rows = db.execute_query(
        """
        SELECT id, situacao, setor, observacao, data, ultimo_status
        FROM tab_os_sub_os_andamento
        WHERE sub_os_id = %s
        ORDER BY data DESC, id DESC
        LIMIT 1
        """,
        (sub_os_id,),
    )
    return rows[0] if rows else None


def _map_sub_os_list_row(row: Dict[str, Any], *, frozen: bool) -> Dict[str, Any]:
    sub_id = int(row["id"])
    current = get_sub_os_current_status(sub_id)
    has_history = db.execute_query(
        "SELECT 1 AS ok FROM tab_os_sub_os_andamento WHERE sub_os_id = %s LIMIT 1",
        (sub_id,),
    )
    situacao = (current.get("situacao") if current else None) or None
    setor = (current.get("setor") if current else None) or None
    observacao = (current.get("observacao") if current else None) or None
    data_atual = _format_db_datetime(current.get("data") if current else None)
    ultimo_id = int(current["id"]) if current and current.get("id") is not None else None
    mapped = {
        "id": sub_id,
        "display_name": row["display_name"],
        "componente_id": int(row["componente_id"]),
        "componente_nome": row["componente_nome"],
        "componente_tipo": row.get("componente_tipo"),
        "situacao_atual": situacao,
        "setor_atual": setor,
        "observacao_atual": observacao,
        "data_atual": data_atual,
        "ultimo_status_id": ultimo_id,
        "has_history": bool(has_history),
        "row_kind": "sub_os",
        "congelada": bool(row.get("congelada")) or frozen,
        "ativo": bool(row.get("ativo")),
        # Retrocompatível com contrato anterior do front-end.
        "situacao": situacao,
        "setor": setor,
        "data": data_atual,
    }
    return mapped


def list_sub_os(nro: int, ano: int, *, listable_only: bool = True) -> List[Dict[str, Any]]:
    ativo_sql = "AND s.ativo = 1" if listable_only else ""
    rows = db.execute_query(
        f"""
        SELECT s.id, s.display_name, s.ativo, s.congelada, s.componente_id,
               c.nome AS componente_nome, c.tipo AS componente_tipo
        FROM tab_os_sub_os s
        JOIN tab_os_componentes c ON c.id = s.componente_id
        WHERE s.nro_protocolo = %s AND s.ano_protocolo = %s
        {ativo_sql}
        ORDER BY c.ordem ASC, s.id ASC
        """,
        (nro, ano),
    )
    frozen, _ = is_os_frozen(nro, ano)
    return [_map_sub_os_list_row(r, frozen=frozen) for r in (rows or [])]


def count_sub_os(nro: int, ano: int, *, listable_only: bool = True) -> int:
    ativo_sql = "AND s.ativo = 1" if listable_only else ""
    rows = db.execute_query(
        f"""
        SELECT COUNT(*) AS cnt
        FROM tab_os_sub_os s
        WHERE s.nro_protocolo = %s AND s.ano_protocolo = %s
        {ativo_sql}
        """,
        (nro, ano),
    )
    return int((rows[0] if rows else {}).get("cnt") or 0)


def sub_os_has_manual_history(sub_os_id: int, *, cursor=None) -> bool:
    """True se a Sub OS possui ao menos um andamento exclusivo/manual."""
    sql = f"""
    SELECT 1 AS ok
    FROM tab_os_sub_os_andamento sa
    WHERE sa.sub_os_id = %s AND {MANUAL_ANDAMENTO_SQL}
    LIMIT 1
    """
    if cursor is not None:
        cursor.execute(sql, (sub_os_id,))
        return cursor.fetchone() is not None
    rows = db.execute_query(sql, (sub_os_id,))
    return bool(rows)


def os_has_any_manual_sub_os_andamento(cursor, nro: int, ano: int) -> bool:
    """True se alguma Sub OS da OS ainda tem andamento manual/exclusivo."""
    cursor.execute(
        f"""
        SELECT 1 AS ok
        FROM tab_os_sub_os s
        INNER JOIN tab_os_sub_os_andamento sa ON sa.sub_os_id = s.id
        WHERE s.nro_protocolo = %s AND s.ano_protocolo = %s
          AND {MANUAL_ANDAMENTO_SQL}
        LIMIT 1
        """,
        (nro, ano),
    )
    return cursor.fetchone() is not None


def deactivate_all_sub_os(cursor, nro: int, ano: int) -> None:
    """Reúne a OS: Sub OSs saem da lista (ativo=0) sem apagar histórico."""
    cursor.execute(
        """
        UPDATE tab_os_sub_os
        SET ativo = 0
        WHERE nro_protocolo = %s AND ano_protocolo = %s
        """,
        (nro, ano),
    )


def sync_sub_os_listable_state(cursor, sub_os_id: int) -> bool:
    """
    Se não restar andamento manual em nenhuma Sub OS da OS, desativa todas
    (volta ao modo unido). Não reativa irmãos só herdados nem OS já unida.
    Retorna True se ESTA Sub OS permanece listável (ativo=1).
    """
    cursor.execute(
        """
        SELECT nro_protocolo, ano_protocolo, ativo
        FROM tab_os_sub_os
        WHERE id = %s
        """,
        (sub_os_id,),
    )
    row = cursor.fetchone()
    if not row:
        return False
    nro = int(row["nro_protocolo"])
    ano = int(row["ano_protocolo"])
    if not os_has_any_manual_sub_os_andamento(cursor, nro, ano):
        deactivate_all_sub_os(cursor, nro, ano)
        return False
    return bool(row.get("ativo"))


def count_active_componentes(nro: int, ano: int) -> int:
    rows = db.execute_query(
        """
        SELECT COUNT(*) AS cnt
        FROM tab_os_componentes
        WHERE nro_protocolo = %s AND ano_protocolo = %s AND ativo = 1
        """,
        (nro, ano),
    )
    return int((rows[0] if rows else {}).get("cnt") or 0)


def os_has_active_componentes(nro: int, ano: int) -> bool:
    return count_active_componentes(nro, ano) > 0


def get_componente(nro: int, ano: int, componente_id: int) -> Optional[Dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT id, nome, ativo
        FROM tab_os_componentes
        WHERE id = %s AND nro_protocolo = %s AND ano_protocolo = %s
        """,
        (componente_id, nro, ano),
    )
    return rows[0] if rows else None


def get_sub_os(nro: int, ano: int, sub_os_id: int) -> Optional[Dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT s.*, c.nome AS componente_nome
        FROM tab_os_sub_os s
        JOIN tab_os_componentes c ON c.id = s.componente_id
        WHERE s.id = %s AND s.nro_protocolo = %s AND s.ano_protocolo = %s
        """,
        (sub_os_id, nro, ano),
    )
    return rows[0] if rows else None


def get_or_create_sub_os(
    cursor,
    *,
    nro: int,
    ano: int,
    componente_id: int,
    ponto: Optional[str] = None,
) -> Dict[str, Any]:
    frozen, situacao = is_os_frozen(nro, ano, cursor=cursor)
    if frozen:
        raise ValueError(f"OS {nro}/{ano} congelada ({situacao}) — Sub OS não pode ser criada")

    comp = get_componente(nro, ano, componente_id)
    if not comp or not comp.get("ativo", True):
        raise ValueError("Componente não encontrado ou inativo para esta OS")

    cursor.execute(
        """
        SELECT id, display_name, congelada, ativo
        FROM tab_os_sub_os
        WHERE nro_protocolo = %s AND ano_protocolo = %s AND componente_id = %s
        """,
        (nro, ano, componente_id),
    )
    existing = cursor.fetchone()
    display = build_sub_os_display_name(nro, comp["nome"])
    if existing:
        sub_id = int(existing["id"])
        if not existing.get("ativo"):
            cursor.execute(
                "UPDATE tab_os_sub_os SET ativo = 1 WHERE id = %s",
                (sub_id,),
            )
        return {
            "id": sub_id,
            "display_name": existing["display_name"],
            "created": False,
            "congelada": bool(existing.get("congelada")) or frozen,
        }

    cursor.execute(
        """
        INSERT INTO tab_os_sub_os
        (nro_protocolo, ano_protocolo, componente_id, display_name, ativo, congelada, criado_por)
        VALUES (%s, %s, %s, %s, 1, 0, %s)
        """,
        (nro, ano, componente_id, display, ponto),
    )
    sub_id = int(cursor.lastrowid)
    ensure_audit_table(cursor)
    insert_entries(
        cursor,
        [
            _entry(
                nro=nro,
                ano=ano,
                acao="CREATE",
                entidade="sub_os",
                ponto=ponto,
                ref_cod=str(sub_id),
                descricao=f"Sub OS {display} criada",
            )
        ],
    )
    return {"id": sub_id, "display_name": display, "created": True, "congelada": False}


def _generate_next_cod_status(cursor, nro: int, ano: int) -> str:
    base_prefix = f"{nro:05d}{ano}-"
    like_pattern = f"{base_prefix}%"
    cursor.execute(
        "SELECT MAX(CodStatus) AS max_cod FROM tabAndamento WHERE CodStatus LIKE %s",
        (like_pattern,),
    )
    res = cursor.fetchone()
    next_seq = 1
    if res and res.get("max_cod"):
        try:
            next_seq = int(str(res["max_cod"]).split("-")[-1]) + 1
        except ValueError:
            next_seq = 1
    return f"{base_prefix}{next_seq:02d}"


def list_sub_os_history(sub_os_id: int) -> List[Dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT id, situacao, setor, observacao, data, ultimo_status, ponto,
               cod_status_espelho, source_type, source_cod_status,
               herdado_da_os_principal, criado_em, criado_por
        FROM tab_os_sub_os_andamento
        WHERE sub_os_id = %s
        ORDER BY data ASC, id ASC
        """,
        (sub_os_id,),
    )
    return [_normalize_sub_os_history_row(r) for r in (rows or [])]


def _ensure_sub_os_for_componente_cursor(
    cursor,
    *,
    nro: int,
    ano: int,
    componente_id: int,
    ponto: Optional[str] = None,
    reactivate: bool = False,
) -> int:
    """Cria/reutiliza Sub OS para componente ativo (sem bloqueio de congelamento — propagação)."""
    cursor.execute(
        """
        SELECT id, ativo FROM tab_os_sub_os
        WHERE nro_protocolo = %s AND ano_protocolo = %s AND componente_id = %s
        """,
        (nro, ano, componente_id),
    )
    row = cursor.fetchone()
    if row:
        sub_id = int(row["id"])
        if reactivate and not row.get("ativo"):
            cursor.execute(
                "UPDATE tab_os_sub_os SET ativo = 1 WHERE id = %s",
                (sub_id,),
            )
        return sub_id

    comp = get_componente(nro, ano, componente_id)
    if not comp or not comp.get("ativo", True):
        raise ValueError(f"Componente {componente_id} inativo ou ausente")

    display = build_sub_os_display_name(nro, comp["nome"])
    cursor.execute(
        """
        INSERT INTO tab_os_sub_os
        (nro_protocolo, ano_protocolo, componente_id, display_name, ativo, congelada, criado_por)
        VALUES (%s, %s, %s, %s, %s, 0, %s)
        """,
        (nro, ano, componente_id, display, 1 if reactivate else 0, ponto),
    )
    return int(cursor.lastrowid)


def _fetch_main_operacional_andamento(cursor, nro: int, ano: int) -> Optional[Dict[str, Any]]:
    from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE

    cursor.execute(
        f"""
        SELECT a.CodStatus, a.SituacaoLink, a.SetorLink, a.`Observaçao`, a.Ponto
        FROM tabAndamento a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND a.UltimoStatus = 1
          AND {MIRROR_EXCLUDE_CLAUSE}
        ORDER BY a.`Data` DESC, a.CodStatus DESC
        LIMIT 1
        """,
        (nro, ano),
    )
    return cursor.fetchone()


def _seed_inherited_from_main(
    cursor,
    *,
    sub_os_id: int,
    main_row: Dict[str, Any],
    ponto_usuario: Optional[str] = None,
) -> None:
    cursor.execute(
        """
        SELECT 1 AS ok FROM tab_os_sub_os_andamento
        WHERE sub_os_id = %s AND ultimo_status = 1
        LIMIT 1
        """,
        (sub_os_id,),
    )
    if cursor.fetchone():
        return

    source_cod = str(main_row.get("CodStatus") or "")
    if source_cod:
        cursor.execute(
            """
            SELECT id FROM tab_os_sub_os_andamento
            WHERE sub_os_id = %s AND source_cod_status = %s
            LIMIT 1
            """,
            (sub_os_id, source_cod),
        )
        existing = cursor.fetchone()
        if existing:
            recalc_sub_os_ultimo_status(cursor, sub_os_id)
            return

    situacao = str(main_row.get("SituacaoLink") or "").strip()
    setor = str(main_row.get("SetorLink") or "").strip()
    if not situacao or not setor:
        return

    obs_text = str(main_row.get("Observaçao") or "").strip()
    ponto = str(main_row.get("Ponto") or "").strip()
    cursor.execute(
        """
        INSERT INTO tab_os_sub_os_andamento
        (sub_os_id, situacao, setor, observacao, data, ultimo_status, ponto, criado_por,
         source_type, source_cod_status, herdado_da_os_principal, cod_status_espelho)
        VALUES (%s, %s, %s, %s, NOW(), 1, %s, %s, %s, %s, 1, NULL)
        """,
        (
            sub_os_id,
            situacao,
            setor,
            obs_text or None,
            ponto or None,
            ponto_usuario,
            SOURCE_INHERITED_MAIN_OS,
            source_cod or None,
        ),
    )


def ensure_split_for_all_componentes(
    cursor,
    *,
    nro: int,
    ano: int,
    skip_seed_sub_os_id: Optional[int] = None,
    ponto: Optional[str] = None,
) -> List[int]:
    """
    Cria/reativa Sub OS de todos os componentes ativos e semeia irmãos sem
    status atual com o andamento operacional da OS principal.
    """
    cursor.execute(
        """
        SELECT id FROM tab_os_componentes
        WHERE nro_protocolo = %s AND ano_protocolo = %s AND ativo = 1
        ORDER BY ordem ASC, id ASC
        """,
        (nro, ano),
    )
    componentes = cursor.fetchall() or []
    if not componentes:
        return []

    main_row = _fetch_main_operacional_andamento(cursor, nro, ano)
    affected: List[int] = []
    for comp_row in componentes:
        sub_id = _ensure_sub_os_for_componente_cursor(
            cursor,
            nro=nro,
            ano=ano,
            componente_id=int(comp_row["id"]),
            ponto=ponto,
            reactivate=True,
        )
        affected.append(sub_id)
        if skip_seed_sub_os_id is not None and sub_id == skip_seed_sub_os_id:
            continue
        if main_row:
            _seed_inherited_from_main(
                cursor,
                sub_os_id=sub_id,
                main_row=main_row,
                ponto_usuario=ponto,
            )
    return affected


def recalc_sub_os_ultimo_status(cursor, sub_os_id: int) -> Optional[int]:
    """Promove o andamento mais recente da Sub OS a ultimo_status=1."""
    cursor.execute(
        "UPDATE tab_os_sub_os_andamento SET ultimo_status = 0 WHERE sub_os_id = %s",
        (sub_os_id,),
    )
    cursor.execute(
        """
        SELECT id FROM tab_os_sub_os_andamento
        WHERE sub_os_id = %s
        ORDER BY data DESC, id DESC
        LIMIT 1
        """,
        (sub_os_id,),
    )
    row = cursor.fetchone()
    if not row:
        return None
    hist_id = int(row["id"])
    cursor.execute(
        "UPDATE tab_os_sub_os_andamento SET ultimo_status = 1 WHERE id = %s",
        (hist_id,),
    )
    return hist_id


def propagate_main_os_andamento_to_sub_os(
    cursor,
    *,
    nro: int,
    ano: int,
    source_cod_status: str,
    situacao: str,
    setor: str,
    obs: str,
    ponto: str,
    ponto_usuario: Optional[str] = None,
) -> List[int]:
    """
    Propaga andamento da OS principal para Sub OSs de componentes ativos.
    Não cria espelho em tabAndamento.
    """
    cursor.execute(
        """
        SELECT id FROM tab_os_componentes
        WHERE nro_protocolo = %s AND ano_protocolo = %s AND ativo = 1
        ORDER BY ordem ASC, id ASC
        """,
        (nro, ano),
    )
    componentes = cursor.fetchall() or []
    if not componentes:
        return []

    obs_text = (obs or "").strip()
    affected: List[int] = []

    for comp_row in componentes:
        comp_id = int(comp_row["id"])
        sub_id = _ensure_sub_os_for_componente_cursor(
            cursor, nro=nro, ano=ano, componente_id=comp_id, ponto=ponto_usuario
        )

        cursor.execute(
            """
            SELECT id FROM tab_os_sub_os_andamento
            WHERE sub_os_id = %s AND source_cod_status = %s
            LIMIT 1
            """,
            (sub_id, source_cod_status),
        )
        if cursor.fetchone():
            continue

        cursor.execute(
            """
            UPDATE tab_os_sub_os_andamento SET ultimo_status = 0
            WHERE sub_os_id = %s AND ultimo_status = 1
            """,
            (sub_id,),
        )
        cursor.execute(
            """
            INSERT INTO tab_os_sub_os_andamento
            (sub_os_id, situacao, setor, observacao, data, ultimo_status, ponto, criado_por,
             source_type, source_cod_status, herdado_da_os_principal, cod_status_espelho)
            VALUES (%s, %s, %s, %s, NOW(), 1, %s, %s, %s, %s, 1, NULL)
            """,
            (
                sub_id,
                situacao,
                setor,
                obs_text or None,
                ponto,
                ponto_usuario,
                SOURCE_INHERITED_MAIN_OS,
                source_cod_status,
            ),
        )
        affected.append(sub_id)

    if affected:
        ensure_audit_table(cursor)
        insert_entries(
            cursor,
            [
                _entry(
                    nro=nro,
                    ano=ano,
                    acao="CREATE",
                    entidade="sub_os_andamento_herdado",
                    ponto=ponto_usuario,
                    ref_cod=source_cod_status,
                    descricao=(
                        f"Andamento principal {source_cod_status} propagado para "
                        f"{len(affected)} Sub OS(s)"
                    ),
                )
            ],
        )
    return affected


def delete_inherited_andamento_for_main_cod(
    cursor,
    source_cod_status: str,
    *,
    nro: int = 0,
    ano: int = 0,
) -> List[int]:
    """
    Remove andamentos de Sub OS vinculados ao CodStatus excluído da OS principal:
    - herdados (`source_cod_status`);
    - espelho manual (`cod_status_espelho` na tabAndamento).
    Recalcula ultimo_status e listabilidade de cada Sub OS afetada.
    """
    cursor.execute(
        """
        SELECT DISTINCT sub_os_id
        FROM tab_os_sub_os_andamento
        WHERE source_cod_status = %s
           OR (cod_status_espelho IS NOT NULL AND cod_status_espelho = %s)
        """,
        (source_cod_status, source_cod_status),
    )
    sub_ids = [int(r["sub_os_id"]) for r in (cursor.fetchall() or [])]
    if not sub_ids:
        return []

    cursor.execute(
        """
        DELETE FROM tab_os_sub_os_andamento
        WHERE source_cod_status = %s
           OR (cod_status_espelho IS NOT NULL AND cod_status_espelho = %s)
        """,
        (source_cod_status, source_cod_status),
    )

    ensure_audit_table(cursor)
    insert_entries(
        cursor,
        [
            _entry(
                nro=nro,
                ano=ano,
                acao="DELETE",
                entidade="sub_os_andamento_cascade",
                ref_cod=source_cod_status,
                descricao=(
                    f"Andamento principal {source_cod_status} excluído — "
                    f"removidos registros em {len(sub_ids)} Sub OS(s)"
                ),
            )
        ],
    )

    for sub_id in sub_ids:
        recalc_sub_os_ultimo_status(cursor, sub_id)
        sync_sub_os_listable_state(cursor, sub_id)
    return sub_ids


def _resolve_sub_history_source_type(row: Dict[str, Any]) -> str:
    explicit = (row.get("source_type") or "").strip()
    if explicit:
        return explicit
    if row.get("herdado_da_os_principal"):
        return SOURCE_INHERITED_MAIN_OS
    if row.get("source_cod_status") and not row.get("cod_status_espelho"):
        return SOURCE_INHERITED_MAIN_OS
    return SOURCE_MANUAL_SUB_OS


def delete_sub_os_history(
    *,
    nro: int,
    ano: int,
    sub_os_id: int,
    history_id: int,
    ponto_usuario: Optional[str] = None,
) -> Dict[str, Any]:
    """Exclui andamento de Sub OS (manual com espelho ou herdado)."""
    import hashlib

    from routers.os_routes import _dispatch_mdb_sync
    from routers.os_audit_service import log_andamento_deleted

    def transaction_logic(cursor):
        sub = get_sub_os(nro, ano, sub_os_id)
        if not sub:
            raise ValueError("Sub OS não encontrada para esta OS")

        frozen, situacao_os = is_os_frozen(nro, ano, cursor=cursor)
        if frozen or sub.get("congelada"):
            raise ValueError(
                f"OS {nro}/{ano} congelada ({situacao_os}) — exclusão de Sub OS bloqueada"
            )

        cursor.execute(
            """
            SELECT id, situacao, setor, observacao, data, ultimo_status, ponto,
                   cod_status_espelho, source_type, source_cod_status, herdado_da_os_principal
            FROM tab_os_sub_os_andamento
            WHERE id = %s AND sub_os_id = %s
            """,
            (history_id, sub_os_id),
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError("Andamento da Sub OS não encontrado")

        source_type = _resolve_sub_history_source_type(row)
        mirror_cod = row.get("cod_status_espelho")
        is_inherited = source_type == SOURCE_INHERITED_MAIN_OS

        if is_inherited:
            cursor.execute(
                "DELETE FROM tab_os_sub_os_andamento WHERE id = %s",
                (history_id,),
            )
        else:
            if mirror_cod:
                cursor.execute(
                    """
                    SELECT SituacaoLink, SetorLink, Data, UltimoStatus, Observaçao, Ponto
                    FROM tabAndamento WHERE CodStatus = %s
                    """,
                    (mirror_cod,),
                )
                mirror_row = cursor.fetchone()
                if mirror_row:
                    content_fields = [
                        str(mirror_row.get("SituacaoLink") or ""),
                        str(mirror_row.get("SetorLink") or ""),
                        str(mirror_row.get("Data") or ""),
                        str(mirror_row.get("UltimoStatus") or ""),
                        str(mirror_row.get("Observaçao") or ""),
                        str(mirror_row.get("Ponto") or ""),
                    ]
                    content_hash = hashlib.sha256(
                        "|".join(content_fields).encode("utf-8")
                    ).hexdigest()
                    cursor.execute(
                        """
                        INSERT INTO deleted_andamentos
                        (codstatus, nro, ano, content_hash, deleted_at, motivo, origem)
                        VALUES (%s, %s, %s, %s, NOW(), 'Exclusão espelho Sub OS', 'API')
                        ON DUPLICATE KEY UPDATE deleted_at = NOW(),
                            content_hash = VALUES(content_hash)
                        """,
                        (mirror_cod, nro, ano, content_hash),
                    )
                    log_andamento_deleted(
                        cursor,
                        nro=nro,
                        ano=ano,
                        cod_status=mirror_cod,
                        old_row=mirror_row or {},
                    )
                cursor.execute(
                    "DELETE FROM tabAndamento WHERE CodStatus = %s AND UltimoStatus = 0",
                    (mirror_cod,),
                )

            cursor.execute(
                "DELETE FROM tab_os_sub_os_andamento WHERE id = %s",
                (history_id,),
            )

        new_ultimo_id = recalc_sub_os_ultimo_status(cursor, sub_os_id)
        still_listable = sync_sub_os_listable_state(cursor, sub_os_id)

        ensure_audit_table(cursor)
        insert_entries(
            cursor,
            [
                _entry(
                    nro=nro,
                    ano=ano,
                    acao="DELETE",
                    entidade="sub_os_andamento",
                    ponto=ponto_usuario,
                    ref_cod=str(history_id),
                    descricao=(
                        f"Exclusão andamento Sub OS {sub.get('display_name')} "
                        f"({'herdado' if is_inherited else 'manual'})"
                    ),
                )
            ],
        )

        return {
            "mirror_cod_status": mirror_cod if not is_inherited else None,
            "inherited": is_inherited,
            "ultimo_status_id": new_ultimo_id,
            "still_listable": still_listable,
        }

    result = db.execute_transaction([transaction_logic])[0]

    try:
        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            nro,
            ano,
            "sub_os_history_deleted",
            sub_os_id=sub_os_id,
            scope="sub_os",
        )
    except Exception as exc:
        logger.warning("Falha ao emitir WS sub_os_history_deleted: %s", exc)

    mirror = result.get("mirror_cod_status")
    if mirror:
        def _sync_delete_mirror() -> None:
            from routers.mdb_writer import sync_andamento_delete_to_mdb

            sync_andamento_delete_to_mdb(mirror, nro, ano)

        _dispatch_mdb_sync(
            "sub_os_history_mirror_delete",
            _sync_delete_mirror,
            cod_status=mirror,
            nro=nro,
            ano=ano,
        )

    return result


def add_sub_os_history(
    *,
    nro: int,
    ano: int,
    sub_os_id: int,
    situacao: str,
    setor: str,
    obs: str,
    usuario: str,
    ponto_usuario: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Cria andamento da Sub OS + espelho na tabAndamento (UltimoStatus=0) + sync MDB do espelho.
    """
    from routers.os_routes import _dispatch_mdb_sync
    from routers.os_audit_service import log_andamento_added

    clean_user = "".join(filter(str.isdigit, usuario or ""))
    ponto_formatado = format_ponto(clean_user)

    def transaction_logic(cursor):
        sub = get_sub_os(nro, ano, sub_os_id)
        if not sub:
            raise ValueError("Sub OS não encontrada para esta OS")

        frozen, situacao_os = is_os_frozen(nro, ano, cursor=cursor)
        if frozen or sub.get("congelada"):
            raise ValueError(
                f"OS {nro}/{ano} congelada ({situacao_os}) — andamento de Sub OS bloqueado"
            )

        cursor.execute(
            "UPDATE tab_os_sub_os SET ativo = 1 WHERE id = %s",
            (sub_os_id,),
        )

        ensure_split_for_all_componentes(
            cursor,
            nro=nro,
            ano=ano,
            skip_seed_sub_os_id=sub_os_id,
            ponto=ponto_usuario,
        )

        componente_nome = sub.get("componente_nome") or ""
        obs_sub = (obs or "").strip()
        mirror_obs = format_mirror_obs(nro, componente_nome, obs_sub)

        cursor.execute(
            "UPDATE tab_os_sub_os_andamento SET ultimo_status = 0 WHERE sub_os_id = %s AND ultimo_status = 1",
            (sub_os_id,),
        )

        cursor.execute(
            """
            INSERT INTO tab_os_sub_os_andamento
            (sub_os_id, situacao, setor, observacao, data, ultimo_status, ponto, criado_por,
             source_type, source_cod_status, herdado_da_os_principal, cod_status_espelho)
            VALUES (%s, %s, %s, %s, NOW(), 1, %s, %s, %s, NULL, 0, NULL)
            """,
            (
                sub_os_id,
                situacao,
                setor,
                obs_sub or None,
                ponto_formatado,
                ponto_usuario,
                SOURCE_MANUAL_SUB_OS,
            ),
        )
        sub_history_id = int(cursor.lastrowid)

        # Espelho na OS principal — UltimoStatus=0 (não altera status operacional).
        mirror_cod = _generate_next_cod_status(cursor, nro, ano)
        cursor.execute(
            """
            INSERT INTO tabAndamento
            (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink,
             `Data`, UltimoStatus, `Observaçao`, Ponto)
            VALUES (%s, %s, %s, %s, %s, NOW(), 0, %s, %s)
            """,
            (mirror_cod, nro, ano, situacao, setor, mirror_obs, ponto_formatado),
        )

        cursor.execute(
            """
            UPDATE tab_os_sub_os_andamento
            SET cod_status_espelho = %s
            WHERE id = %s
            """,
            (mirror_cod, sub_history_id),
        )

        log_andamento_added(
            cursor,
            nro=nro,
            ano=ano,
            cod_status=mirror_cod,
            situacao=situacao,
            setor=setor,
            obs=mirror_obs,
            ponto=ponto_formatado,
            origem="API",
        )

        ensure_audit_table(cursor)
        insert_entries(
            cursor,
            [
                _entry(
                    nro=nro,
                    ano=ano,
                    acao="CREATE",
                    entidade="sub_os_andamento",
                    ponto=ponto_usuario,
                    ref_cod=str(sub_history_id),
                    descricao=f"Andamento Sub OS {sub.get('display_name')}: {situacao}",
                ),
                _entry(
                    nro=nro,
                    ano=ano,
                    acao="CREATE",
                    entidade="sub_os_espelho",
                    ponto=ponto_usuario,
                    ref_cod=mirror_cod,
                    descricao=f"Espelho andamento componente {componente_nome} (UltimoStatus=0)",
                ),
            ],
        )

        return {
            "sub_history_id": sub_history_id,
            "mirror_cod_status": mirror_cod,
            "componente_nome": componente_nome,
            "display_name": sub.get("display_name"),
        }

    result = db.execute_transaction([transaction_logic])[0]

    try:
        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            nro,
            ano,
            "sub_os_history_added",
            setor=setor,
            situacao=situacao,
            sub_os_id=sub_os_id,
            scope="sub_os",
        )
    except Exception as exc:
        logger.warning("Falha ao emitir WS sub_os_history_added: %s", exc)

    def _sync_mirror_to_mdb() -> None:
        from routers.mdb_writer import sync_andamento_from_mysql_to_mdb

        sync_andamento_from_mysql_to_mdb(result["mirror_cod_status"], nro, ano)

    _dispatch_mdb_sync(
        "sub_os_history_mirror",
        _sync_mirror_to_mdb,
        cod_status=result["mirror_cod_status"],
        nro=nro,
        ano=ano,
    )

    return result


def sync_sub_os_congelada_flags(nro: int, ano: int) -> None:
    """Atualiza flag congelada das Sub OS quando OS principal muda para Entregue/Cancelada."""
    frozen, _ = is_os_frozen(nro, ano)
    db.execute_query(
        "UPDATE tab_os_sub_os SET congelada = %s WHERE nro_protocolo = %s AND ano_protocolo = %s",
        (1 if frozen else 0, nro, ano),
    )
