"""Consulta da listagem Cotas Graf com filtros (espelha padrões da busca de OS)."""

from __future__ import annotations

from typing import Any, List, Optional, Tuple

FINISHED_SITUACOES = ("Entregue", "Cancelada", "Cancelado")
SITUACAO_COTAS_ATUALIZADO = "Atualizado"
SITUACAO_COTAS_PENDENTE = "Pendente"
VALID_SITUACAO_COTAS = frozenset({SITUACAO_COTAS_ATUALIZADO, SITUACAO_COTAS_PENDENTE})
SOLICITANTE_EXPR = "COALESCE(NULLIF(TRIM(p.Solicitante), ''), p.NomeUsuario)"
CLIENTE_SOLICITANTE_EXPR = (
    "COALESCE(NULLIF(TRIM(cc.SolicitanteExibicao), ''), cc.NomeUsuario)"
)
_TEXT_COLLATE = "utf8mb4_unicode_ci"


def _collate_eq(left: str, right: str) -> str:
    return f"{left} COLLATE {_TEXT_COLLATE} = {right} COLLATE {_TEXT_COLLATE}"


def _collate_param_eq(column: str, param_name: str) -> str:
    return f"{column} COLLATE {_TEXT_COLLATE} = %({param_name})s"


def _clean_multi(values: Optional[List[str]]) -> List[str]:
    seen: set[str] = set()
    result: List[str] = []
    for raw in values or []:
        item = (raw or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _build_andamento_join(protocol_alias: str = "p") -> str:
    return f"""
    LEFT JOIN tabAndamento AS a
        ON a.CodStatus = (
            SELECT a2.CodStatus
            FROM tabAndamento AS a2
            WHERE a2.NroProtocoloLink = {protocol_alias}.NroProtocolo
              AND a2.AnoProtocoloLink = {protocol_alias}.AnoProtocolo
              AND a2.UltimoStatus = 1
            ORDER BY a2.`Data` DESC, a2.CodStatus DESC
            LIMIT 1
        )
    """


def _append_cotas_graf_filters(
    filters: str,
    params: dict[str, Any],
    *,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    ano_mode: str = "specific",
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = None,
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = None,
    situacao_cotas: Optional[List[str]] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
) -> str:
    if not include_finished:
        finished = ", ".join(f"'{s}'" for s in FINISHED_SITUACOES)
        filters += f" AND (a.SituacaoLink IS NULL OR a.SituacaoLink NOT IN ({finished}))"

    if not include_os:
        filters += " AND p.NroProtocolo >= 5000"
    if not include_sp:
        filters += " AND p.NroProtocolo < 5000"

    if nr_os:
        filters += " AND p.NroProtocolo = %(nr_os)s"
        params["nr_os"] = nr_os

    if ano:
        mode = (ano_mode or "specific").strip().lower()
        if mode == "from":
            filters += " AND p.AnoProtocolo >= %(ano)s"
        else:
            filters += " AND p.AnoProtocolo = %(ano)s"
        params["ano"] = ano

    clean_produtos = _clean_multi(produtos)
    if clean_produtos:
        placeholders = ", ".join(f"%(prod_sel_{i})s" for i in range(len(clean_produtos)))
        filters += f"""
         AND EXISTS (
            SELECT 1 FROM tabDetalhesServico AS d_sel
            WHERE d_sel.NroProtocoloLinkDet = p.NroProtocolo
              AND d_sel.AnoProtocoloLinkDet = p.AnoProtocolo
              AND d_sel.TipoPublicacaoLink IN ({placeholders})
         )"""
        for i, val in enumerate(clean_produtos):
            params[f"prod_sel_{i}"] = val
    elif produto and produto.strip():
        filters += """
         AND EXISTS (
            SELECT 1 FROM tabDetalhesServico AS d_sel
            WHERE d_sel.NroProtocoloLinkDet = p.NroProtocolo
              AND d_sel.AnoProtocoloLinkDet = p.AnoProtocolo
              AND d_sel.TipoPublicacaoLink LIKE %(produto_like)s
         )"""
        params["produto_like"] = f"%{produto.strip()}%"

    if titulo and titulo.strip():
        filters += """
         AND EXISTS (
            SELECT 1 FROM tabDetalhesServico AS d_tit
            WHERE d_tit.NroProtocoloLinkDet = p.NroProtocolo
              AND d_tit.AnoProtocoloLinkDet = p.AnoProtocolo
              AND d_tit.Titulo LIKE %(titulo_like)s
         )"""
        params["titulo_like"] = f"%{titulo.strip()}%"

    clean_solicitantes = _clean_multi(solicitantes)
    if clean_solicitantes:
        placeholders = ", ".join(f"%(sol_sel_{i})s" for i in range(len(clean_solicitantes)))
        filters += f" AND {SOLICITANTE_EXPR} IN ({placeholders})"
        for i, val in enumerate(clean_solicitantes):
            params[f"sol_sel_{i}"] = val
    elif solicitante and solicitante.strip():
        filters += f" AND {SOLICITANTE_EXPR} LIKE %(solicitante_like)s"
        params["solicitante_like"] = f"%{solicitante.strip()}%"

    clean_situacao_cotas = [
        s for s in _clean_multi(situacao_cotas) if s in VALID_SITUACAO_COTAS
    ]
    if clean_situacao_cotas and len(clean_situacao_cotas) < len(VALID_SITUACAO_COTAS):
        parts: List[str] = []
        if SITUACAO_COTAS_ATUALIZADO in clean_situacao_cotas:
            parts.append("COALESCE(p.ReqEntregue, 0) = 1")
        if SITUACAO_COTAS_PENDENTE in clean_situacao_cotas:
            parts.append("COALESCE(p.ReqEntregue, 0) = 0")
        if parts:
            filters += f" AND ({' OR '.join(parts)})"

    return filters


def _has_protocol_scope_filters(
    *,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = None,
    titulo: Optional[str] = None,
    situacao_cotas: Optional[List[str]] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
) -> bool:
    """Filtros que exigem cruzamento com tabProtocolos (consulta mais pesada)."""
    if nr_os or produto or produtos or titulo:
        return True
    if not include_os or not include_sp or include_finished:
        return True
    clean_situacao = [
        s for s in _clean_multi(situacao_cotas) if s in VALID_SITUACAO_COTAS
    ]
    if clean_situacao and len(clean_situacao) < len(VALID_SITUACAO_COTAS):
        return True
    return False


def _append_cliente_solicitante_filters(
    filters: str,
    params: dict[str, Any],
    *,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = None,
) -> str:
    clean_solicitantes = _clean_multi(solicitantes)
    if clean_solicitantes:
        placeholders = ", ".join(f"%(cc_sol_{i})s" for i in range(len(clean_solicitantes)))
        filters += f" AND {CLIENTE_SOLICITANTE_EXPR} IN ({placeholders})"
        for i, val in enumerate(clean_solicitantes):
            params[f"cc_sol_{i}"] = val
    elif solicitante and solicitante.strip():
        filters += f" AND {CLIENTE_SOLICITANTE_EXPR} LIKE %(cliente_solicitante_like)s"
        params["cliente_solicitante_like"] = f"%{solicitante.strip()}%"
    return filters


def build_cotas_graf_query(
    *,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    ano_mode: str = "specific",
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = None,
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = None,
    situacao_cotas: Optional[List[str]] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
    limit: int = 200,
    offset: int = 0,
) -> Tuple[str, str, dict[str, Any]]:
    """Retorna (sql_list, sql_count, params)."""
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    andamento_join = _build_andamento_join()

    filters = " WHERE 1=1"
    filters = _append_cotas_graf_filters(
        filters,
        params,
        nr_os=nr_os,
        ano=ano,
        ano_mode=ano_mode,
        produto=produto,
        produtos=produtos,
        titulo=titulo,
        solicitante=solicitante,
        solicitantes=solicitantes,
        situacao_cotas=situacao_cotas,
        include_finished=include_finished,
        include_os=include_os,
        include_sp=include_sp,
    )

    base_from = f"""
    FROM tabProtocolos AS p
    {andamento_join}
    LEFT JOIN tabDetalhesServico AS d
        ON p.NroProtocolo = d.NroProtocoloLinkDet
       AND p.AnoProtocolo = d.AnoProtocoloLinkDet
    """

    list_sql = f"""
    SELECT
        p.NroProtocolo AS nr_os,
        p.AnoProtocolo AS ano,
        d.TipoPublicacaoLink AS produto,
        {SOLICITANTE_EXPR} AS solicitante,
        d.Titulo AS titulo,
        p.ReqEntregue AS req_entregue
    {base_from}
    {filters}
    ORDER BY p.AnoProtocolo DESC, p.NroProtocolo DESC
    LIMIT %(limit)s OFFSET %(offset)s
    """

    count_sql = f"""
    SELECT COUNT(*) AS total
    {base_from}
    {filters}
    """

    return list_sql, count_sql, params


def build_cotas_graf_solicitantes_cotas_query(
    *,
    semestre_id: int,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    ano_mode: str = "specific",
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = None,
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = None,
    situacao_cotas: Optional[List[str]] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
    limit: int = 500,
) -> Tuple[str, str, dict[str, Any]]:
    """Retorna (sql_list, sql_count, params) para cotas dos solicitantes."""
    if _has_protocol_scope_filters(
        nr_os=nr_os,
        ano=ano,
        produto=produto,
        produtos=produtos,
        titulo=titulo,
        situacao_cotas=situacao_cotas,
        include_finished=include_finished,
        include_os=include_os,
        include_sp=include_sp,
    ):
        return _build_solicitantes_cotas_query_via_protocolos(
            semestre_id=semestre_id,
            nr_os=nr_os,
            ano=ano,
            ano_mode=ano_mode,
            produto=produto,
            produtos=produtos,
            titulo=titulo,
            solicitante=solicitante,
            solicitantes=solicitantes,
            situacao_cotas=situacao_cotas,
            include_finished=include_finished,
            include_os=include_os,
            include_sp=include_sp,
            limit=limit,
        )
    return _build_solicitantes_cotas_query_cache(
        semestre_id=semestre_id,
        solicitante=solicitante,
        solicitantes=solicitantes,
        limit=limit,
    )


def _build_solicitantes_cotas_query_cache(
    *,
    semestre_id: int,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = None,
    limit: int = 500,
) -> Tuple[str, str, dict[str, Any]]:
    """Leitura rápida de tabCotaCliente (dados pré-calculados)."""
    params: dict[str, Any] = {"semestre_id": semestre_id, "limit": limit}
    filters = " WHERE cc.SemestreID = %(semestre_id)s"
    filters = _append_cliente_solicitante_filters(
        filters,
        params,
        solicitante=solicitante,
        solicitantes=solicitantes,
    )

    list_sql = f"""
    SELECT
        {CLIENTE_SOLICITANTE_EXPR} AS solicitante,
        cc.CategoriaLink AS categoria,
        cc.CodUsuarioLink AS cod_usuario,
        cc.NomeUsuario AS nome_usuario,
        cc.ConsumoOs AS consumo_os,
        COALESCE(
            cc.LimiteOs,
            CASE WHEN LOWER(TRIM(cc.CategoriaLink)) LIKE 'deputad%%'
                 THEN s.LimiteOsDeputado ELSE NULL END
        ) AS limite_os,
        cc.ConsumoSp AS consumo_sp,
        COALESCE(
            cc.LimiteSp,
            CASE WHEN LOWER(TRIM(cc.CategoriaLink)) LIKE 'deputad%%'
                 THEN s.LimiteSpDeputado ELSE NULL END
        ) AS limite_sp,
        s.Ano AS semestre_ano,
        s.NumeroSemestre AS semestre_numero
    FROM tabCotaCliente AS cc
    INNER JOIN tabCotaSemestre AS s ON s.ID = cc.SemestreID
    {filters}
    ORDER BY solicitante ASC, cc.CategoriaLink ASC
    LIMIT %(limit)s
    """

    count_sql = f"""
    SELECT COUNT(*) AS total
    FROM tabCotaCliente AS cc
    {filters}
    """
    return list_sql, count_sql, params


def _build_solicitantes_cotas_query_via_protocolos(
    *,
    semestre_id: int,
    nr_os: Optional[int] = None,
    ano: Optional[int] = None,
    ano_mode: str = "specific",
    produto: Optional[str] = None,
    produtos: Optional[List[str]] = None,
    titulo: Optional[str] = None,
    solicitante: Optional[str] = None,
    solicitantes: Optional[List[str]] = None,
    situacao_cotas: Optional[List[str]] = None,
    include_finished: bool = False,
    include_os: bool = True,
    include_sp: bool = True,
    limit: int = 500,
) -> Tuple[str, str, dict[str, Any]]:
    """Cruzamento com tabProtocolos quando há filtros de escopo de OS."""
    params: dict[str, Any] = {"semestre_id": semestre_id, "limit": limit}
    andamento_join = _build_andamento_join()

    filters = " WHERE 1=1"
    filters = _append_cotas_graf_filters(
        filters,
        params,
        nr_os=nr_os,
        ano=ano,
        ano_mode=ano_mode,
        produto=produto,
        produtos=produtos,
        titulo=titulo,
        solicitante=solicitante,
        solicitantes=solicitantes,
        situacao_cotas=situacao_cotas,
        include_finished=include_finished,
        include_os=include_os,
        include_sp=include_sp,
    )

    base_from = f"""
    FROM tabProtocolos AS p
    {andamento_join}
    """

    agg_sql = f"""
    SELECT
        p.CodUsuarioLink AS cod_usuario,
        p.CategoriaLink AS categoria,
        p.NomeUsuario AS nome_usuario,
        MAX({SOLICITANTE_EXPR}) AS solicitante
    {base_from}
    {filters}
    GROUP BY p.CodUsuarioLink, p.CategoriaLink, p.NomeUsuario
    """

    list_sql = f"""
    SELECT
        agg.solicitante,
        agg.categoria,
        agg.cod_usuario,
        agg.nome_usuario,
        COALESCE(cc.ConsumoOs, 0) AS consumo_os,
        COALESCE(
            cc.LimiteOs,
            CASE WHEN LOWER(TRIM(agg.categoria)) LIKE 'deputad%%'
                 THEN s.LimiteOsDeputado ELSE NULL END
        ) AS limite_os,
        COALESCE(cc.ConsumoSp, 0) AS consumo_sp,
        COALESCE(
            cc.LimiteSp,
            CASE WHEN LOWER(TRIM(agg.categoria)) LIKE 'deputad%%'
                 THEN s.LimiteSpDeputado ELSE NULL END
        ) AS limite_sp,
        s.Ano AS semestre_ano,
        s.NumeroSemestre AS semestre_numero
    FROM (
        {agg_sql}
    ) AS agg
    INNER JOIN tabCotaSemestre AS s ON s.ID = %(semestre_id)s
    INNER JOIN tabCotaCliente AS cc
        ON cc.SemestreID = s.ID
       AND {_collate_eq("cc.CodUsuarioLink", "agg.cod_usuario")}
       AND {_collate_eq("cc.CategoriaLink", "agg.categoria")}
       AND {_collate_eq("cc.NomeUsuario", "agg.nome_usuario")}
    ORDER BY agg.solicitante ASC, agg.categoria ASC
    LIMIT %(limit)s
    """

    count_sql = f"""
    SELECT COUNT(*) AS total
    FROM (
        {agg_sql}
    ) AS agg
    """

    return list_sql, count_sql, params


def build_solicitante_consumo_historico_query(
    *,
    semestre_id: int,
    cod_usuario: str,
    categoria: str,
    nome_usuario: str,
    limit: int = 500,
) -> Tuple[str, dict[str, Any]]:
    """Histórico de consumo do solicitante no semestre (tabCotaMovimento)."""
    params: dict[str, Any] = {
        "semestre_id": semestre_id,
        "cod_usuario": cod_usuario,
        "categoria": categoria,
        "nome_usuario": nome_usuario,
        "limit": limit,
    }
    sql = f"""
    SELECT
        m.NroProtocolo AS nr_os,
        m.AnoProtocolo AS ano,
        m.Tipo AS tipo,
        m.ValorCota AS cota_consumida,
        m.DataEntrada AS data_entrada,
        COALESCE(d.TipoPublicacaoLink, m.ProdutoExterno) AS produto,
        COALESCE(d.Titulo, m.TituloExterno) AS titulo,
        m.Origem AS origem,
        m.ReferenciaExterna AS referencia_externa
    FROM tabCotaMovimento AS m
    LEFT JOIN tabDetalhesServico AS d
        ON m.Origem = 'backfill'
       AND m.NroProtocolo > 0
       AND d.NroProtocoloLinkDet = m.NroProtocolo
       AND d.AnoProtocoloLinkDet = m.AnoProtocolo
    WHERE m.SemestreID = %(semestre_id)s
      AND {_collate_param_eq("m.CodUsuarioLink", "cod_usuario")}
      AND {_collate_param_eq("m.CategoriaLink", "categoria")}
      AND {_collate_param_eq("m.NomeUsuario", "nome_usuario")}
    ORDER BY m.DataEntrada DESC, m.AnoProtocolo DESC, m.NroProtocolo DESC
    LIMIT %(limit)s
    """
    return sql, params
