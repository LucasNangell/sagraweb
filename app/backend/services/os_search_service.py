"""
Busca paginada de OSs — GET /api/os/search.
Fonte primária de situação/setor: tabAndamento (UltimoStatus=1, espelhos Sub OS excluídos).
tab_os_ultimo_andamento_operacional só entra com OS_SEARCH_PREFER_MATERIALIZED=1.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

from database import db
from os_text_search_indexes_schema import fulltext_text_search_indexes_ready
from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE
from services.os_sub_os_queries import (
    annotate_search_sub_os_matches,
    build_main_or_sub_os_filter_sql,
    fetch_home_sub_os_rows_for_pairs,
)
from services.os_componentes_service import sub_os_listable_count_scalar_sql
from services.os_text_search_utils import (
    OS_TEXT_SEARCH_MIN_CHARS,
    build_fulltext_boolean_query,
    build_solicitante_prefix_pattern,
    parse_text_search_term,
)
from services.andamento_table import get_andamento_table
from services.os_ultimo_andamento_service import TABLE as MATERIALIZED_TABLE, materialized_table_populated

logger = logging.getLogger(__name__)

OS_SEARCH_MAX_LIMIT = 500
OS_SEARCH_FETCH_ALL_MAX_LIMIT = 100_000
OS_SEARCH_MIN_LIKE_CHARS = OS_TEXT_SEARCH_MIN_CHARS
OS_SEARCH_DEFAULT_LIMIT = 20
OS_SEARCH_MAX_MULTI_FILTER_ITEMS = 20

FINISHED_SITUACOES = ("Entregue", "Cancelada", "Cancelado")
_FINISHED_SQL_LIST = ", ".join(f"'{s}'" for s in FINISHED_SITUACOES)

OS_SEARCH_SORT_COLUMNS_BASE = {
    "nr_os": "p.NroProtocolo",
    "ano": "p.AnoProtocolo",
    "produto": "d.TipoPublicacaoLink",
    "titulo": "d.Titulo",
    "solicitante": "p.NomeUsuario",
    "prioridade": "p.EntregPrazoLink",
    "data_entrega": "p.EntregData",
}


def _allow_live_andamento_fallback() -> bool:
    return os.environ.get("OS_SEARCH_ALLOW_LIVE_FALLBACK", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _prefer_materialized_andamento() -> bool:
    """Legado/performance: força join na tabela materializada quando populada."""
    return os.environ.get("OS_SEARCH_PREFER_MATERIALIZED", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _allow_slow_text_fallback() -> bool:
    return os.environ.get("OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _sort_columns(situacao_col: str, setor_col: str) -> dict:
    return {
        **OS_SEARCH_SORT_COLUMNS_BASE,
        "situacao": situacao_col,
        "setor": setor_col,
    }


def _os_search_priority_rank_sql(*, alias: str = "p") -> str:
    """Prometido (1) → Solicitado (2) → demais (3). TRIM tolera variações de texto."""
    prazo = f"TRIM(COALESCE({alias}.EntregPrazoLink, ''))"
    return f"""
        CASE
            WHEN {prazo} LIKE 'Prometido p/%%' OR {prazo} = 'Prometido p/' THEN 1
            WHEN {prazo} LIKE 'Solicitado p/%%' OR {prazo} = 'Solicitado p/' THEN 2
            ELSE 3
        END"""


def _os_search_default_date_sql(*, alias: str = "p") -> str:
    return f"COALESCE({alias}.EntregData, {alias}.DataEntrada)"


def _os_search_stable_tiebreak_sql(*, alias: str = "p") -> str:
    return f"{alias}.AnoProtocolo DESC, {alias}.NroProtocolo DESC"


def _os_search_default_order_sql() -> str:
    return f"""
        {_os_search_priority_rank_sql()} ASC,
        {_os_search_default_date_sql()} ASC,
        {_os_search_stable_tiebreak_sql()}"""


OS_SEARCH_DEFAULT_ORDER = _os_search_default_order_sql()
OS_SEARCH_PRIO_ORDER_ASC = _os_search_default_order_sql()
OS_SEARCH_PRIO_ORDER_DESC = f"""
        {_os_search_priority_rank_sql()} DESC,
        {_os_search_default_date_sql()} DESC,
        {_os_search_stable_tiebreak_sql()}"""


def _live_operacional_scalar(field: str) -> str:
    """
    Subquery escalar — mesma regra de fetch_operacional_rows_batch / enrich.
    Fonte: tabela canônica, UltimoStatus=1, espelhos Sub OS excluídos.
    """
    tbl = get_andamento_table()
    mirror = MIRROR_EXCLUDE_CLAUSE.replace("a.CodStatus", "a_live.CodStatus")
    value_expr = (
        f"TRIM(a_live.{field})"
        if field in ("SituacaoLink", "SetorLink")
        else f"a_live.{field}"
    )
    return f"""(
        SELECT {value_expr}
        FROM {tbl} AS a_live
        WHERE a_live.NroProtocoloLink = p.NroProtocolo
          AND a_live.AnoProtocoloLink = p.AnoProtocolo
          AND a_live.UltimoStatus = 1
          AND {mirror}
        ORDER BY a_live.`Data` DESC, a_live.CodStatus DESC
        LIMIT 1
    )"""


def _materialized_join_sql() -> str:
    return f"""
LEFT JOIN {MATERIALIZED_TABLE} AS a_op
    ON a_op.nro_protocolo = p.NroProtocolo
   AND a_op.ano_protocolo = p.AnoProtocolo
"""


def _live_andamento_join_sql() -> str:
    """Join no andamento canônico (UltimoStatus=1, espelhos Sub OS excluídos)."""
    tbl = get_andamento_table()
    mirror_exclude = MIRROR_EXCLUDE_CLAUSE.replace("a.CodStatus", "a2.CodStatus")
    return f"""
LEFT JOIN (
    SELECT
        NroProtocoloLink,
        AnoProtocoloLink,
        CodStatus,
        SituacaoLink,
        SetorLink,
        `Data`,
        `Observaçao`
    FROM (
        SELECT
            a2.NroProtocoloLink,
            a2.AnoProtocoloLink,
            a2.CodStatus,
            a2.SituacaoLink,
            a2.SetorLink,
            a2.`Data`,
            a2.`Observaçao`,
            ROW_NUMBER() OVER (
                PARTITION BY a2.NroProtocoloLink, a2.AnoProtocoloLink
                ORDER BY a2.`Data` DESC, a2.CodStatus DESC
            ) AS _rn
        FROM {tbl} AS a2
        WHERE a2.UltimoStatus = 1
          AND {mirror_exclude.strip()}
    ) AS ranked
    WHERE ranked._rn = 1
) AS a_op
    ON a_op.NroProtocoloLink = p.NroProtocolo AND a_op.AnoProtocoloLink = p.AnoProtocolo
