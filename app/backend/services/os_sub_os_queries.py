"""
Queries auxiliares — Sub OS em buscas e filas (status de tab_os_sub_os_andamento).
Não usa tabAndamento.UltimoStatus para status de componente.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from database import db
from services.os_componentes_service import MANUAL_ANDAMENTO_SQL

FINISHED_SITUACOES = ("Entregue", "Cancelada", "Cancelado")

# Mesma fila default de /api/os/search (prioridade + data + desempate).
_QUEUE_PRIORITY_ORDER = """
        CASE
            WHEN TRIM(COALESCE(p.EntregPrazoLink, '')) LIKE 'Prometido p/%%'
              OR TRIM(COALESCE(p.EntregPrazoLink, '')) = 'Prometido p/' THEN 1
            WHEN TRIM(COALESCE(p.EntregPrazoLink, '')) LIKE 'Solicitado p/%%'
              OR TRIM(COALESCE(p.EntregPrazoLink, '')) = 'Solicitado p/' THEN 2
            ELSE 3
        END ASC,
        COALESCE(p.EntregData, p.DataEntrada) ASC,
        p.AnoProtocolo DESC,
        p.NroProtocolo DESC
"""


def _clean_filter_values(values: Optional[Sequence[str]]) -> List[str]:
    if not values:
        return []
    return [v.strip() for v in values if v and str(v).strip()]


def build_main_or_sub_os_filter_sql(
    *,
    setores: Optional[Sequence[str]],
    situacoes: Optional[Sequence[str]],
    params: Dict[str, Any],
    prefix: str = "subfx",
    main_setor_sql: str = "a.SetorLink",
    main_situacao_sql: str = "a.SituacaoLink",
    materialized_gap_fallback: bool = False,
    tabandamento_gap_fallback: bool = False,
    materialized_supplement_fallback: bool = False,
    mirror_exclude_clause: Optional[str] = None,
    include_sub_os: bool = True,
    split_aware: bool = False,
    require_manual: bool = True,
    include_finished: bool = False,
) -> str:
    """
    Fragmento SQL: AND (filtros no andamento principal [OR EXISTS Sub OS]).

    Home (split_aware): OS unida filtra na principal; OS dividida só entra via Sub OS.
    Painel: include_sub_os=False — só OS principal; Sub OS entra via /pcp/queue.

    materialized_gap_fallback: OS sem linha materializada, com UltimoStatus=1 em tabAndamento.
    tabandamento_gap_fallback: join live sem linha, confirma via EXISTS em tabAndamento.
    materialized_supplement_fallback: após tabAndamento, inclui candidatos da materializada
    confirmados em tabAndamento (preferência operacional).
    """
    clean_setores = _clean_filter_values(setores)
    clean_situacoes = _clean_filter_values(situacoes)
    if not clean_setores and not clean_situacoes:
        return ""

    main_parts: List[str] = []
    sub_parts = [
        "s.nro_protocolo = p.NroProtocolo",
        "s.ano_protocolo = p.AnoProtocolo",
        "s.ativo = 1",
        "s.congelada = 0",
        "sa.ultimo_status = 1",
    ]
    if not include_finished:
        sub_parts.append(f"sa.situacao NOT IN {FINISHED_SITUACOES}")

    if clean_setores:
        ph = ", ".join(f"%({prefix}_setor_{i})s" for i in range(len(clean_setores)))
        main_parts.append(f"{main_setor_sql} IN ({ph})")
        if include_sub_os:
            sub_parts.append(f"sa.setor IN ({ph})")
        for i, val in enumerate(clean_setores):
            params[f"{prefix}_setor_{i}"] = val

    if clean_situacoes:
        ph = ", ".join(f"%({prefix}_sit_{i})s" for i in range(len(clean_situacoes)))
        main_parts.append(f"{main_situacao_sql} IN ({ph})")
        if include_sub_os:
            sub_parts.append(f"sa.situacao IN ({ph})")
        for i, val in enumerate(clean_situacoes):
            params[f"{prefix}_sit_{i}"] = val

    main_sql = " AND ".join(main_parts)
    exists_sql = ""
    if include_sub_os:
        sub_where = " AND ".join(sub_parts)
        manual_clause = ""
        if require_manual:
            manual_sql = MANUAL_ANDAMENTO_SQL.replace("sa.", "sa_m.")
            manual_clause = f"""
              AND EXISTS (
                  SELECT 1 FROM tab_os_sub_os_andamento sa_m
                  WHERE sa_m.sub_os_id = s.id AND {manual_sql}
              )"""
        exists_sql = f"""
        EXISTS (
            SELECT 1
            FROM tab_os_sub_os s
            INNER JOIN tab_os_sub_os_andamento sa ON sa.sub_os_id = s.id
            WHERE {sub_where}
              {manual_clause}
        )
    """

    effective_main = main_sql
    gap_main = ""
    gap_parts: List[str] = []
    if clean_setores:
        ph = ", ".join(f"%({prefix}_setor_{i})s" for i in range(len(clean_setores)))
        gap_parts.append(f"a_gap.SetorLink IN ({ph})")
    if clean_situacoes:
        ph = ", ".join(f"%({prefix}_sit_{i})s" for i in range(len(clean_situacoes)))
        gap_parts.append(f"a_gap.SituacaoLink IN ({ph})")
    if gap_parts:
        gap_main = " AND ".join(gap_parts)

    if gap_main and (
        materialized_gap_fallback
        or tabandamento_gap_fallback
        or materialized_supplement_fallback
    ):
        mirror = (mirror_exclude_clause or "1=1").strip()
        from services.andamento_table import get_andamento_table

        andamento_tbl = get_andamento_table()
        gap_exists = f"""
            EXISTS (
                SELECT 1
                FROM {andamento_tbl} AS a_gap
                WHERE a_gap.NroProtocoloLink = p.NroProtocolo
                  AND a_gap.AnoProtocoloLink = p.AnoProtocolo
                  AND a_gap.UltimoStatus = 1
                  AND {mirror}
                  AND {gap_main}
            )
        """
        if materialized_gap_fallback and main_parts:
            effective_main = (
                f"(({main_sql}) OR (a_op.nro_protocolo IS NULL AND ({gap_exists})))"
            )
        elif tabandamento_gap_fallback and main_parts:
            effective_main = (
                f"(({main_sql}) OR (a_op.SituacaoLink IS NULL AND ({gap_exists})))"
            )
            if materialized_supplement_fallback:
                from services.os_ultimo_andamento_service import TABLE as MAT_TABLE

                mat_parts: List[str] = []
                if clean_setores:
                    ph = ", ".join(
                        f"%({prefix}_setor_{i})s" for i in range(len(clean_setores))
                    )
                    mat_parts.append(f"m.setor IN ({ph})")
                if clean_situacoes:
                    ph = ", ".join(
                        f"%({prefix}_sit_{i})s" for i in range(len(clean_situacoes))
                    )
                    mat_parts.append(f"m.situacao IN ({ph})")
                mat_main = " AND ".join(mat_parts)
                mat_exists = f"""
                    EXISTS (
                        SELECT 1
                        FROM {MAT_TABLE} AS m
                        WHERE m.nro_protocolo = p.NroProtocolo
                          AND m.ano_protocolo = p.AnoProtocolo
                          AND {mat_main}
                    )
                """
                effective_main = (
                    f"(({effective_main}) OR "
                    f"(a_op.SituacaoLink IS NULL AND ({mat_exists}) AND ({gap_exists})))"
                )

    if include_sub_os and exists_sql and split_aware:
        split_sql = """
        EXISTS (
            SELECT 1 FROM tab_os_sub_os sx
            WHERE sx.nro_protocolo = p.NroProtocolo
              AND sx.ano_protocolo = p.AnoProtocolo
              AND sx.ativo = 1
        )
        """
        return (
            f" AND ((NOT ({split_sql}) AND ({effective_main}))"
            f" OR (({split_sql}) AND {exists_sql}))"
        )
    if include_sub_os and exists_sql:
        return f" AND (({effective_main}) OR {exists_sql})"
    return f" AND ({effective_main})"


def annotate_search_sub_os_matches(
    rows: List[Dict[str, Any]],
    *,
    setores: Optional[Sequence[str]],
    situacoes: Optional[Sequence[str]],
) -> List[Dict[str, Any]]:
    """Marca linhas cuja inclusão no resultado veio do status de Sub OS (para auto-expandir)."""
    clean_setores = set(_clean_filter_values(setores))
    clean_situacoes = set(_clean_filter_values(situacoes))
    if not clean_setores and not clean_situacoes:
        return rows

    for row in rows or []:
        main_setor = str(row.get("setor") or "").strip()
        main_sit = str(row.get("situacao") or "").strip()
        main_ok = True
        if clean_setores and main_setor not in clean_setores:
            main_ok = False
        if clean_situacoes and main_sit not in clean_situacoes:
            main_ok = False
        row["matched_via_sub_os"] = bool(
            not main_ok and row.get("has_sub_os")
        )
    return rows


def pairs_matching_sub_os_filters(
    pairs: Sequence[Tuple[int, int]],
    *,
    setores: Optional[Sequence[str]] = None,
    situacoes: Optional[Sequence[str]] = None,
) -> set[Tuple[int, int]]:
    """
    Pares (nro, ano) com Sub OS ativa cujo último status manual casa com setor/situação.
    Mesma semântica do EXISTS em build_main_or_sub_os_filter_sql (sem gap fallback).
    """
    clean_setores = _clean_filter_values(setores)
    clean_situacoes = _clean_filter_values(situacoes)
    if not pairs or (not clean_setores and not clean_situacoes):
        return set()

    unique_pairs = list({(int(nro), int(ano)) for nro, ano in pairs})
    if not unique_pairs:
        return set()

    pair_ph = ", ".join(["(%s, %s)"] * len(unique_pairs))
    params: List[Any] = []
    for nro, ano in unique_pairs:
        params.extend([nro, ano])

    finished_ph = ", ".join(["%s"] * len(FINISHED_SITUACOES))
    params.extend(FINISHED_SITUACOES)

    extra: List[str] = []
    if clean_setores:
        ph = ", ".join(["%s"] * len(clean_setores))
        extra.append(f"sa.setor IN ({ph})")
        params.extend(clean_setores)
    if clean_situacoes:
        ph = ", ".join(["%s"] * len(clean_situacoes))
        extra.append(f"sa.situacao IN ({ph})")
        params.extend(clean_situacoes)
    extra_sql = (" AND " + " AND ".join(extra)) if extra else ""

    query = f"""
    SELECT DISTINCT s.nro_protocolo AS nro, s.ano_protocolo AS ano
    FROM tab_os_sub_os s
    INNER JOIN tab_os_sub_os_andamento sa ON sa.sub_os_id = s.id
    WHERE (s.nro_protocolo, s.ano_protocolo) IN ({pair_ph})
      AND s.ativo = 1
      AND s.congelada = 0
      AND sa.ultimo_status = 1
      AND sa.situacao NOT IN ({finished_ph})
      {extra_sql}
    """
    rows = db.execute_query(query, params) or []
    return {(int(r["nro"]), int(r["ano"])) for r in rows if r.get("nro") is not None}


def fetch_sub_os_queue_rows(
    *,
    base_setor: str,
    display_setor: str,
    situacoes: Optional[Sequence[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Linhas virtuais de Sub OS para fila PCP / painéis.
    Status exclusivamente de tab_os_sub_os_andamento.ultimo_status=1.
    """
    situacao_filter = ""
    params: List[Any] = [display_setor, base_setor]
    clean_situacoes = _clean_filter_values(situacoes)
    if clean_situacoes:
        ph = ", ".join(["%s"] * len(clean_situacoes))
        situacao_filter = f" AND sa.situacao IN ({ph})"
        params.extend(clean_situacoes)

    query = f"""
    SELECT
        p.NroProtocolo AS nr_os,
        p.AnoProtocolo AS ano,
        d.Titulo AS titulo,
        d.TipoPublicacaoLink AS produto,
        sa.situacao AS situacao,
        %s AS setor,
        p.EntregData AS data_entrega,
        p.EntregPeriodo AS entreg_periodo,
        p.EntregPrazoLink AS prioridade,
        p.NomeUsuario AS nome_usuario,
        sa.data AS last_update,
        sa.observacao AS observacao,
        NULL AS pcp_ordem,
        NULL AS pcp_ultima_atualizacao,
        s.id AS sub_os_id,
        s.display_name AS display_label,
        c.nome AS componente_nome,
        p.NroProtocolo AS parent_nr_os,
        p.AnoProtocolo AS parent_ano,
        'sub_os' AS row_kind
    FROM tab_os_sub_os s
    INNER JOIN tab_os_sub_os_andamento sa
        ON sa.sub_os_id = s.id AND sa.ultimo_status = 1
    INNER JOIN tab_os_componentes c ON c.id = s.componente_id
    INNER JOIN tabProtocolos p
        ON p.NroProtocolo = s.nro_protocolo AND p.AnoProtocolo = s.ano_protocolo
    LEFT JOIN tabDetalhesServico d
        ON p.NroProtocolo = d.NroProtocoloLinkDet
       AND p.AnoProtocolo = d.AnoProtocoloLinkDet
    WHERE s.ativo = 1
      AND s.congelada = 0
      AND sa.setor = %s
      AND sa.situacao NOT IN {FINISHED_SITUACOES}
      AND EXISTS (
          SELECT 1
          FROM tab_os_sub_os s2
          INNER JOIN tab_os_sub_os_andamento sa2
              ON sa2.sub_os_id = s2.id AND sa2.ultimo_status = 1
          WHERE s2.nro_protocolo = s.nro_protocolo
            AND s2.ano_protocolo = s.ano_protocolo
            AND s2.ativo = 1
            AND s2.id <> s.id
            AND (
              TRIM(COALESCE(sa2.setor, '')) <> TRIM(COALESCE(sa.setor, ''))
              OR TRIM(COALESCE(sa2.situacao, '')) <> TRIM(COALESCE(sa.situacao, ''))
            )
      )
      {situacao_filter}
    ORDER BY
        {_QUEUE_PRIORITY_ORDER}
        , c.ordem ASC
        , s.id ASC
    """
    rows = db.execute_query(query, tuple(params))
    return list(rows or [])


