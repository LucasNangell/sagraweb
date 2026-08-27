"""Parser, mapeamento e conversões das licitações → estoque."""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException
from unittest.mock import MagicMock

from estoque_import_licitacoes import (
    NEW_SKUS,
    convert_to_estoque,
    is_kit_row,
    make_import_key,
    match_sku_codigo,
    parse_qty_unit,
    parse_row,
    parse_source_rows,
)
from routers import estoque_routes as routes
from services.estoque_service import _novo_custo_medio
from services.orcamento_admin_service import overlay_estoque_precos, tinta_policromia_custo
from services.orcamento_engine import calcular

from tests.test_orcamento_engine import P26_DIGITAL, _catalog


def test_resma_vira_250_folhas_e_unitario_dividido():
    conv = convert_to_estoque("Papel Offset 75g", 1, "RESMA", 250)
    assert conv["quantidade"] == 250
    assert conv["custo_unitario"] == pytest.approx(1.0)
    assert conv["unidade_estoque"] == "folha"


def test_caixa_chapa_vira_50_e_unitario_dividido():
    conv = convert_to_estoque(
        "CHAPA POSITIVA PARA IMPRESSORA HEIDELBERG SM74",
        2,
        "CAIXA",
        1900,
    )
    assert conv["quantidade"] == 100
    assert conv["custo_unitario"] == pytest.approx(38.0)


def test_galao_restaurador_vira_litros():
    conv = convert_to_estoque(
        "RESTAURADOR DE BLANQUETA (GALÃO DE 5 LITROS)",
        1,
        "GALAO",
        100,
    )
    assert conv["quantidade"] == 5
    assert conv["custo_unitario"] == pytest.approx(20.0)


def test_skip_kit_tintas_e_chapas():
    kit = {
        "descricao": "TINTAS OFFSET",
        "quantidade_raw": "-",
        "valor_unitario_raw": "-",
        "item": "1",
    }
    assert is_kit_row(kit)
    assert parse_row(kit) is None
    kit2 = {
        "descricao": "CHAPAS POSITIVAS E REVELADOR DE CHAPA",
        "quantidade_raw": "-",
        "valor_unitario_raw": "-",
        "item": "5",
    }
    assert is_kit_row(kit2)
    assert match_sku_codigo(kit2["descricao"]) is None


def test_parse_qty_resma_parenteses():
    qty, unit = parse_qty_unit("295 (RESMA)", None)
    assert qty == 295
    assert unit == "RESMA"


def test_mapa_skus_principais():
    assert match_sku_codigo("PAPEL OFFSET ALTA ALVURA 660 MM X 960 MM 75 G/M²") == "MAT-121"
    assert match_sku_codigo("PAPEL OFFSET ALTA ALVURA 760 mm X 1120 mm, 75 g/m²") == "MAT-122"
    assert match_sku_codigo("PAPEL OFFSET ALTA ALVURA 660 mm X 960 mm, 90 g/m²") == "MAT-123"
    assert match_sku_codigo("PAPEL OFFSET COM ALTA ALVURA, 1120 MM X 760 MM, 90 G/M²") == "MAT-124"
    assert match_sku_codigo("PAPEL COUCHÊ FOSCO 300 G/M²") == "MAT-103"
    assert match_sku_codigo("PAPEL ADESIVO 660 MM X 960 MM, 170 G/M²") == "MAT-173"
    assert match_sku_codigo("FILME DE BOPP FOSCO LARGURA 300 MM") == "MAT-080"
    assert match_sku_codigo("BOBINA DE BOPP ALTO BRILHO LARGURA 300 MM") == "MAT-072"


def test_novos_skus_partem_de_mat_152():
    codes = [c for c, *_ in NEW_SKUS]
    assert codes[0] == "MAT-152"
    assert "MAT-173" in codes
    assert all(c.startswith("MAT-") for c in codes)


