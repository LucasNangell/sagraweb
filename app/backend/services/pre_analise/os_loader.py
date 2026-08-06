"""Carrega dados da OS para pré-análise."""
from __future__ import annotations

from typing import Any, Dict

from database import db


def load_os_details(ano: int, os_id: int) -> Dict[str, Any]:
    query = """
    SELECT
        d.Titulo, d.TipoPublicacaoLink, d.FormatoLink, d.MaquinaLink,
        d.Tiragem, d.Pags, d.DescAcabamento, d.Observ,
        d.Cores, d.CoresDescricao
    FROM tabProtocolos AS p
    LEFT JOIN tabDetalhesServico AS d
        ON p.NroProtocolo = d.NroProtocoloLinkDet
        AND p.AnoProtocolo = d.AnoProtocoloLinkDet
    WHERE p.NroProtocolo = %(id)s AND p.AnoProtocolo = %(ano)s
  """
    rows = db.execute_query(query, {"id": os_id, "ano": ano})
    if not rows:
        return {}
    return dict(rows[0])
