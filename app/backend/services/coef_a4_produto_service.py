"""Coeficiente A4 por produto de papelaria — derivado das cotas consumidas (tabProtocolos)."""
from __future__ import annotations

import logging
import statistics
from typing import Any, Dict, List, Optional

from database import db
from os_calc_fields import PAPELARIA_OS_MIN

logger = logging.getLogger(__name__)

_COEF_MIN = 0.0
_COEF_MAX = 1000.0
_MIN_AMOSTRAS_SEED = 1


def _coef_from_row(row: Dict[str, Any]) -> Optional[float]:
    pags = float(row.get("pags") or 0)
    tiragem = float(row.get("tiragem") or 0)
    cota = float(row.get("cota") or 0)
    if pags <= 0 or tiragem <= 0 or cota <= 0:
        return None
    coef = (pags * tiragem) / cota
    if coef <= _COEF_MIN or coef > _COEF_MAX:
        return None
    return coef


def _fetch_protocolo_coef_rows() -> List[Dict[str, Any]]:
    return db.execute_query(
        """
        SELECT
            TRIM(d.TipoPublicacaoLink) AS produto,
            COALESCE(d.Pags, 0) AS pags,
            COALESCE(d.Tiragem, 0) AS tiragem,
            COALESCE(p.CotaRepro, 0) AS cota
        FROM tabProtocolos AS p
        INNER JOIN tabDetalhesServico AS d
            ON p.NroProtocolo = d.NroProtocoloLinkDet
           AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo >= %s
          AND TRIM(COALESCE(d.TipoPublicacaoLink, '')) <> ''
        """,
        (PAPELARIA_OS_MIN,),
    ) or []


def calcular_coef_a4_por_produto_papelaria() -> Dict[str, Dict[str, Any]]:
    """Mediana de (páginas × tiragem) / cota por produto de papelaria."""
    by_prod: Dict[str, List[float]] = {}
    for row in _fetch_protocolo_coef_rows():
        produto = str(row.get("produto") or "").strip()
        if not produto:
            continue
        coef = _coef_from_row(row)
        if coef is None:
            continue
        by_prod.setdefault(produto, []).append(coef)

    result: Dict[str, Dict[str, Any]] = {}
    for produto, valores in sorted(by_prod.items()):
        if len(valores) < _MIN_AMOSTRAS_SEED:
            continue
        mediana = round(statistics.median(valores), 4)
        if mediana <= 0:
            continue
        result[produto] = {
            "produto": produto,
            "coeficiente": mediana,
            "amostras": len(valores),
        }
    return result


def tabela_coef_a4_vazia() -> bool:
    rows = db.execute_query("SELECT COUNT(*) AS total FROM tabCoefA4Produto")
    return int((rows[0] or {}).get("total") or 0) == 0


def seed_coef_a4_produto_from_protocolos(*, force: bool = False) -> int:
    """
    Popula tabCoefA4Produto a partir das OS de papelaria com cota registrada.
    Por padrão só executa quando a tabela está vazia.
    """
    if not force and not tabela_coef_a4_vazia():
        return 0

    calculados = calcular_coef_a4_por_produto_papelaria()
    if not calculados:
        logger.warning("Nenhum coeficiente A4 derivado para produtos de papelaria.")
        return 0

    inseridos = 0
    for item in calculados.values():
        db.execute_query(
            """
            INSERT INTO tabCoefA4Produto (Produto, Coeficiente, Amostras)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                Coeficiente = VALUES(Coeficiente),
                Amostras = VALUES(Amostras)
            """,
            (item["produto"], item["coeficiente"], item["amostras"]),
        )
        inseridos += 1

    logger.info(
        "tabCoefA4Produto: %s produto(s) de papelaria com coeficiente A4.",
        inseridos,
    )
    return inseridos


def listar_coef_a4_produtos() -> List[Dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT Produto AS produto, Coeficiente AS coeficiente, Amostras AS amostras
        FROM tabCoefA4Produto
        ORDER BY Produto ASC
        """
    ) or []
    return [
        {
            "produto": str(r.get("produto") or "").strip(),
            "coeficiente": float(r.get("coeficiente") or 0),
            "amostras": int(r.get("amostras") or 0),
        }
        for r in rows
        if str(r.get("produto") or "").strip()
    ]


def obter_coef_a4_por_produto(produto: Optional[str]) -> Optional[float]:
    nome = (produto or "").strip()
    if not nome:
        return None
    rows = db.execute_query(
        """
        SELECT Coeficiente AS coeficiente
        FROM tabCoefA4Produto
        WHERE Produto = %s
        LIMIT 1
        """,
        (nome,),
    )
    if not rows:
        return None
    coef = float(rows[0].get("coeficiente") or 0)
    return coef if coef > 0 else None