def test_todas_linhas_nao_kit_mapeiam_e_keys_unicas():
    parsed = parse_source_rows()
    assert len(parsed) >= 140
    keys = [p["import_key"] for p in parsed]
    assert len(keys) == len(set(keys))
    again = [p["import_key"] for p in parse_source_rows()]
    assert keys == again
    assert all(p["sku_codigo"] for p in parsed)


def test_import_key_inclui_linha():
    row = {
        "licitacao": "90002-2025",
        "cnpj": "00.000.000/0001-00",
        "item": "1.2",
        "linha": 41,
        "descricao": "TINTA AMARELA",
    }
    key = make_import_key(row)
    assert "linha:41" in key
    assert "item:1.2" in key
    row["linha"] = 99
    assert make_import_key(row) != key


def test_media_ponderada_duas_entradas():
    medio = _novo_custo_medio(Decimal("10"), Decimal("2"), Decimal("10"), Decimal("4"))
    assert medio == Decimal("3")
    first = _novo_custo_medio(Decimal("0"), Decimal("0"), Decimal("5"), Decimal("2"))
    assert first == Decimal("2")


def test_overlay_p26_usa_custo_medio_do_estoque():
    insumo = {
        "codigo": "p26",
        "preco_unitario": 1.494,
        "preco_cadastro": 1.494,
        "custo_estoque": 3.58,
        "estoque_sku_codigo": "MAT-103",
    }
    out = overlay_estoque_precos([insumo])[0]
    assert out["preco_unitario"] == pytest.approx(3.58)
    assert out["preco_cadastro"] == pytest.approx(1.494)


def test_overlay_sem_custo_mantem_cadastro():
    insumo = {
        "codigo": "p26",
        "preco_unitario": 1.494,
        "preco_cadastro": 1.494,
        "custo_estoque": 0,
        "estoque_sku_codigo": "MAT-103",
    }
    out = overlay_estoque_precos([insumo])[0]
    assert out["preco_unitario"] == pytest.approx(1.494)
    assert out["custo_estoque"] is None


def test_t5_media_ponderada_cmy():
    skus = [
        {"custo_medio": 10, "quantidade": 1},
        {"custo_medio": 20, "quantidade": 1},
        {"custo_medio": 30, "quantidade": 2},
    ]
    assert tinta_policromia_custo(skus) == pytest.approx(22.5)
    incomplete = overlay_estoque_precos(
        [{"codigo": "t5", "preco_unitario": 19.536, "preco_cadastro": 19.536}],
        t5_skus=skus[:2],
    )[0]
    assert incomplete["preco_unitario"] == pytest.approx(19.536)


def test_motor_acompanha_custo_estoque_p26():
    p26 = overlay_estoque_precos(
        [
            {
                **P26_DIGITAL,
                "preco_cadastro": 1.494,
                "custo_estoque": 3.58,
                "estoque_sku_codigo": "MAT-103",
            }
        ]
    )[0]
    catalog = _catalog()
    catalog["insumos"] = [p26 if i.get("codigo") == "p26" else i for i in catalog["insumos"]]
    result = calcular(
        {
            "tiragem": 100,
            "tecnologia": "digital",
            "componentes": [
                {
                    "nome": "Marcador",
                    "tipo": "UNICO",
                    "menor_mm": 55,
                    "maior_mm": 200,
                    "paginas": 2,
                    "cor": True,
                    "frente_verso": True,
                    "papel_codigo": "p26",
                    "laminacao": True,
                    "laminacao_fv": False,
                }
            ],
        },
        catalog,
    )
    assert result["total"] == pytest.approx(124.90, abs=0.05)


def test_importar_licitacoes_requer_gerente():
    request = MagicMock()
    request.state.sagra_permissions = {"sb_estoque": True}
    with pytest.raises(HTTPException) as exc:
        routes.post_importar_licitacoes(request)
    assert exc.value.status_code == 403
