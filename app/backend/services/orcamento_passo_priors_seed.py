"""Aplica priors de etapas de orçamento via replace_passos (uma vez por versão)."""
from __future__ import annotations

import logging
from typing import Any, Optional

from database import db
from services.orcamento_passo_priors import (
    ACABAMENTO_PASSOS,
    PASSOS_PRIORS_VERSAO,
    bind_funcoes,
    passos_para_produto,
    produtos_com_passos,
)
from services.orcamento_produto_passos_service import (
    ensure_produto_catalog_id,
    replace_passos,
)

logger = logging.getLogger(__name__)

_PARAM_VERSAO = "passos_priors_versao"
_PARAM_PESSOAL = "pessoal_por_hora"
_PONTO_SEED = "seed-priors"


def _ler_versao() -> int:
    rows = db.execute_query(
        "SELECT valor FROM tab_orcamento_parametro WHERE chave = %s LIMIT 1",
        (_PARAM_VERSAO,),
    ) or []
    if not rows:
        return 0
    raw = str((rows[0] or {}).get("valor") or "0").strip()
    try:
        return int(float(raw))
    except (TypeError, ValueError):
        return 0


def _upsert_parametro(chave: str, valor: str, tipo: str, descricao: str, ponto: Optional[str]) -> None:
    db.execute_query(
        """
        INSERT INTO tab_orcamento_parametro (chave, valor, tipo, descricao, atualizado_por)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            valor = VALUES(valor),
            tipo = VALUES(tipo),
            descricao = VALUES(descricao),
            atualizado_por = VALUES(atualizado_por)
        """,
        (chave, valor, tipo, descricao, ponto),
    )


def _codigo_to_id() -> dict[str, int]:
    rows = db.execute_query(
        "SELECT id, codigo FROM tab_custo_funcao WHERE codigo IS NOT NULL AND ativo = 1"
    ) or []
    out: dict[str, int] = {}
    for row in rows:
        codigo = str(row.get("codigo") or "").strip()
        if not codigo:
            continue
        out[codigo] = int(row["id"])
    return out


def _ensure_acabamento(rotulo: str, ponto: Optional[str]) -> dict:
    from services.system_catalog_service import get_or_create_catalog_item

    return get_or_create_catalog_item("acabamento", rotulo, updated_by_ponto=ponto)


def seed_orcamento_passos_priors(
    *,
    force: bool = False,
    ponto: Optional[str] = None,
) -> dict[str, Any]:
    """Grava etapas de todos os produtos/acabamentos mapeados.

    Sem ``force``, só aplica se a versão no banco for menor que
    ``PASSOS_PRIORS_VERSAO``.
    """
    atual = _ler_versao()
    if not force and atual >= PASSOS_PRIORS_VERSAO:
        logger.info(
            "Orçamento: priors de etapas já na versão %s (código %s)",
            atual,
            PASSOS_PRIORS_VERSAO,
        )
        return {
            "applied": False,
            "versao": atual,
            "versao_codigo": PASSOS_PRIORS_VERSAO,
            "produtos": 0,
            "acabamentos": 0,
        }

    autor = (ponto or "").strip() or _PONTO_SEED
    codigo_to_id = _codigo_to_id()
    n_produtos = 0
    n_acab = 0

    for rotulo in produtos_com_passos():
        passos = passos_para_produto(rotulo) or []
        item = ensure_produto_catalog_id(rotulo, ponto=autor)
        catalog_id = int(item["id"])
        replace_passos(catalog_id, bind_funcoes(passos, codigo_to_id), rotulo=rotulo)
        n_produtos += 1

    for rotulo, passos in ACABAMENTO_PASSOS.items():
        item = _ensure_acabamento(rotulo, autor)
        catalog_id = int(item["id"])
        replace_passos(catalog_id, bind_funcoes(passos, codigo_to_id), rotulo=rotulo)
        n_acab += 1

    _upsert_parametro(
        _PARAM_VERSAO,
        str(PASSOS_PRIORS_VERSAO),
        "number",
        "Versão dos priors de etapas de orçamento já aplicados",
        autor,
    )
    _upsert_parametro(
        _PARAM_PESSOAL,
        "1",
        "bool",
        "Usar custo/hora das etapas em vez da faixa/87%",
        autor,
    )
    logger.info(
        "Orçamento: priors v%s aplicados (%s produtos, %s acabamentos)",
        PASSOS_PRIORS_VERSAO,
        n_produtos,
        n_acab,
    )
    return {
        "applied": True,
        "versao": PASSOS_PRIORS_VERSAO,
        "versao_codigo": PASSOS_PRIORS_VERSAO,
        "produtos": n_produtos,
        "acabamentos": n_acab,
    }


def seed_orcamento_passos_priors_if_stale() -> dict[str, Any]:
    return seed_orcamento_passos_priors(force=False)