"""


def _resolve_filter_operacional_columns(
    *,
    uses_materialized: bool,
    situacao_col: str,
    setor_col: str,
    live_situacao_col: str,
    live_setor_col: str,
) -> Tuple[str, str, bool, bool]:
    """
    Filtros de setor/situação usam o live UltimoStatus=1 (mesma fonte do enrich).
    Join/materializada continuam só para SELECT/ordem. Sem gap fallback: o
    escalar live já é a fonte de inclusão — senão a lista omite OSs que o
    lookup por Nr OS ainda encontra.
    """
    del uses_materialized, situacao_col, setor_col
    return live_situacao_col, live_setor_col, False, False


def _resolve_andamento_join() -> Tuple[str, str, str, bool]:
    """
    Retorna (join_sql, situacao_col, setor_col, uses_materialized).
    Primário: tabAndamento live (alinhado ao painel PCP). Materializada só com opt-in.
    """
    if _prefer_materialized_andamento() and materialized_table_populated():
        return _materialized_join_sql(), "a_op.situacao", "a_op.setor", True

    if not materialized_table_populated():
        logger.warning(
            "%s vazia ou inacessível — busca usa tabAndamento live. "
            "Execute scripts/rebuild_os_ultimo_andamento.py para index auxiliar.",
            MATERIALIZED_TABLE,
        )

    if _allow_live_andamento_fallback():
        logger.info(
            "OS_SEARCH_ALLOW_LIVE_FALLBACK ativo — tabAndamento live (ROW_NUMBER)"
        )
    return _live_andamento_join_sql(), "a_op.SituacaoLink", "a_op.SetorLink", False


def _active_situacao_predicate(situacao_col: str) -> str:
    return (
        f"({situacao_col} IS NULL OR {situacao_col} NOT IN ({_FINISHED_SQL_LIST}))"
    )


def _clean_multi_filter_values(values: Optional[List[str]]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for raw in values or []:
        item = (raw or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _clean_anos_filter_values(values: Optional[List[int]]) -> List[int]:
    seen: set[int] = set()
    result: List[int] = []
    for raw in values or []:
        try:
            year = int(raw)
        except (TypeError, ValueError):
            continue
        if year in seen:
            continue
        seen.add(year)
        result.append(year)
    return result


OS_SEARCH_PROCESSO_MIN_DIGITS = 2
OS_SEARCH_PROCESSO_FULL_DIGITS = 12  # máscara 00.000.000/0000


def _processo_digits(value: Optional[str]) -> str:
    if not value:
        return ""
    return "".join(ch for ch in str(value) if ch.isdigit())


def _processo_filter_term(value: Optional[str]) -> Optional[str]:
    """
    Termo limpo (só dígitos) para p.ProcessoSolicit.
    Máscara visual fica só no cliente; no banco o valor é sem formatação.
    Exige ≥2 dígitos.
    """
    digits = _processo_digits(value)[:OS_SEARCH_PROCESSO_FULL_DIGITS]
    if len(digits) < OS_SEARCH_PROCESSO_MIN_DIGITS:
        return None
    return digits


def _escape_sql_like_prefix(term: str) -> str:
    return (
        term.replace("\\", "\\\\")
        .replace("%", "\\%")
        .replace("_", "\\_")
    )


def _should_use_active_materialized_driver(
    *,
    uses_materialized: bool,
    include_finished: bool,
    has_nr_os: bool,
    clean_situacao: List[str],
    clean_setor: List[str],
    produto_term: Optional[str],
    titulo_term: Optional[str],
    solicitante_term: Optional[str],
    selected_produtos: List[str],
    selected_solicitantes: List[str],
    sort_key: str,
    pcp_order: bool,
) -> bool:
    """
    Driver invertido (FROM materializada INNER JOIN protocolos) desativado:
    excluía OSs com gap na materializada. Busca usa sempre LEFT JOIN + fallback pontual.
    """
    return False


def _build_from_clause(
    *,
    use_active_driver: bool,
    andamento_join: str,
) -> str:
    if use_active_driver:
        return f"""
    FROM {MATERIALIZED_TABLE} AS a_op
    INNER JOIN tabProtocolos AS p
        ON p.NroProtocolo = a_op.nro_protocolo
       AND p.AnoProtocolo = a_op.ano_protocolo
    """
    return f"""
    FROM tabProtocolos AS p
    {andamento_join}
    """


def _details_filter_exists_sql(
    *,
    produto_term: Optional[str],
    titulo_term: Optional[str],
    params: dict,
) -> str:
    """Alias legado — LIKE lento (testes / fallback explícito)."""
    return _details_filter_like_sql(
        produto_term=produto_term,
        titulo_term=titulo_term,
        params=params,
    )


def _details_filter_like_sql(
    *,
    produto_term: Optional[str],
    titulo_term: Optional[str],
    params: dict,
) -> str:
    """Fallback lento — LIKE '%termo%' (somente com OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK)."""
    parts: List[str] = []
    if produto_term:
        parts.append("d_f.TipoPublicacaoLink LIKE %(produto_like)s")
        params["produto_like"] = f"%{produto_term}%"
    if titulo_term:
        parts.append("d_f.Titulo LIKE %(titulo_like)s")
        params["titulo_like"] = f"%{titulo_term}%"
    if not parts:
        return ""
    inner = " AND ".join(parts)
    return f"""
      AND EXISTS (
          SELECT 1 FROM tabDetalhesServico AS d_f
          WHERE d_f.NroProtocoloLinkDet = p.NroProtocolo
            AND d_f.AnoProtocoloLinkDet = p.AnoProtocolo
            AND ({inner})
      )
    """


def _details_filter_fulltext_sql(
    *,
    produto_term: Optional[str],
    titulo_term: Optional[str],
    params: dict,
) -> str:
    match_parts: List[str] = []
    if produto_term:
        ft = build_fulltext_boolean_query(produto_term)
        if ft:
            params["ft_produto"] = ft
            match_parts.append(
                "MATCH(d_f.TipoPublicacaoLink) AGAINST (%(ft_produto)s IN BOOLEAN MODE)"
            )
    if titulo_term:
        ft = build_fulltext_boolean_query(titulo_term)
        if ft:
            params["ft_titulo"] = ft
            match_parts.append(
                "MATCH(d_f.Titulo) AGAINST (%(ft_titulo)s IN BOOLEAN MODE)"
            )
    if not match_parts:
        return ""
    inner = " AND ".join(match_parts)
    return f"""
      AND EXISTS (
          SELECT 1 FROM tabDetalhesServico AS d_f
          WHERE d_f.NroProtocoloLinkDet = p.NroProtocolo
            AND d_f.AnoProtocoloLinkDet = p.AnoProtocolo
            AND ({inner})
      )
    """


def _details_text_filter_sql(
    *,
    produto_term: Optional[str],
    titulo_term: Optional[str],
    params: dict,
    use_fulltext: bool,
) -> tuple[str, str]:
    """
    Retorna (sql_fragment, mode) onde mode é fulltext|like|skipped.
    """
    if not produto_term and not titulo_term:
        return "", "none"
    if use_fulltext:
        sql = _details_filter_fulltext_sql(
            produto_term=produto_term,
            titulo_term=titulo_term,
            params=params,
        )
        if sql:
            return sql, "fulltext"
    if _allow_slow_text_fallback():
        return (
            _details_filter_like_sql(
                produto_term=produto_term,
                titulo_term=titulo_term,
                params=params,
            ),
            "like",
        )
    logger.warning(
        "Filtro produto/título ignorado — índices FULLTEXT ausentes e "
        "OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK desativado"
    )
    return "", "skipped"


def _solicitante_filter_sql(
    *,
    solicitante_term: str,
    params: dict,
    use_fulltext: bool,
) -> tuple[str, str]:
    if use_fulltext:
        ft = build_fulltext_boolean_query(solicitante_term)
        if ft:
            params["ft_solicitante"] = ft
            return (
                " AND MATCH(p.NomeUsuario) AGAINST (%(ft_solicitante)s IN BOOLEAN MODE)",
                "fulltext",
            )
    params["solicitante_prefix"] = build_solicitante_prefix_pattern(solicitante_term)
    return " AND p.NomeUsuario LIKE %(solicitante_prefix)s ESCAPE '\\\\'", "prefix"


def _details_display_join_sql(*, need_join: bool) -> str:
    if not need_join:
        return ""
    return """
