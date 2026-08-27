"""Regressão do motor de orçamento Digital/Offset."""
from __future__ import annotations

import pytest

from services.orcamento_engine import calcular, match_papel, suggest_formato

P26_DIGITAL = {
    "codigo": "p26",
    "categoria": "papel",
    "especificacao": "Papel Couchê fosco 300gr (66x96cm)",
    "preco_unitario": 3.58,
    "rendimento_a4": 8,
    "ativo": True,
    "aliases": ["cf 300", "couchê fosco 300"],
}

BOPP = {
    "codigo": "b0",
    "categoria": "bopp",
    "especificacao": "Bobina BOPP",
    "preco_unitario": 848.5,
    "ativo": True,
}

CHAPA = {
    "codigo": "c4",
    "categoria": "chapa",
    "especificacao": "Chapa SM 74",
    "preco_unitario": 38.0,
    "ativo": True,
}

T5 = {
    "codigo": "t5",
    "categoria": "tinta",
    "especificacao": "Policromia",
    "preco_unitario": 19.536,
    "ativo": True,
}

T1 = {
    "codigo": "t1",
    "categoria": "tinta",
    "especificacao": "Preto",
    "preco_unitario": 14.97,
    "ativo": True,
}

G1 = {
    "codigo": "g1",
    "categoria": "grampo",
    "especificacao": "Grampo",
    "preco_unitario": 70 / 3000,
    "ativo": True,
}

FORMATOS = [
    {"codigo": "A6", "menor_mm": 115, "maior_mm": 160, "fator_a4": 4, "ordem": 10, "ativo": True},
    {"codigo": "A5", "menor_mm": 160, "maior_mm": 235, "fator_a4": 2, "ordem": 20, "ativo": True},
    {"codigo": "A4", "menor_mm": 235, "maior_mm": 325, "fator_a4": 1, "ordem": 30, "ativo": True},
    {"codigo": "A3", "menor_mm": 325, "maior_mm": 475, "fator_a4": 0.5, "ordem": 40, "ativo": True},
]

FAIXAS = [
    {"limite_inf": 1, "limite_sup": 999, "percentual": 0.80, "ativo": True},
    {"limite_inf": 1000, "limite_sup": 4999, "percentual": 0.515, "ativo": True},
    {"limite_inf": 5000, "limite_sup": None, "percentual": 0.22, "ativo": True},
]

PARAMS = {
    "clique_digital_pb": 0.073,
    "clique_digital_cor": 0.28,
    "acerto_offset_folhas": 50,
    "aliquota_energia": 0.07,
    "aliquota_depreciacao": 0.10,
    "aliquota_perdas": 0.03,
    "aliquota_manutencao": 0.05,
    "aliquota_indiretos_digital": 0.87,
    "aplicar_diagramacao": 0,
    "bopp_metros": 1500,
    "bopp_codigo": "b0",
    "chapa_codigo_padrao": "c4",
    "tinta_cor_codigo": "t5",
    "tinta_pb_codigo": "t1",
    "grampo_codigo": "g1",
    "grampos_por_exemplar": 2,
    "grampo_max_paginas": 80,
}


def _catalog(extra_insumos=None):
    return {
        "insumos": [P26_DIGITAL, BOPP, CHAPA, T5, T1, G1, *(extra_insumos or [])],
        "parametros": dict(PARAMS),
        "formatos": FORMATOS,
        "faixas": FAIXAS,
    }


def test_formato_marcador_a5():
    fmt = suggest_formato(55, 200, FORMATOS)
    assert fmt is not None
    assert fmt["codigo"] == "A5"


def test_match_papel_cf_300():
    found = match_papel("Couchê fosco 300g", [P26_DIGITAL])
    assert found is not None
    assert found["codigo"] == "p26"


def test_marcador_digital_124_90():
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
        _catalog(),
    )
    digital = result["digital"]
    assert digital["custo_papel"] == pytest.approx(44.75, abs=0.02)
    assert digital["custo_clique"] == pytest.approx(28.00, abs=0.02)
    assert digital["custo_acabamento"] == pytest.approx(7.07, abs=0.02)
    assert digital["custo_indiretos"] == pytest.approx(45.08, abs=0.02)
    assert result["total"] == pytest.approx(124.90, abs=0.05)
    assert result["tecnologia_escolhida"] == "digital"


def test_offset_dois_componentes_chapas_e_indiretos():
    capa_papel = {
        "codigo": "p8",
        "categoria": "papel",
        "especificacao": "Offset 240g",
        "preco_unitario": 1.37,
        "rendimento_a4": 8,
        "ativo": True,
    }
    miolo_papel = {
        "codigo": "p2",
        "categoria": "papel",
        "especificacao": "Offset 90g",
        "preco_unitario": 0.43,
        "rendimento_a4": 8,
        "ativo": True,
    }
    result = calcular(
        {
            "tiragem": 500,
            "tecnologia": "offset",
            "componentes": [
                {
                    "nome": "Capa",
                    "tipo": "CAPA",
                    "menor_mm": 210,
                    "maior_mm": 297,
                    "paginas": 4,
                    "cor": True,
                    "frente_verso": True,
                    "verso_cor": True,
                    "papel_codigo": "p8",
                    "laminacao": True,
                },
                {
                    "nome": "Miolo",
                    "tipo": "MIOLO",
                    "menor_mm": 210,
                    "maior_mm": 297,
                    "paginas": 32,
                    "cor": False,
                    "frente_verso": True,
                    "papel_codigo": "p2",
                    "grampo": True,
                },
            ],
        },
        _catalog([capa_papel, miolo_papel]),
    )
    offset = result["offset"]
    capa = next(c for c in offset["componentes"] if c["tipo"] == "CAPA")
    miolo = next(c for c in offset["componentes"] if c["tipo"] == "MIOLO")
    assert capa["qtd_chapas"] == 8
    assert miolo["qtd_chapas"] == 8  # 32 págs A4 / 4 = 8 formas PB
    assert offset["custo_pre"] > 0
    assert offset["custo_indiretos"] > 0
    assert offset["total"] > offset["custo_direto"]
    # 500 un. → faixa 80% + 7+10+3+5 = 105% da base
    assert offset["custo_indiretos"] == pytest.approx(offset["custo_direto"] * 1.05, abs=0.05)


def test_faixa_pessoal_5000_usa_22_por_cento():
    result = calcular(
        {
            "tiragem": 5000,
            "tecnologia": "offset",
            "componentes": [
                {
                    "nome": "Cartaz",
                    "tipo": "UNICO",
                    "menor_mm": 210,
                    "maior_mm": 297,
                    "paginas": 2,
                    "cor": True,
                    "frente_verso": False,
                    "papel_codigo": "p26",
                }
            ],
        },
        _catalog(),
    )
    pessoal = next(
        x for x in result["offset"]["indiretos_detalhe"] if x["nome"].startswith("Gastos")
    )
    assert pessoal["aliquota"] == 0.22
