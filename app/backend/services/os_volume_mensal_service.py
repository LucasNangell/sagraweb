"""
Agregação mensal de volume de OS/SP para o painel global.

Substitui o download paginado do ano inteiro via /os/search no gráfico principal.
Usa a mesma fonte de andamento da busca (live/materializada via _resolve_andamento_join).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional

from database import db
from services.os_search_service import _resolve_andamento_join

logger = logging.getLogger(__name__)

VolumeCategory = Literal["em_andamento", "entregue", "cancelado"]

_CATEGORY_SQL = {
    "entregue": "TRIM(COALESCE({situacao}, '')) = 'Entregue'",
    "cancelado": "TRIM(COALESCE({situacao}, '')) IN ('Cancelado', 'Cancelada')",
    "em_andamento": (
        "TRIM(COALESCE({situacao}, '')) NOT IN ('Entregue', 'Cancelado', 'Cancelada')"
    ),
}


def _tipo_filters(include_os: bool, include_sp: bool) -> str:
    if include_os and include_sp:
        return ""
    if include_os and not include_sp:
        return " AND p.NroProtocolo < 5000"
    if include_sp and not include_os:
        return " AND p.NroProtocolo >= 5000"
    # Nenhum tipo: resultado vazio previsível
    return " AND 1=0"


def _category_case(situacao_col: str) -> str:
    return f"""
        CASE
            WHEN TRIM(COALESCE({situacao_col}, '')) = 'Entregue' THEN 'entregue'
            WHEN TRIM(COALESCE({situacao_col}, '')) IN ('Cancelado', 'Cancelada')
                THEN 'cancelado'
            ELSE 'em_andamento'
        END
    """


def execute_os_volume_mensal(
    *,
    ano: int,
    include_os: bool = True,
    include_sp: bool = True,
) -> Dict[str, Any]:
    """
    Contagens por mês (1–12) e categoria, filtrando AnoProtocolo = ano
    e agrupando pelo MONTH(DataEntrada) — mesmo critério do painel legado.
    """
    join_sql, situacao_col, _setor_col, _uses_mat = _resolve_andamento_join()
    tipo_sql = _tipo_filters(include_os, include_sp)
    category_expr = _category_case(situacao_col)

    query = f"""
    SELECT
        MONTH(p.DataEntrada) AS mes,
        {category_expr} AS categoria,
        COUNT(*) AS total
    FROM tabProtocolos AS p
    {join_sql}
    WHERE p.AnoProtocolo = %(ano)s
      AND p.DataEntrada IS NOT NULL
      {tipo_sql}
    GROUP BY MONTH(p.DataEntrada), {category_expr}
    """
    rows = db.execute_query(query, {"ano": int(ano)}) or []

    months = [
        {"month": m, "em_andamento": 0, "entregue": 0, "cancelado": 0}
        for m in range(1, 13)
    ]
    by_month = {m["month"]: m for m in months}

    for row in rows:
        mes = int(row.get("mes") or 0)
        if mes < 1 or mes > 12:
            continue
        cat = str(row.get("categoria") or "em_andamento").strip()
        total = int(row.get("total") or 0)
        bucket = by_month[mes]
        if cat in ("em_andamento", "entregue", "cancelado"):
            bucket[cat] = total

    return {"ano": int(ano), "months": months}


def fetch_os_volume_mensal_drill_rows(
    *,
    ano: int,
    month: int,
    category: VolumeCategory,
    include_os: bool = True,
    include_sp: bool = True,
    setor: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Linhas leves (setor/produto/situacao) para drill-down do gráfico do painel.
    month: 1–12. category: em_andamento | entregue | cancelado.
    """
    if month < 1 or month > 12:
        raise ValueError("month deve estar entre 1 e 12")
    if category not in _CATEGORY_SQL:
        raise ValueError("category inválida")

    join_sql, situacao_col, setor_col, _uses_mat = _resolve_andamento_join()
    tipo_sql = _tipo_filters(include_os, include_sp)
    cat_pred = _CATEGORY_SQL[category].format(situacao=situacao_col)

    setor_sql = ""
    params: Dict[str, Any] = {"ano": int(ano), "mes": int(month)}
    if setor:
        setor_sql = f" AND TRIM(COALESCE({setor_col}, '')) = %(setor)s"
        params["setor"] = setor.strip()

    # Produto via subselect escalar — evita inflar contagens com múltiplos detalhes.
    produto_scalar = """(
        SELECT d.TipoPublicacaoLink
        FROM tabDetalhesServico AS d
        WHERE d.NroProtocoloLinkDet = p.NroProtocolo
          AND d.AnoProtocoloLinkDet = p.AnoProtocolo
        LIMIT 1
    )"""

    query = f"""
    SELECT
        TRIM(COALESCE({setor_col}, '')) AS setor,
        TRIM(COALESCE({produto_scalar}, '')) AS produto,
        TRIM(COALESCE({situacao_col}, '')) AS situacao
    FROM tabProtocolos AS p
    {join_sql}
    WHERE p.AnoProtocolo = %(ano)s
      AND p.DataEntrada IS NOT NULL
      AND MONTH(p.DataEntrada) = %(mes)s
      AND ({cat_pred})
      {tipo_sql}
      {setor_sql}
    """
    return list(db.execute_query(query, params) or [])