def fetch_home_sub_os_rows_for_pairs(
    pairs: Sequence[Tuple[int, int]],
    *,
    setores: Optional[Sequence[str]] = None,
    situacoes: Optional[Sequence[str]] = None,
    include_finished: bool = True,
) -> List[Dict[str, Any]]:
    """Linhas Sub OS ativas para substituir a OS principal na home."""
    unique_pairs = list(dict.fromkeys((int(n), int(a)) for n, a in pairs))
    if not unique_pairs:
        return []

    pair_ph = ", ".join(["(%s, %s)"] * len(unique_pairs))
    params: List[Any] = []
    for nro, ano in unique_pairs:
        params.extend([nro, ano])

    extra: List[str] = []
    extra_params: List[Any] = []
    clean_setores = _clean_filter_values(setores)
    clean_situacoes = _clean_filter_values(situacoes)
    finished_sql = ""
    if not include_finished:
        finished_ph = ", ".join(["%s"] * len(FINISHED_SITUACOES))
        finished_sql = f" AND sa.situacao NOT IN ({finished_ph})"
        extra_params.extend(FINISHED_SITUACOES)
    if clean_setores:
        ph = ", ".join(["%s"] * len(clean_setores))
        extra.append(f"sa.setor IN ({ph})")
        extra_params.extend(clean_setores)
    if clean_situacoes:
        ph = ", ".join(["%s"] * len(clean_situacoes))
        extra.append(f"sa.situacao IN ({ph})")
        extra_params.extend(clean_situacoes)
    extra_sql = (" AND " + " AND ".join(extra)) if extra else ""
    params.extend(extra_params)

    query = f"""
    SELECT
        p.NroProtocolo AS nr_os,
        p.AnoProtocolo AS ano,
        sa.situacao AS situacao,
        sa.setor AS setor,
        sa.data AS last_update,
        sa.data AS data_entrega,
        sa.observacao AS observacao,
        s.id AS sub_os_id,
        s.display_name AS display_label,
        s.componente_id AS componente_id,
        c.nome AS componente_nome,
        p.NroProtocolo AS parent_nr_os,
        p.AnoProtocolo AS parent_ano,
        'sub_os' AS kind,
        1 AS is_sub_os,
        0 AS has_sub_os,
        0 AS sub_os_count,
        0 AS matched_via_sub_os
    FROM tab_os_sub_os s
    INNER JOIN tab_os_sub_os_andamento sa
        ON sa.sub_os_id = s.id AND sa.ultimo_status = 1
    INNER JOIN tab_os_componentes c ON c.id = s.componente_id
    INNER JOIN tabProtocolos p
        ON p.NroProtocolo = s.nro_protocolo AND p.AnoProtocolo = s.ano_protocolo
    WHERE (s.nro_protocolo, s.ano_protocolo) IN ({pair_ph})
      AND s.ativo = 1
      {finished_sql}
      {extra_sql}
    ORDER BY
        p.AnoProtocolo DESC,
        p.NroProtocolo DESC,
        c.ordem ASC,
        s.id ASC
    """
    rows = db.execute_query(query, tuple(params))
    result: List[Dict[str, Any]] = []
    for row in rows or []:
        mapped = dict(row)
        mapped["kind"] = "sub_os"
        mapped["is_sub_os"] = True
        mapped["has_sub_os"] = False
        mapped["matched_via_sub_os"] = False
        result.append(mapped)
    return result


def dedupe_queue_rows_with_sub_os(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Dedupe por (nr_os, ano, row_kind, sub_os_id) — permite main + sub_os na mesma OS."""
    seen: set[Tuple[Any, ...]] = set()
    unique: List[Dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        kind = row.get("row_kind") or "main_os"
        sub_id = row.get("sub_os_id")
        key = (row.get("nr_os"), row.get("ano"), kind, sub_id)
        if key in seen:
            continue
        seen.add(key)
        if kind == "main_os" and "row_kind" not in row:
            row = {**row, "row_kind": "main_os"}
        unique.append(row)
    return unique
