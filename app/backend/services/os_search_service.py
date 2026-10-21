"""
Busca paginada de OSs — GET /api/os/search.
Fonte primária de situação/setor: tabAndamento (UltimoStatus=1, espelhos Sub OS excluídos).
tab_os_ultimo_andamento_operacional só entra com OS_SEARCH_PREFER_MATERIALIZED=1.
"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import date, datetime, timedelta
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
OS_SEARCH_IN_CHUNK = 500
OS_SEARCH_MIN_LIKE_CHARS = OS_TEXT_SEARCH_MIN_CHARS
OS_SEARCH_DEFAULT_LIMIT = 20
OS_SEARCH_MAX_MULTI_FILTER_ITEMS = 20


def build_os_search_etag(result: Dict[str, Any]) -> str:
    """Fingerprint estável do dump (ids + andamento) para If-None-Match / 304."""
    digest = hashlib.sha1()
    data = result.get("data") or []
    digest.update(str(len(data)).encode("utf-8"))
    for row in data:
        digest.update(b"\0")
        digest.update(str(row.get("nr_os") or "").encode("utf-8"))
        digest.update(str(row.get("ano") or "").encode("utf-8"))
        digest.update(str(row.get("last_update") or "").encode("utf-8"))
        digest.update(str(row.get("situacao") or "").encode("utf-8"))
        digest.update(str(row.get("setor") or "").encode("utf-8"))
        digest.update(str(row.get("sub_os_id") or "").encode("utf-8"))
    return f'"{digest.hexdigest()}"'

_HOME_FETCH_ALL_FAST_SORTS = frozenset(
    {
        "",
        "ano",
        "nr_os",
        "solicitante",
        "prioridade",
        "data_entrega",
        "produto",
        "titulo",
    }
)

FINISHED_SITUACOES = ("Entregue", "Cancelada", "Cancelado")
_FINISHED_SQL_LIST = ", ".join(f"'{s}'" for s in FINISHED_SITUACOES)

OS_SEARCH_SORT_COLUMNS_BASE = {
    "nr_os": "p.NroProtocolo",
    "ano": "p.AnoProtocolo",
    "produto": "d.TipoPublicacaoLink",
    "titulo": "d.Titulo",
    "solicitante": "p.NomeUsuario",
    "prioridade": "p.EntregPrazoLink",
    "data_entrada": "p.DataEntrada",
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


_OS_SEARCH_SORT_KEYS = frozenset({*OS_SEARCH_SORT_COLUMNS_BASE.keys(), "situacao", "setor"})


def _parse_os_search_sorts(
    sorts: Optional[List[str]],
    sort_by: Optional[str],
    sort_dir: Optional[str],
) -> List[Tuple[str, str]]:
    parsed: List[Tuple[str, str]] = []
    seen: set[str] = set()
    for raw in sorts or []:
        text = (raw or "").strip()
        if not text:
            continue
        if ":" in text:
            key, _, direction = text.partition(":")
        else:
            key, direction = text, "asc"
        key = key.strip().lower()
        direction = "desc" if direction.strip().lower() == "desc" else "asc"
        if key not in _OS_SEARCH_SORT_KEYS or key in seen:
            continue
        seen.add(key)
        parsed.append((key, direction))
        if len(parsed) >= len(_OS_SEARCH_SORT_KEYS):
            break
    if parsed:
        return parsed
    key = (sort_by or "").strip()
    if key in _OS_SEARCH_SORT_KEYS:
        direction = "desc" if (sort_dir or "").strip().lower() == "desc" else "asc"
        return [(key, direction)]
    return []


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


def _parse_iso_date(value: Optional[str]) -> Optional[date]:
    raw = (value or "").strip()[:10]
    if len(raw) != 10:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def _details_attr_like_exists_sql(
    *,
    alias: str,
    columns: List[str],
    param_key: str,
    term: str,
    params: dict,
) -> str:
    params[param_key] = f"%{_escape_sql_like_prefix(term)}%"
    ors = " OR ".join(
        f"{alias}.{col} LIKE %({param_key})s ESCAPE '\\\\'" for col in columns
    )
    return f"""
     AND EXISTS (
        SELECT 1 FROM tabDetalhesServico AS {alias}
        WHERE {alias}.NroProtocoloLinkDet = p.NroProtocolo
          AND {alias}.AnoProtocoloLinkDet = p.AnoProtocolo
          AND ({ors})
     )"""


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


def _sort_key_sql_fragment(
    key: str,
    direction: str,
    sort_map: dict,
) -> Optional[str]:
    col = sort_map.get(key)
    if not col:
        return None
    if key == "prioridade":
        return f"{_os_search_priority_rank_sql()} {direction}"
    return f"{col} {direction}"


def _build_os_search_order_clause(
    sort_by: Optional[str],
    sort_dir: Optional[str],
    order_prefix: str,
    *,
    situacao_col: str,
    setor_col: str,
    sorts: Optional[List[Tuple[str, str]]] = None,
) -> str:
    sort_map = _sort_columns(situacao_col, setor_col)
    keys = list(sorts) if sorts else []
    if not keys:
        key = (sort_by or "").strip()
        if key:
            direction = "DESC" if (sort_dir or "").strip().lower() == "desc" else "ASC"
            keys = [(key, direction.lower())]
    if not keys:
        return f"ORDER BY {order_prefix}{OS_SEARCH_DEFAULT_ORDER}"

    if len(keys) == 1:
        key, raw_dir = keys[0]
        col = sort_map.get(key)
        if not col:
            return f"ORDER BY {order_prefix}{OS_SEARCH_DEFAULT_ORDER}"
        direction = "DESC" if raw_dir == "desc" else "ASC"
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

    fragments: List[str] = []
    used: set[str] = set()
    for key, raw_dir in keys:
        direction = "DESC" if raw_dir == "desc" else "ASC"
        fragment = _sort_key_sql_fragment(key, direction, sort_map)
        if not fragment:
            continue
        fragments.append(fragment)
        used.add(key)
    if not fragments:
        return f"ORDER BY {order_prefix}{OS_SEARCH_DEFAULT_ORDER}"
    if "ano" not in used:
        fragments.append("p.AnoProtocolo DESC")
    if "nr_os" not in used:
        fragments.append("p.NroProtocolo DESC")
    return f"ORDER BY {order_prefix}" + ", ".join(fragments)


def _chunks(items: List[Any], size: int) -> List[List[Any]]:
    if not items:
        return []
    chunk_size = max(1, size)
    return [items[i : i + chunk_size] for i in range(0, len(items), chunk_size)]


def _protocol_pairs(rows: List[Dict[str, Any]]) -> List[Tuple[int, int]]:
    seen: set[Tuple[int, int]] = set()
    pairs: List[Tuple[int, int]] = []
    for row in rows:
        nro, ano = row.get("nr_os"), row.get("ano")
        if nro is None or ano is None:
            continue
        key = (int(nro), int(ano))
        if key in seen:
            continue
        seen.add(key)
        pairs.append(key)
    return pairs


def _can_use_home_fetch_all_fast_path(
    *,
    fetch_all: bool,
    pcp_order: bool,
    exact_os_lookup: bool,
    sort_key: str,
    sort_keys: Optional[List[str]] = None,
    clean_situacao: List[str],
    clean_setor: List[str],
    has_ano: bool,
    include_finished: bool,
) -> bool:
    """Home fetch_all: protocolos + enrich em lote, sem ROW_NUMBER em tabAndamento."""
    if not fetch_all or pcp_order or exact_os_lookup:
        return False
    keys = [k.strip() for k in (sort_keys or []) if k and k.strip()]
    if not keys:
        keys = [(sort_key or "").strip()]
    if any(k not in _HOME_FETCH_ALL_FAST_SORTS for k in keys):
        return False
    needs_andamento_filter = bool(clean_situacao or clean_setor) or not include_finished
    if needs_andamento_filter and not has_ano:
        return False
    return True


def _enrich_rows_with_details(
    rows: List[Dict[str, Any]], *, slim: bool = False
) -> List[Dict[str, Any]]:
    if not rows:
        return rows
    pairs = _protocol_pairs(rows)
    if not pairs:
        return rows
    by_key: Dict[tuple, Dict[str, Any]] = {}
    fields = ("titulo", "produto") if slim else ("titulo", "produto", "formato")
    select_formato = "" if slim else ",\n            d.FormatoLink AS formato"
    for chunk in _chunks(pairs, OS_SEARCH_IN_CHUNK):
        placeholders = ", ".join(["(%s, %s)"] * len(chunk))
        flat: List[Any] = [x for pair in chunk for x in pair]
        detail_rows = db.execute_query(
            f"""
        SELECT
            d.NroProtocoloLinkDet AS nr_os,
            d.AnoProtocoloLinkDet AS ano,
            d.Titulo AS titulo,
            d.TipoPublicacaoLink AS produto
            {select_formato}
        FROM tabDetalhesServico AS d
        WHERE (d.NroProtocoloLinkDet, d.AnoProtocoloLinkDet) IN ({placeholders})
        """,
            tuple(flat),
        )
        for dr in detail_rows or []:
            key = (dr.get("nr_os"), dr.get("ano"))
            if key not in by_key:
                by_key[key] = dr
    for row in rows:
        key = (row.get("nr_os"), row.get("ano"))
        det = by_key.get(key)
        if not det:
            continue
        for field in fields:
            if not row.get(field) and det.get(field):
                row[field] = det.get(field)
    return rows


def _enrich_painel_fornecedores_gravacao_externa(
    rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Anexa fornecedor(es) no painel para Grav. Externa e Gravação Ext. Concluída.

    - Setor ``Grav. Externa``: sessões ativas (``pendente`` / ``iniciada``).
    - Situação ``Gravação Ext. Concluída``: sessões ``concluida``.
    """
    if not rows:
        return rows
    from services.gravacao_externa_service import (
        ACTIVE_STATUSES,
        SETOR_GRAV_EXTERNA,
        SITUACAO_GRAV_CONCLUIDA,
        map_fornecedores_por_os,
    )

    active_pairs: List[Tuple[int, int]] = []
    concluida_pairs: List[Tuple[int, int]] = []
    seen_active: set[Tuple[int, int]] = set()
    seen_concluida: set[Tuple[int, int]] = set()

    for row in rows:
        try:
            nr_os = int(row["nr_os"])
            ano = int(row["ano"])
        except (TypeError, ValueError, KeyError):
            continue
        key = (nr_os, ano)
        setor = str(row.get("setor") or "").strip()
        situacao = str(row.get("situacao") or "").strip()
        if situacao == SITUACAO_GRAV_CONCLUIDA:
            if key not in seen_concluida:
                seen_concluida.add(key)
                concluida_pairs.append(key)
        elif setor == SETOR_GRAV_EXTERNA:
            if key not in seen_active:
                seen_active.add(key)
                active_pairs.append(key)

    if not active_pairs and not concluida_pairs:
        return rows

    mapping: Dict[str, List[Dict[str, Any]]] = {}
    try:
        if active_pairs:
            mapping.update(
                map_fornecedores_por_os(active_pairs, statuses=ACTIVE_STATUSES)
            )
        if concluida_pairs:
            mapping.update(
                map_fornecedores_por_os(
                    concluida_pairs, statuses=frozenset({"concluida"})
                )
            )
    except Exception:
        logger.exception(
            "[os_search] falha ao enriquecer fornecedores Grav. Externa (painel)"
        )
        return rows

    for row in rows:
        setor = str(row.get("setor") or "").strip()
        situacao = str(row.get("situacao") or "").strip()
        if situacao != SITUACAO_GRAV_CONCLUIDA and setor != SETOR_GRAV_EXTERNA:
            continue
        try:
            map_key = f"{int(row['ano'])}-{int(row['nr_os'])}"
        except (TypeError, ValueError, KeyError):
            continue
        fornecedores = mapping.get(map_key) or []
        if not fornecedores:
            continue
        row["fornecedores"] = fornecedores
        first = fornecedores[0]
        row["fornecedor_ponto"] = first.get("ponto")
        row["fornecedor_nome"] = first.get("nome")
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


