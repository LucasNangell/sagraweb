"""Persistência e mapeamento de tempo/mão de obra por acabamento."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from services.orcamento_os_service import _componente_from_lote, _merge_acabamento_items
from services.orcamento_produto_passos_service import require_catalog_category


def test_require_catalog_category_recusa_produto():
    with patch(
        "services.system_catalog_service.get_catalog_item",
        side_effect=KeyError("não encontrado"),
    ):
        with pytest.raises(ValueError, match="acabamento"):
            require_catalog_category(1, "acabamento")


def test_require_catalog_category_aceita_acabamento():
    item = {"id": 30, "label": "Laminação", "category": "acabamento"}
    with patch("services.system_catalog_service.get_catalog_item", return_value=item):
        assert require_catalog_category(30, "acabamento")["label"] == "Laminação"


def test_componente_from_lote_leva_catalog_id_do_techspec():
    acab = {
        "laminacao": False,
        "laminacao_fv": False,
        "espiral": False,
        "grampo": False,
        "cola": False,
        "capa_pvc": False,
    }
    comp = _componente_from_lote(
        nome="Capa",
        tipo="CAPA",
        lote={"paginas": 4},
        fallback={},
        acab=acab,
        insumos=[],
        acabamentos_os=[{"catalog_id": 8, "label": "Espiral"}],
    )
    assert comp["acabamentos"] == [{"label": "Espiral", "catalog_id": 8}]


def test_merge_acabamento_nao_duplica_mesmo_id():
    merged = _merge_acabamento_items(
        [{"catalog_id": 8, "label": "Espiral"}],
        [{"catalog_id": 8, "label": "Espiral wire-o"}],
        [{"label": "Grampo"}],
    )
    assert len(merged) == 2
    assert merged[0]["catalog_id"] == 8
    assert merged[1]["label"] == "Grampo"