LEFT JOIN tabDetalhesServico AS d
    ON d.NroProtocoloLinkDet = p.NroProtocolo
   AND d.AnoProtocoloLinkDet = p.AnoProtocolo
"""


def _sub_os_count_scalar_sql() -> str:
    """Sub OS listáveis — alinhado a count_sub_os/list_sub_os (andamento manual)."""
    return sub_os_listable_count_scalar_sql()


def _clamp_os_search_pagination(
    page: int, limit: int, *, max_limit: int = OS_SEARCH_MAX_LIMIT
) -> tuple[int, int]:
    return max(1, page), min(max(1, limit), max_limit)


def _resolve_os_search_pagination(
    page: int, limit: int, *, fetch_all: bool
) -> tuple[int, int, int]:
    """page, limit, max_limit. fetch_all ignora page/limit do cliente."""
    if fetch_all:
        max_limit = OS_SEARCH_FETCH_ALL_MAX_LIMIT
        page, limit = _clamp_os_search_pagination(
            1, OS_SEARCH_FETCH_ALL_MAX_LIMIT, max_limit=max_limit
        )
        return page, limit, max_limit
    max_limit = OS_SEARCH_MAX_LIMIT
    page, limit = _clamp_os_search_pagination(page, limit, max_limit=max_limit)
    return page, limit, max_limit


def _os_search_like_term(
    value: Optional[str],
    *,
    has_nr_os: bool,
    has_ano: bool,
) -> Optional[str]:
    return parse_text_search_term(value, has_nr_os=has_nr_os, has_ano=has_ano)


def _dedupe_os_search_rows(rows: list) -> list:
    seen: set[tuple] = set()
    unique = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        kind = row.get("kind") or row.get("row_kind") or "main_os"
        sub_id = row.get("sub_os_id")
        key = (row.get("nr_os"), row.get("ano"), kind, sub_id)
        if key in seen:
            continue
        seen.add(key)
        unique.append(row)
    return unique


def _is_sub_os_search_row(row: Dict[str, Any]) -> bool:
    return bool(row.get("is_sub_os") or row.get("kind") == "sub_os")


def _sub_matches_andamento_filters(
    sub: Dict[str, Any],
    *,
    setores: Optional[List[str]],
    situacoes: Optional[List[str]],
) -> bool:
    if setores and str(sub.get("setor") or "").strip() not in setores:
        return False
    if situacoes and str(sub.get("situacao") or "").strip() not in situacoes:
        return False
    return True


def _andamento_key(sub: Dict[str, Any]) -> Tuple[str, str]:
    return (
        str(sub.get("situacao") or "").strip(),
        str(sub.get("setor") or "").strip(),
    )


def _should_show_component_rows(subs: List[Dict[str, Any]]) -> bool:
    """Rótulo [Componente] só com 2+ Sub OSs e andamento atual diferente entre elas."""
    if len(subs) < 2:
        return False
    keys = {_andamento_key(sub) for sub in subs}
    if any(not situacao or not setor for situacao, setor in keys):
        return False
    return len(keys) > 1


def _pick_sub_representative(subs: List[Dict[str, Any]]) -> Dict[str, Any]:
    return max(
        subs,
        key=lambda s: str(s.get("last_update") or s.get("data_entrega") or ""),
    )


def _merge_parent_with_sub_os(
    parent: Dict[str, Any],
    child: Dict[str, Any],
) -> Dict[str, Any]:
    return {
        **parent,
        **child,
        "nr_os": parent.get("nr_os"),
        "ano": parent.get("ano"),
        "titulo": parent.get("titulo"),
        "solicitante": parent.get("solicitante"),
        "prioridade": parent.get("prioridade"),
        "produto": parent.get("produto"),
        "formato": parent.get("formato"),
        "entreg_periodo": parent.get("entreg_periodo"),
        "data_entrada": parent.get("data_entrada"),
        "kind": "sub_os",
        "is_sub_os": True,
        "has_sub_os": False,
        "sub_os_count": 0,
        "matched_via_sub_os": False,
    }


def _collapse_split_to_main_os(
    parent: Dict[str, Any],
    representative: Dict[str, Any],
) -> Dict[str, Any]:
    collapsed = {
        **parent,
        "situacao": representative.get("situacao"),
        "setor": representative.get("setor"),
        "last_update": representative.get("last_update"),
        "observacao": representative.get("observacao"),
        "kind": "main_os",
        "is_sub_os": False,
        "has_sub_os": False,
        "sub_os_count": 0,
        "matched_via_sub_os": False,
    }
    for key in (
        "sub_os_id",
        "display_label",
        "componente_id",
        "componente_nome",
        "parent_nr_os",
        "parent_ano",
    ):
        collapsed.pop(key, None)
    return collapsed


def _expand_split_os_search_rows(
    rows: List[Dict[str, Any]],
    *,
    setores: Optional[List[str]] = None,
    situacoes: Optional[List[str]] = None,
    include_finished: bool = True,
) -> List[Dict[str, Any]]:
    """Substitui OS dividida por linhas de Sub OS; colapsa se não há andamentos divergentes."""
    split_pairs: List[Tuple[int, int]] = []
    seen_pairs: set[Tuple[int, int]] = set()
    for row in rows or []:
        if _is_sub_os_search_row(row):
            continue
        if not row.get("has_sub_os") and not (row.get("sub_os_count") or 0):
            continue
        nro = row.get("nr_os")
        ano = row.get("ano")
        if nro is None or ano is None:
            continue
        pair = (int(nro), int(ano))
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        split_pairs.append(pair)
    if not split_pairs:
        return rows

    sub_rows = fetch_home_sub_os_rows_for_pairs(
        split_pairs,
        setores=None,
        situacoes=None,
        include_finished=include_finished,
    )
    by_parent: Dict[Tuple[int, int], List[Dict[str, Any]]] = {}
    for sub in sub_rows:
        key = (
            int(sub.get("parent_nr_os") or sub.get("nr_os")),
            int(sub.get("parent_ano") or sub.get("ano")),
        )
        by_parent.setdefault(key, []).append(sub)

    expanded: List[Dict[str, Any]] = []
    for row in rows or []:
        if _is_sub_os_search_row(row):
            expanded.append(row)
            continue
        nro = row.get("nr_os")
        ano = row.get("ano")
        if nro is None or ano is None:
            expanded.append(row)
            continue
        key = (int(nro), int(ano))
        if key not in seen_pairs:
            expanded.append({**row, "kind": row.get("kind") or "main_os"})
            continue
        children = by_parent.get(key, [])
        if not _should_show_component_rows(children):
            matching = [
                child
                for child in children
                if _sub_matches_andamento_filters(
                    child, setores=setores, situacoes=situacoes
                )
            ]
            if not matching:
                continue
            expanded.append(
                _collapse_split_to_main_os(row, _pick_sub_representative(matching))
            )
            continue
        for child in children:
            if not _sub_matches_andamento_filters(
                child, setores=setores, situacoes=situacoes
            ):
                continue
            expanded.append(_merge_parent_with_sub_os(row, child))
    return expanded


def _build_os_search_order_clause(
    sort_by: Optional[str],
    sort_dir: Optional[str],
    order_prefix: str,
    *,
    situacao_col: str,
    setor_col: str,
) -> str:
    sort_map = _sort_columns(situacao_col, setor_col)
    key = (sort_by or "").strip()
    col = sort_map.get(key)
    if not col:
        return f"ORDER BY {order_prefix}{OS_SEARCH_DEFAULT_ORDER}"

    direction = "DESC" if (sort_dir or "").strip().lower() == "desc" else "ASC"
    if key == "prioridade":
        body = OS_SEARCH_PRIO_ORDER_DESC if direction == "DESC" else OS_SEARCH_PRIO_ORDER_ASC
        return f"ORDER BY {order_prefix}{body}"

    if key == "ano":
        return (
            f"ORDER BY {order_prefix}p.AnoProtocolo {direction}, "
            f"p.NroProtocolo {direction}"
        )
    if key == "nr_os":
        return (
            f"ORDER BY {order_prefix}p.NroProtocolo {direction}, "
            f"p.AnoProtocolo {direction}"
        )

    return (
        f"ORDER BY {order_prefix}{col} {direction}, "
        f"{_os_search_stable_tiebreak_sql()}"
    )


def _enrich_rows_with_details(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return rows
    pairs = [(int(r["nr_os"]), int(r["ano"])) for r in rows if r.get("nr_os") is not None]
    if not pairs:
        return rows
    placeholders = ", ".join(["(%s, %s)"] * len(pairs))
    flat: List[Any] = [x for pair in pairs for x in pair]
    detail_rows = db.execute_query(
        f"""
        SELECT
            d.NroProtocoloLinkDet AS nr_os,
            d.AnoProtocoloLinkDet AS ano,
            d.Titulo AS titulo,
            d.TipoPublicacaoLink AS produto,
            d.FormatoLink AS formato
        FROM tabDetalhesServico AS d
        WHERE (d.NroProtocoloLinkDet, d.AnoProtocoloLinkDet) IN ({placeholders})
        """,
        tuple(flat),
    )
    by_key: Dict[tuple, Dict[str, Any]] = {}
    for dr in detail_rows or []:
        key = (dr.get("nr_os"), dr.get("ano"))
        if key not in by_key:
            by_key[key] = dr
    for row in rows:
        key = (row.get("nr_os"), row.get("ano"))
        det = by_key.get(key)
        if not det:
            continue
        for field in ("titulo", "produto", "formato"):
            if not row.get(field) and det.get(field):
                row[field] = det.get(field)
    return rows


def _select_operacional_fields(*, uses_materialized: bool) -> str:
    if uses_materialized:
        return """
        a_op.situacao AS situacao,
        a_op.setor AS setor,
        a_op.`data` AS last_update,
        a_op.observacao AS observacao"""
    return """
        a_op.SituacaoLink AS situacao,
        a_op.SetorLink AS setor,
        a_op.`Data` AS last_update,
        a_op.`Observaçao` AS observacao"""


def _null_operacional_fields_sql() -> str:
    """Campos operacionais adiados — hidratados por _enrich_operacional_from_live."""
    return """
        NULL AS situacao,
        NULL AS setor,
        NULL AS last_update,
        NULL AS observacao"""


def _is_finished_situacao(situacao: Any) -> bool:
    if situacao is None:
        return False
    return str(situacao).strip() in FINISHED_SITUACOES


def _filter_out_finished_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [r for r in rows if not _is_finished_situacao(r.get("situacao"))]


def _main_matches_situacao_setor(
    row: Dict[str, Any],
    *,
    situacoes: List[str],
    setores: List[str],
) -> bool:
    if situacoes and str(row.get("situacao") or "").strip() not in situacoes:
        return False
    if setores and str(row.get("setor") or "").strip() not in setores:
        return False
    return True


def _filter_rows_by_displayed_andamento(
    rows: List[Dict[str, Any]],
    *,
    situacoes: Optional[List[str]] = None,
    setores: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Mantém linhas cujo situacao/setor live (coluna visível) casa com o filtro."""
    clean_situacao = [s.strip() for s in (situacoes or []) if s and s.strip()]
    clean_setor = [s.strip() for s in (setores or []) if s and s.strip()]
    if not clean_situacao and not clean_setor:
        return rows
    return [
        row
        for row in rows
        if _main_matches_situacao_setor(
            row, situacoes=clean_situacao, setores=clean_setor
        )
    ]