def _enrich_operacional_from_live(
    rows: List[Dict[str, Any]], *, slim: bool = False, include_user: bool = False
) -> List[Dict[str, Any]]:
    """Sobrescreve situação/setor com tabAndamento live — mesma fonte do painel setor."""
    if not rows:
        return rows
    from services.os_ultimo_andamento_service import fetch_operacional_rows_batch

    pairs = _protocol_pairs(rows)
    live_map: Dict[Tuple[int, int], Dict[str, Any]] = {}
    for chunk in _chunks(pairs, OS_SEARCH_IN_CHUNK):
        live_map.update(
            fetch_operacional_rows_batch(chunk, include_user=True)
            if include_user else fetch_operacional_rows_batch(chunk)
        )
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
        if include_user:
            row["andamento_usuario"] = live.get("andamento_usuario")
        if not slim:
            row["observacao"] = live.get("observacao")
    return rows


def _enrich_sub_os_counts(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Contagem de Sub OS ativas em lote (GROUP BY), sem subquery correlacionada."""
    if not rows:
        return rows
    pairs = _protocol_pairs(rows)
    counts: Dict[Tuple[int, int], int] = {}
    for chunk in _chunks(pairs, OS_SEARCH_IN_CHUNK):
        placeholders = ", ".join(["(%s, %s)"] * len(chunk))
        flat: List[Any] = [x for pair in chunk for x in pair]
        found = db.execute_query(
            f"""
            SELECT
                s_cnt.nro_protocolo AS nr_os,
                s_cnt.ano_protocolo AS ano,
                COUNT(*) AS cnt
            FROM tab_os_sub_os AS s_cnt
            WHERE (s_cnt.nro_protocolo, s_cnt.ano_protocolo) IN ({placeholders})
              AND s_cnt.ativo = 1
            GROUP BY s_cnt.nro_protocolo, s_cnt.ano_protocolo
            """,
            tuple(flat),
        )
        for rec in found or []:
            nro, ano = rec.get("nr_os"), rec.get("ano")
            if nro is None or ano is None:
                continue
            counts[(int(nro), int(ano))] = int(rec.get("cnt") or 0)
    for row in rows:
        nro, ano = row.get("nr_os"), row.get("ano")
        if nro is None or ano is None:
            row["sub_os_count"] = 0
            row["has_sub_os"] = False
            continue
        cnt = counts.get((int(nro), int(ano)), 0)
        row["sub_os_count"] = cnt
        row["has_sub_os"] = cnt > 0
    return rows


def _execute_home_fetch_all(
    *,
    filters: str,
    params: dict,
    sort_by: Optional[str],
    sort_dir: Optional[str],
    sorts: Optional[List[Tuple[str, str]]] = None,
    limit: int,
    include_finished: bool,
    include_total: bool,
    painel: bool,
    clean_situacao: List[str],
    clean_setor: List[str],
    text_search_modes: List[str],
) -> Dict[str, Any]:
    """Lista completa da home: tabProtocolos + enrich em lote, sem ROW_NUMBER/COUNT."""
    sort_key = (sort_by or "").strip()
    sort_key_names = [k for k, _ in (sorts or [])] or ([sort_key] if sort_key else [])
    need_details_join = any(k in ("produto", "titulo") for k in sort_key_names)
    details_join = _details_display_join_sql(need_join=need_details_join)
    titulo_select = "d.Titulo AS titulo" if need_details_join else "NULL AS titulo"
    produto_select = (
        "d.TipoPublicacaoLink AS produto" if need_details_join else "NULL AS produto"
    )
    order_clause = _build_os_search_order_clause(
        sort_by,
        sort_dir,
        "",
        situacao_col="NULL",
        setor_col="NULL",
        sorts=sorts,
    )
    query_params = dict(params)
    query_params["limit"] = limit
    data_query = f"""
    SELECT
        p.NroProtocolo AS nr_os,
        p.AnoProtocolo AS ano,
        {titulo_select},
        p.NomeUsuario AS solicitante,
        NULL AS situacao,
        NULL AS setor,
        NULL AS last_update,
        NULL AS observacao,
        p.EntregPrazoLink AS prioridade,
        {produto_select},
        NULL AS formato,
        p.DataEntrada AS data_entrada,
        p.EntregData AS data_entrega,
        NULL AS entreg_periodo,
        0 AS sub_os_count,
        0 AS has_sub_os
    FROM tabProtocolos AS p
    {details_join}
    {filters}
    {order_clause}
    LIMIT %(limit)s
    """
    raw_results = db.execute_query(data_query, query_params)
    data_results = _dedupe_os_search_rows(raw_results)
    truncated = len(raw_results or []) >= limit

    if not need_details_join:
        data_results = _enrich_rows_with_details(data_results, slim=True)
    data_results = _enrich_operacional_from_live(data_results, slim=True)
    data_results = _enrich_sub_os_counts(data_results)

    if not include_finished:
        data_results = _filter_out_finished_rows(data_results)

    if not painel:
        data_results = _expand_split_os_search_rows(
            data_results,
            setores=clean_setor or None,
            situacoes=clean_situacao or None,
            include_finished=include_finished,
        )
    data_results = _filter_rows_by_displayed_andamento(
        data_results,
        situacoes=clean_situacao or None,
        setores=clean_setor or None,
    )
    if not painel:
        data_results = annotate_search_sub_os_matches(
            data_results,
            setores=clean_setor or None,
            situacoes=clean_situacao or None,
        )

    for row in data_results:
        row.pop("observacao", None)
        row.pop("formato", None)
        row.pop("entreg_periodo", None)

    protocol_total = len(
        {(row.get("nr_os"), row.get("ano")) for row in data_results}
    )
    total_records = protocol_total
    total_pages = 1 if protocol_total else 0
    meta: Dict[str, Any] = {
        "page": 1,
        "limit": limit,
        "has_next": truncated,
        "simple_pagination": True,
        "fetch_all_fast_path": True,
    }
    if text_search_modes:
        meta["text_search_modes"] = text_search_modes
    if include_total:
        meta["total_records"] = total_records
        meta["total_pages"] = total_pages
    return {"data": data_results, "meta": meta}


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
    formatos: Optional[List[str]] = None,
    papel: Optional[str] = None,
    cores: Optional[str] = None,
    acabamento: Optional[str] = None,
    observacao: Optional[str] = None,
    data_entrada_de: Optional[str] = None,
    data_entrada_ate: Optional[str] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
    page: int = 1,
    limit: int = OS_SEARCH_DEFAULT_LIMIT,
    pcp_order: bool = False,
    simple_pagination: bool = True,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    sorts: Optional[List[str]] = None,
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
    clean_formatos = _clean_multi_filter_values(formatos)
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
    if len(clean_formatos) > OS_SEARCH_MAX_MULTI_FILTER_ITEMS:
        raise ValueError(
            f"Máximo de {OS_SEARCH_MAX_MULTI_FILTER_ITEMS} formatos por busca"
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
    papel_term = _os_search_like_term(papel, has_nr_os=has_nr_os, has_ano=has_ano)
    cores_term = _os_search_like_term(cores, has_nr_os=has_nr_os, has_ano=has_ano)
    acabamento_term = _os_search_like_term(
        acabamento, has_nr_os=has_nr_os, has_ano=has_ano
    )
    observacao_term = _os_search_like_term(
        observacao, has_nr_os=has_nr_os, has_ano=has_ano
    )
    parsed_sorts = _parse_os_search_sorts(sorts, sort_by, sort_dir)
    sort_key = parsed_sorts[0][0] if parsed_sorts else (sort_by or "").strip()
    sort_key_names = [k for k, _ in parsed_sorts] or ([sort_key] if sort_key else [])

    clean_situacao = [s.strip() for s in (situacao or []) if s and s.strip()]
    clean_setor = [s.strip() for s in (setor or []) if s and s.strip()]

    use_fulltext = fulltext_text_search_indexes_ready()
    mat_populated = materialized_table_populated()

    use_home_fast_path = _can_use_home_fetch_all_fast_path(
        fetch_all=fetch_all,
        pcp_order=pcp_order,
        exact_os_lookup=skip_choice_filters,
        sort_key=sort_key,
        sort_keys=sort_key_names,
        clean_situacao=clean_situacao,
        clean_setor=clean_setor,
        has_ano=has_ano,
        include_finished=include_finished,
    )

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
    # Home fetch_all usa FROM tabProtocolos — MATCH entra no WHERE, não neste driver.
    can_use_fulltext_driver = (
        not use_home_fast_path
        and not use_exact_fast_path
        and details_mode_preview == "fulltext"
        and bool(titulo_term or produto_term)
        and not pcp_order
        and not any(k in ("situacao", "setor") for k in sort_key_names)
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

    if use_home_fast_path:
        andamento_join = ""
        situacao_col = "NULL"
        setor_col = "NULL"
        uses_materialized = False
        filter_situacao_col = "NULL"
        filter_setor_col = "NULL"
        use_mat_gap_fallback = False
        use_tabandamento_gap_fallback = False
    elif use_exact_fast_path:
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

    apply_finished_in_sql = (
        not use_home_fast_path
        and not include_finished
        and not use_exact_fast_path
        and (not use_fulltext_driver or use_mat_for_finished)
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

    entrada_de = _parse_iso_date(data_entrada_de)
    entrada_ate = _parse_iso_date(data_entrada_ate)
    if entrada_de:
        filters += " AND p.DataEntrada >= %(entrada_de)s"
        params["entrada_de"] = entrada_de.isoformat()
    if entrada_ate:
        filters += " AND p.DataEntrada < %(entrada_ate_excl)s"
        params["entrada_ate_excl"] = (entrada_ate + timedelta(days=1)).isoformat()

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

    if clean_formatos:
        fmt_placeholders = ", ".join(
            f"%(fmt_sel_{i})s" for i in range(len(clean_formatos))
        )
        filters += f"""
         AND EXISTS (
            SELECT 1 FROM tabDetalhesServico AS d_fmt
            WHERE d_fmt.NroProtocoloLinkDet = p.NroProtocolo
              AND d_fmt.AnoProtocoloLinkDet = p.AnoProtocolo
              AND d_fmt.FormatoLink IN ({fmt_placeholders})
         )"""
        for i, val in enumerate(clean_formatos):
            params[f"fmt_sel_{i}"] = val

    if papel_term:
        filters += _details_attr_like_exists_sql(
            alias="d_papel",
            columns=["PapelLink", "PapelDescricao"],
            param_key="papel_like",
            term=papel_term,
            params=params,
        )
    if cores_term:
        filters += _details_attr_like_exists_sql(
            alias="d_cores",
            columns=["Cores", "CoresDescricao"],
            param_key="cores_like",
            term=cores_term,
            params=params,
        )
    if acabamento_term:
        filters += _details_attr_like_exists_sql(
            alias="d_acab",
            columns=["DescAcabamento"],
            param_key="acabamento_like",
            term=acabamento_term,
            params=params,
        )
    if observacao_term:
        filters += _details_attr_like_exists_sql(
            alias="d_obs",
            columns=["Observ"],
            param_key="observacao_like",
            term=observacao_term,
            params=params,
        )

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

        if (clean_situacao or clean_setor) and not use_home_fast_path:
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

    if use_home_fast_path:
        return _execute_home_fetch_all(
            filters=filters,
            params=params,
            sort_by=sort_by,
            sort_dir=sort_dir,
            sorts=parsed_sorts,
            limit=limit,
            include_finished=include_finished,
            include_total=include_total,
            painel=painel,
            clean_situacao=clean_situacao,
            clean_setor=clean_setor,
            text_search_modes=text_search_modes,
        )

    need_details_join = any(k in ("produto", "titulo") for k in sort_key_names)

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
            sorts=parsed_sorts,
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

    data_results = (
        _enrich_operacional_from_live(data_results, include_user=True)
        if painel else _enrich_operacional_from_live(data_results)
    )

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
    else:
        data_results = _enrich_painel_fornecedores_gravacao_externa(data_results)

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