def _filter_exact_lookup_choice_filters(
    rows: List[Dict[str, Any]],
    *,
    situacao: Optional[List[str]] = None,
    setor: Optional[List[str]] = None,
    prioridade: Optional[List[str]] = None,
    include_os: bool = True,
    include_sp: bool = True,
) -> List[Dict[str, Any]]:
    """
    Aplica filtros de escolha após enrich no fast path Nr OS.
    Mantém SQL indexável; opera no conjunto pequeno já carregado.
    Situação/setor usam a coluna visível da OS principal (sem inclusão via Sub OS).
    """
    if not rows:
        return rows

    clean_prio = [s.strip() for s in (prioridade or []) if s and s.strip()]

    filtered: List[Dict[str, Any]] = []
    for row in rows:
        nro = row.get("nr_os")
        if nro is not None:
            nro_int = int(nro)
            if not include_os and nro_int < 5000:
                continue
            if not include_sp and nro_int >= 5000:
                continue
        if clean_prio:
            prio = str(row.get("prioridade") or "").strip()
            if prio not in clean_prio:
                continue
        filtered.append(row)

    return _filter_rows_by_displayed_andamento(
        filtered,
        situacoes=situacao,
        setores=setor,
    )


def _fulltext_match_parts(
    *,
    produto_term: Optional[str],
    titulo_term: Optional[str],
    params: dict,
    alias: str = "d_ft",
) -> List[str]:
    match_parts: List[str] = []
    if produto_term:
        ft = build_fulltext_boolean_query(produto_term)
        if ft:
            params["ft_produto"] = ft
            match_parts.append(
                f"MATCH({alias}.TipoPublicacaoLink) AGAINST (%(ft_produto)s IN BOOLEAN MODE)"
            )
    if titulo_term:
        ft = build_fulltext_boolean_query(titulo_term)
        if ft:
            params["ft_titulo"] = ft
            match_parts.append(
                f"MATCH({alias}.Titulo) AGAINST (%(ft_titulo)s IN BOOLEAN MODE)"
            )
    return match_parts


def _fulltext_details_driver_from_sql(
    *,
    produto_term: Optional[str],
    titulo_term: Optional[str],
    params: dict,
    andamento_join: str,
) -> Optional[str]:
    """
    Driver invertido: FULLTEXT em detalhes → JOIN protocolos.
    Evita materializar andamento global quando o predicado textual é seletivo.
    """
    match_parts = _fulltext_match_parts(
        produto_term=produto_term,
        titulo_term=titulo_term,
        params=params,
        alias="d_ft",
    )
    if not match_parts:
        return None
    inner = " AND ".join(match_parts)
    return f"""
    FROM (
        SELECT DISTINCT
            d_ft.NroProtocoloLinkDet AS nro,
            d_ft.AnoProtocoloLinkDet AS ano
        FROM tabDetalhesServico AS d_ft
        WHERE ({inner})
    ) AS d_f
    INNER JOIN tabProtocolos AS p
        ON p.NroProtocolo = d_f.nro
       AND p.AnoProtocolo = d_f.ano
    {andamento_join}
    """


def _enrich_operacional_from_live(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sobrescreve situação/setor com tabAndamento live — mesma fonte do painel setor."""
    if not rows:
        return rows
    from services.os_ultimo_andamento_service import fetch_operacional_rows_batch

    pairs: List[Tuple[int, int]] = []
    for row in rows:
        nro, ano = row.get("nr_os"), row.get("ano")
        if nro is not None and ano is not None:
            pairs.append((int(nro), int(ano)))

    live_map = fetch_operacional_rows_batch(pairs)
    for row in rows:
        nro, ano = row.get("nr_os"), row.get("ano")
        if nro is None or ano is None:
            continue
        live = live_map.get((int(nro), int(ano)))
        if not live:
            continue
        row["situacao"] = live.get("situacao")
        row["setor"] = live.get("setor")
        row["last_update"] = live.get("data")
        row["observacao"] = live.get("observacao")
    return rows


def _enrich_operacional_gaps(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Retrocompat — delega para enrich live."""
    return _enrich_operacional_from_live(rows)


def execute_os_search(
    *,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    ano_mode: Optional[str] = None,
    anos: Optional[List[int]] = None,
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = None,
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = None,
    situacao: Optional[List[str]] = None,
    setor: Optional[List[str]] = None,
    prioridade: Optional[List[str]] = None,
    processo: Optional[str] = None,
    categorias: Optional[List[str]] = None,
    maquinas: Optional[List[str]] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
    page: int = 1,
    limit: int = OS_SEARCH_DEFAULT_LIMIT,
    pcp_order: bool = False,
    simple_pagination: bool = True,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    include_total: bool = False,
    exact_os_lookup: bool = False,
    painel: bool = False,
    fetch_all: bool = False,
) -> Dict[str, Any]:
    page, limit, pagination_max = _resolve_os_search_pagination(
        page, limit, fetch_all=fetch_all
    )
    has_nr_os = nr_os is not None
    clean_anos = _clean_anos_filter_values(anos)
    has_ano = bool(clean_anos) or ano is not None
    skip_choice_filters = bool(exact_os_lookup and has_nr_os)
    # Lookup por Nr OS: evita COUNT pesado e subquery live no filtro de situação.
    if skip_choice_filters:
        include_total = False

    clean_produtos = _clean_multi_filter_values(produtos)
    clean_solicitantes = _clean_multi_filter_values(solicitantes)
    clean_categorias = _clean_multi_filter_values(categorias)
    clean_maquinas = _clean_multi_filter_values(maquinas)
    if len(clean_anos) > OS_SEARCH_MAX_MULTI_FILTER_ITEMS:
        raise ValueError(
            f"Máximo de {OS_SEARCH_MAX_MULTI_FILTER_ITEMS} anos por busca"
        )
    if len(clean_produtos) > OS_SEARCH_MAX_MULTI_FILTER_ITEMS:
        raise ValueError(
            f"Máximo de {OS_SEARCH_MAX_MULTI_FILTER_ITEMS} produtos por busca"
        )
    if len(clean_solicitantes) > OS_SEARCH_MAX_MULTI_FILTER_ITEMS:
        raise ValueError(
            f"Máximo de {OS_SEARCH_MAX_MULTI_FILTER_ITEMS} solicitantes por busca"
        )
    if len(clean_categorias) > OS_SEARCH_MAX_MULTI_FILTER_ITEMS:
        raise ValueError(
            f"Máximo de {OS_SEARCH_MAX_MULTI_FILTER_ITEMS} categorias por busca"
        )
    if len(clean_maquinas) > OS_SEARCH_MAX_MULTI_FILTER_ITEMS:
        raise ValueError(
            f"Máximo de {OS_SEARCH_MAX_MULTI_FILTER_ITEMS} máquinas por busca"
        )

    produto_term = (
        None
        if clean_produtos
        else _os_search_like_term(produto, has_nr_os=has_nr_os, has_ano=has_ano)
    )
    titulo_term = _os_search_like_term(titulo, has_nr_os=has_nr_os, has_ano=has_ano)
    solicitante_term = (
        None
        if clean_solicitantes
        else _os_search_like_term(
            solicitante, has_nr_os=has_nr_os, has_ano=has_ano
        )
    )
    processo_term = _processo_filter_term(processo)
    sort_key = (sort_by or "").strip()

    clean_situacao = [s.strip() for s in (situacao or []) if s and s.strip()]
    clean_setor = [s.strip() for s in (setor or []) if s and s.strip()]

    use_fulltext = fulltext_text_search_indexes_ready()
    mat_populated = materialized_table_populated()

    # Preview do modo textual (params preenchidos depois no fluxo real).
    preview_params: dict = {}
    _, details_mode_preview = _details_text_filter_sql(
        produto_term=produto_term,
        titulo_term=titulo_term,
        params=preview_params,
        use_fulltext=use_fulltext,
    )

    # Fast path Nr OS: sem JOIN andamento global (lookup seletivo).
    use_exact_fast_path = skip_choice_filters

    # Driver FULLTEXT invertido: só quando não precisa de andamento no SQL de filtro/sort.
    can_use_fulltext_driver = (
        not use_exact_fast_path
        and details_mode_preview == "fulltext"
        and bool(titulo_term or produto_term)
        and not pcp_order
        and sort_key not in ("situacao", "setor")
        and not clean_situacao
        and not clean_setor
    )
    use_mat_for_finished = (
        can_use_fulltext_driver
        and not include_finished
        and mat_populated
    )
    # Sem materializada: over-fetch só na 1ª página; demais páginas caem no path clássico.
    use_python_finished_filter = (
        can_use_fulltext_driver
        and not include_finished
        and not use_mat_for_finished
        and page == 1
    )
    use_fulltext_driver = can_use_fulltext_driver and (
        include_finished or use_mat_for_finished or use_python_finished_filter
    )

    if use_exact_fast_path:
        andamento_join = ""
        situacao_col = "NULL"
        setor_col = "NULL"
        uses_materialized = False
        filter_situacao_col = "NULL"
        filter_setor_col = "NULL"
        use_mat_gap_fallback = False
        use_tabandamento_gap_fallback = False
    elif use_fulltext_driver:
        if use_mat_for_finished:
            andamento_join = _materialized_join_sql()
            situacao_col = "a_op.situacao"
            setor_col = "a_op.setor"
            uses_materialized = True
        else:
            andamento_join = ""
            situacao_col = "NULL"
            setor_col = "NULL"
            uses_materialized = False
        filter_situacao_col = situacao_col
        filter_setor_col = setor_col
        use_mat_gap_fallback = False
        use_tabandamento_gap_fallback = False
    else:
        andamento_join, situacao_col, setor_col, uses_materialized = _resolve_andamento_join()
        live_situacao_col = _live_operacional_scalar("SituacaoLink")
        live_setor_col = _live_operacional_scalar("SetorLink")
        (
            filter_situacao_col,
            filter_setor_col,
            use_mat_gap_fallback,
            use_tabandamento_gap_fallback,
        ) = _resolve_filter_operacional_columns(
            uses_materialized=uses_materialized,
            situacao_col=situacao_col,
            setor_col=setor_col,
            live_situacao_col=live_situacao_col,
            live_setor_col=live_setor_col,
        )

    use_active_driver = _should_use_active_materialized_driver(
        uses_materialized=uses_materialized,
        include_finished=include_finished,
        has_nr_os=has_nr_os,
        clean_situacao=clean_situacao,
        clean_setor=clean_setor,
        produto_term=produto_term,
        titulo_term=titulo_term,
        solicitante_term=solicitante_term,
        selected_produtos=clean_produtos,
        selected_solicitantes=clean_solicitantes,
        sort_key=sort_key,
        pcp_order=pcp_order,
    )

    filters = " WHERE 1=1"
    params: dict = {}

    apply_finished_in_sql = not include_finished and not use_exact_fast_path and (
        not use_fulltext_driver or use_mat_for_finished
    )
    if apply_finished_in_sql:
        filters += f" AND {_active_situacao_predicate(filter_situacao_col)}"

    if not skip_choice_filters:
        if not include_os:
            filters += " AND p.NroProtocolo >= 5000"
        if not include_sp:
            filters += " AND p.NroProtocolo < 5000"

    if nr_os:
        filters += " AND p.NroProtocolo = %(nr_os)s"
        params["nr_os"] = nr_os
    if clean_anos:
        ano_placeholders = ", ".join(
            f"%(ano_sel_{i})s" for i in range(len(clean_anos))
        )
        filters += f" AND p.AnoProtocolo IN ({ano_placeholders})"
        for i, val in enumerate(clean_anos):
            params[f"ano_sel_{i}"] = val
    elif ano:
        mode = (ano_mode or "specific").strip().lower()
        if mode == "from":
            filters += " AND p.AnoProtocolo >= %(ano)s"
        else:
            filters += " AND p.AnoProtocolo = %(ano)s"
        params["ano"] = ano

    if processo_term:
        if len(processo_term) >= OS_SEARCH_PROCESSO_FULL_DIGITS:
            filters += " AND p.ProcessoSolicit = %(processo_exact)s"
            params["processo_exact"] = processo_term
        else:
            filters += (
                " AND p.ProcessoSolicit LIKE %(processo_prefix)s ESCAPE '\\\\'"
            )
            params["processo_prefix"] = _escape_sql_like_prefix(processo_term) + "%"

    if clean_produtos:
        prod_placeholders = ", ".join(
            f"%(prod_sel_{i})s" for i in range(len(clean_produtos))
        )
        filters += f"""
         AND EXISTS (
            SELECT 1 FROM tabDetalhesServico AS d_sel
            WHERE d_sel.NroProtocoloLinkDet = p.NroProtocolo
              AND d_sel.AnoProtocoloLinkDet = p.AnoProtocolo
              AND d_sel.TipoPublicacaoLink IN ({prod_placeholders})
         )"""
        for i, val in enumerate(clean_produtos):
            params[f"prod_sel_{i}"] = val

    text_search_modes: List[str] = []

    if use_fulltext_driver:
        details_mode = "fulltext"
        text_search_modes.append(f"detalhes:{details_mode}")
        # MATCH entra no driver FROM; não duplicar EXISTS.
    else:
        details_sql, details_mode = _details_text_filter_sql(
            produto_term=produto_term,
            titulo_term=titulo_term,
            params=params,
            use_fulltext=use_fulltext,
        )
        filters += details_sql
        if details_mode not in ("none",):
            text_search_modes.append(f"detalhes:{details_mode}")

    if clean_solicitantes:
        sol_placeholders = ", ".join(
            f"%(sol_sel_{i})s" for i in range(len(clean_solicitantes))
        )
        filters += f" AND p.NomeUsuario IN ({sol_placeholders})"
        for i, val in enumerate(clean_solicitantes):
            params[f"sol_sel_{i}"] = val
    elif solicitante_term:
        sol_sql, sol_mode = _solicitante_filter_sql(
            solicitante_term=solicitante_term,
            params=params,
            use_fulltext=use_fulltext,
        )
        filters += sol_sql
        text_search_modes.append(f"solicitante:{sol_mode}")

    if not skip_choice_filters:
        if clean_categorias:
            cat_placeholders = ", ".join(
                f"%(cat_sel_{i})s" for i in range(len(clean_categorias))
            )
            filters += f" AND p.CategoriaLink IN ({cat_placeholders})"
            for i, val in enumerate(clean_categorias):
                params[f"cat_sel_{i}"] = val

        if clean_maquinas:
            maq_placeholders = ", ".join(
                f"%(maq_sel_{i})s" for i in range(len(clean_maquinas))
            )
            filters += f"""
             AND EXISTS (
                SELECT 1 FROM tabDetalhesServico AS d_maq
                WHERE d_maq.NroProtocoloLinkDet = p.NroProtocolo
                  AND d_maq.AnoProtocoloLinkDet = p.AnoProtocolo
                  AND d_maq.MaquinaLink IN ({maq_placeholders})
             )"""
            for i, val in enumerate(clean_maquinas):
                params[f"maq_sel_{i}"] = val

        if clean_situacao or clean_setor:
            filters += build_main_or_sub_os_filter_sql(
                setores=clean_setor or None,
                situacoes=clean_situacao or None,
                params=params,
                prefix="subfx",
                main_setor_sql=filter_setor_col,
                main_situacao_sql=filter_situacao_col,
                materialized_gap_fallback=use_mat_gap_fallback,
                tabandamento_gap_fallback=use_tabandamento_gap_fallback,
                materialized_supplement_fallback=(
                    use_tabandamento_gap_fallback
                    and mat_populated
                ),
                mirror_exclude_clause=MIRROR_EXCLUDE_CLAUSE.replace(
                    "a.CodStatus", "a_gap.CodStatus"
                ),
                include_sub_os=not painel,
                split_aware=not painel,
                require_manual=False,
                include_finished=include_finished,
            )

        if prioridade:
            clean_prio = [s.strip() for s in prioridade if s and s.strip()]
            if clean_prio:
                placeholders = ", ".join([f"%(prio_{i})s" for i in range(len(clean_prio))])
                filters += f" AND p.EntregPrazoLink IN ({placeholders})"
                for i, s in enumerate(clean_prio):
                    params[f"prio_{i}"] = s

    need_details_join = sort_key in ("produto", "titulo")

    pcp_select = ""
    pcp_join = ""
    order_prefix = ""

    if pcp_order:
        from pcp_queue_service import ensure_pcp_table

        ensure_pcp_table()
        pcp_select = ", pcp.ordem AS pcp_ordem, pcp.ultima_atualizacao AS pcp_ultima_atualizacao"
        pcp_join = f"""
        LEFT JOIN tab_pcp_fila AS pcp
            ON (pcp.setor = {setor_col} AND pcp.nro_os = p.NroProtocolo AND pcp.ano = p.AnoProtocolo)
        """
        order_prefix = """
        CASE WHEN pcp.ordem IS NULL THEN 1 ELSE 0 END,
        pcp.ordem ASC,
        """

    offset = (page - 1) * limit
    limit_clause = limit + 1 if simple_pagination else limit
    fetch_limit = limit_clause
    skip_sql_limit = False
    if use_exact_fast_path:
        # Lookup por Nr OS: poucos anos possíveis — busca completa antes do filtro finished.
        skip_sql_limit = True
    elif use_python_finished_filter:
        fetch_limit = min(max(limit_clause * 3, limit_clause), pagination_max)
    if not skip_sql_limit:
        params["limit"] = fetch_limit
        params["offset"] = offset

    if use_exact_fast_path or (use_fulltext_driver and not use_mat_for_finished):
        operacional_fields = _null_operacional_fields_sql()
    else:
        operacional_fields = _select_operacional_fields(uses_materialized=uses_materialized)
    details_join = _details_display_join_sql(need_join=need_details_join)

    if use_fulltext_driver:
        from_clause = _fulltext_details_driver_from_sql(
            produto_term=produto_term,
            titulo_term=titulo_term,
            params=params,
            andamento_join=andamento_join,
        )
        if not from_clause:
            # Termos viraram só stopwords — trata como busca sem filtro textual.
            use_fulltext_driver = False
            use_python_finished_filter = False
            use_mat_for_finished = False
            andamento_join, situacao_col, setor_col, uses_materialized = (
                _resolve_andamento_join()
            )
            if not include_finished and f"NOT IN ({_FINISHED_SQL_LIST})" not in filters:
                filters = (
                    " WHERE 1=1"
                    + f" AND {_active_situacao_predicate('a_op.SituacaoLink' if not uses_materialized else 'a_op.situacao')}"
                    + filters[len(" WHERE 1=1") :]
                )
            operacional_fields = _select_operacional_fields(
                uses_materialized=uses_materialized
            )
            from_clause = _build_from_clause(
                use_active_driver=False,
                andamento_join=andamento_join,
            )
            params["limit"] = limit_clause
    elif use_exact_fast_path:
        from_clause = """
    FROM tabProtocolos AS p
    """
    else:
        from_clause = _build_from_clause(
            use_active_driver=use_active_driver,
            andamento_join=andamento_join,
        )

    titulo_select = "d.Titulo AS titulo" if need_details_join else "NULL AS titulo"
    produto_select = (
        "d.TipoPublicacaoLink AS produto" if need_details_join else "NULL AS produto"
    )
    formato_select = "d.FormatoLink AS formato" if need_details_join else "NULL AS formato"

    sub_os_scalar = _sub_os_count_scalar_sql()

    if use_exact_fast_path:
        order_clause = f"ORDER BY {_os_search_stable_tiebreak_sql()}"
    else:
        order_clause = _build_os_search_order_clause(
            sort_by,
            sort_dir,
            order_prefix,
            situacao_col=situacao_col,
            setor_col=setor_col,
        )

    core_select = f"""
    SELECT 
        p.NroProtocolo AS nr_os, 
        p.AnoProtocolo AS ano, 
        {titulo_select},
        p.NomeUsuario AS solicitante,
        {operacional_fields},
        p.EntregPrazoLink AS prioridade,
        {produto_select},
        {formato_select},
        p.DataEntrada AS data_entrada,
        p.EntregData AS data_entrega,
        p.EntregPeriodo AS entreg_periodo,
        {sub_os_scalar} AS sub_os_count,
        ({sub_os_scalar} > 0) AS has_sub_os
        {pcp_select}
    {from_clause}
    {details_join}
    {pcp_join}
    {filters}
    {order_clause}
    """

    data_query = f"""
    {core_select}
    """
    if not skip_sql_limit:
        data_query += """
    LIMIT %(limit)s OFFSET %(offset)s
    """

    raw_results = db.execute_query(data_query, params)
    data_results = _dedupe_os_search_rows(raw_results)

    if not need_details_join:
        data_results = _enrich_rows_with_details(data_results)

    data_results = _enrich_operacional_from_live(data_results)

    if not painel:
        data_results = _expand_split_os_search_rows(
            data_results,
            setores=clean_setor or None,
            situacoes=clean_situacao or None,
            include_finished=include_finished,
        )

    # Exact lookup: filtros de escolha após enrich (conjunto pequeno; SQL permanece indexável).
    if use_exact_fast_path:
        data_results = _filter_exact_lookup_choice_filters(
            data_results,
            situacao=clean_situacao or None,
            setor=clean_setor or None,
            prioridade=prioridade,
            include_os=include_os,
            include_sp=include_sp,
        )
    else:
        data_results = _filter_rows_by_displayed_andamento(
            data_results,
            situacoes=clean_situacao or None,
            setores=clean_setor or None,
        )

    # Exact lookup / driver sem materializada: filtro de finalizadas após enrich.
    if use_exact_fast_path and not include_finished:
        data_results = _filter_out_finished_rows(data_results)
    elif use_python_finished_filter:
        data_results = _filter_out_finished_rows(data_results)

    has_next_raw = False
    if simple_pagination:
        if use_python_finished_filter or use_exact_fast_path:
            has_next_raw = len(data_results) > limit
            if len(data_results) > limit:
                data_results = data_results[:limit]
        else:
            has_next_raw = len(raw_results) > limit
            if len(data_results) > limit:
                data_results = data_results[:limit]
    elif len(data_results) > limit:
        data_results = data_results[:limit]

    annotate_setores = clean_setor or None
    annotate_situacoes = clean_situacao or None
    if not painel:
        data_results = annotate_search_sub_os_matches(
            data_results,
            setores=annotate_setores,
            situacoes=annotate_situacoes,
        )

    total_records: Optional[int] = None
    total_pages: Optional[int] = None
    has_next = has_next_raw

    count_from = from_clause if not use_active_driver else f"""
    FROM tabProtocolos AS p
    {andamento_join}
    """

    if include_total:
        count_query = f"""
        SELECT COUNT(DISTINCT p.NroProtocolo, p.AnoProtocolo) AS total
        {count_from}
        {filters}
        """
        count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
        count_result = db.execute_query(count_query, count_params)
        total_records = int(count_result[0]["total"]) if count_result else 0
        total_pages = (total_records + limit - 1) // limit if limit else 0
        has_next = page < (total_pages or 0)

    meta: Dict[str, Any] = {
        "page": page,
        "limit": limit,
        "has_next": has_next,
    }
    if text_search_modes:
        meta["text_search_modes"] = text_search_modes
    if simple_pagination:
        meta["simple_pagination"] = True
        if include_total and total_records is not None:
            meta["total_records"] = total_records
            meta["total_pages"] = total_pages
    else:
        meta["total_records"] = total_records
        meta["total_pages"] = total_pages

    return {"data": data_results, "meta": meta}


def _materialized_andamento_join_sql() -> str:
    return _materialized_join_sql()


def _legacy_andamento_join_sql() -> str:
    return _live_andamento_join_sql()


def _os_search_andamento_join_sql() -> str:
    """Join efetivo da busca (materializada ou live fallback)."""
    join, _, _, _ = _resolve_andamento_join()
    return join
