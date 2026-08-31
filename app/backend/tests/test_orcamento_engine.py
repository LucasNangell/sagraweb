"""Regressão do motor de orçamento Digital/Offset."""
from __future__ import annotations

import pytest

from services.orcamento_engine import calcular, match_papel, parse_cores_impressao, suggest_formato
from services.orcamento_os_service import _componente_from_lote

P26_DIGITAL = {
    "codigo": "p26",
    "categoria": "papel",
    "especificacao": "Papel Couchê fosco 300gr (66x96cm)",
    "preco_unitario": 1.494,
    "preco_unitario_digital": 3.58,
    "rendimento_a4": 8,
    "ativo": True,
    "aliases": ["cf 300", "couchê fosco 300"],
}

P1 = {
    "codigo": "p1",
    "categoria": "papel",
    "especificacao": "Papel off-set alta alvura AP 75gr (112x76cm)",
    "preco_unitario": 0.48,
    "preco_unitario_digital": 0.638,
    "rendimento_a4": 10,
    "ativo": True,
}

E1 = {
    "codigo": "e1",
    "categoria": "espiral",
    "especificacao": "Espiral de 07 mm",
    "preco_unitario": 0.06,
    "ativo": True,
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
    "rendimento_digital_a4": 8,
    "rendimento_offset_a4": 8,
    "pessoal_por_hora": 0,
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
        "insumos": [P26_DIGITAL, P1, BOPP, CHAPA, T5, T1, G1, E1, *(extra_insumos or [])],
        "parametros": dict(PARAMS),
        "formatos": FORMATOS,
        "faixas": FAIXAS,
        "funcoes": [],
        "passos": [],
        "learned": [],
    }


def test_parse_cores_4x0_sem_verso():
    spec = parse_cores_impressao("4x0")
    assert spec is not None
    assert spec["cor"] is True
    assert spec["frente_verso"] is False
    assert spec["verso_cor"] is False


def test_parse_cores_slash_4_0():
    spec = parse_cores_impressao("4/0")
    assert spec is not None
    assert spec["frente"] == 4
    assert spec["verso"] == 0
    assert spec["frente_verso"] is False


def test_componente_from_lote_prefers_impressao():
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
        lote={
            "paginas": 4,
            "cores_link": "4x4",
            "impressao": "4/0",
            "frente_verso": True,
        },
        fallback={},
        acab=acab,
        insumos=[],
    )
    assert comp["impressao"] == "4/0"
    assert comp["cor"] is True
    assert comp["frente_verso"] is False
    assert comp["verso_cor"] is False


def test_impressao_4x0_sobrescreve_flags_de_verso_cor():
    result = calcular(
        {
            "tiragem": 100,
            "tecnologia": "offset",
            "componentes": [
                {
                    "nome": "Capa",
                    "tipo": "CAPA",
                    "menor_mm": 170,
                    "maior_mm": 255,
                    "paginas": 4,
                    "cor": True,
                    "frente_verso": True,
                    "verso_cor": True,
                    "impressao": "4/0",
                    "papel_codigo": "p26",
                }
            ],
        },
        _catalog(),
    )
    capa = result["offset"]["componentes"][0]
    assert capa["qtd_chapas"] == 4


def test_parse_cores_4x4_verso_cor():
    spec = parse_cores_impressao("Capa 4x4")
    assert spec is not None
    assert spec["frente_verso"] is True
    assert spec["verso_cor"] is True


def test_parse_cores_4x1_verso_pb():
    spec = parse_cores_impressao("4x1")
    assert spec is not None
    assert spec["frente_verso"] is True
    assert spec["verso_cor"] is False


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
    # Offset do mesmo job usa p26=1,494, não o preço Digital 3,58.
    capa_off = result["offset"]["componentes"][0]
    assert capa_off["custo_papel"] == pytest.approx(56.25 * 1.494, abs=0.05)
    assert capa_off["custo_papel"] != pytest.approx(digital["custo_papel"], abs=0.5)


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


def _passos_cartao(funcao_id: int = 2):
    return [
        {
            "id": 1,
            "produto_rotulo": "Ct Visita",
            "nome": "SIELT impressão",
            "setor_link": "SIELT",
            "tipo": "produtiva",
            "cobra_pessoal": True,
            "setup_min": 60,
            "min_por_un": 0,
            "funcoes": [{"funcao_id": funcao_id, "quantidade": 1}],
        },
        {
            "id": 2,
            "produto_rotulo": "Ct Visita",
            "nome": "Prova cliente",
            "setor_link": "SEFOC",
            "tipo": "espera_cliente",
            "setup_min": 0,
            "funcoes": [],
        },
        {
            "id": 3,
            "produto_rotulo": "Ct Visita",
            "nome": "SEPAC refile",
            "setor_link": "SEPAC",
            "tipo": "produtiva",
            "cobra_pessoal": True,
            "setup_min": 30,
            "funcoes": [{"funcao_id": funcao_id, "quantidade": 1}],
        },
    ]


def test_offset_com_etapas_usa_faixa_quando_hora_desligada():
    catalog = _catalog()
    catalog["funcoes"] = [
        {
            "id": 2,
            "nome": "Digital",
            "ativo": True,
            "alocacao": "etapa",
            "quantidade": 1,
            "custo_mensal": 17600,
            "custo_hora": 100,
        },
        {
            "id": 9,
            "nome": "Gerente",
            "ativo": True,
            "alocacao": "overhead",
            "quantidade": 1,
            "custo_mensal": 17600,
            "custo_hora": 100,
        },
    ]
    catalog["passos"] = _passos_cartao()
    result = calcular(
        {
            "os": {"produto": "Ct Visita"},
            "tiragem": 500,
            "tecnologia": "offset",
            "componentes": [
                {
                    "nome": "Cartão",
                    "tipo": "UNICO",
                    "menor_mm": 90,
                    "maior_mm": 50,
                    "paginas": 2,
                    "cor": True,
                    "frente_verso": True,
                    "papel_codigo": "p26",
                }
            ],
        },
        catalog,
    )
    nomes = [x["nome"] for x in result["offset"]["indiretos_detalhe"]]
    assert any(n.startswith("Gastos com pessoal") for n in nomes)
    assert result["offset"]["usa_pessoal_hora"] is False
    assert result["offset"]["custo_indiretos"] == pytest.approx(
        result["offset"]["custo_direto"] * 1.05, abs=0.05
    )


def test_digital_com_etapas_usa_lump_87_quando_hora_desligada():
    catalog = _catalog()
    catalog["funcoes"] = [
        {
            "id": 2,
            "nome": "Digital",
            "ativo": True,
            "alocacao": "etapa",
            "quantidade": 1,
            "custo_mensal": 17600,
            "custo_hora": 100,
        }
    ]
    catalog["passos"] = _passos_cartao()
    result = calcular(
        {
            "os": {"produto": "Ct Visita"},
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
                }
            ],
        },
        catalog,
    )
    digital = result["digital"]
    nomes = [x["nome"] for x in digital["indiretos_detalhe"]]
    assert any("Insumos indiretos" in n for n in nomes)
    lump = (digital["custo_papel"] + digital["custo_acabamento"]) * 0.87
    assert digital["total"] == pytest.approx(
        digital["custo_papel"] + digital["custo_clique"] + digital["custo_acabamento"] + lump,
        abs=0.05,
    )
    assert digital["usa_pessoal_hora"] is False


def test_pessoal_por_hora_liga_custeio_por_etapas():
    catalog = _catalog()
    catalog["parametros"]["pessoal_por_hora"] = 1
    catalog["funcoes"] = [
        {
            "id": 2,
            "nome": "Digital",
            "ativo": True,
            "alocacao": "etapa",
            "quantidade": 1,
            "custo_mensal": 17600,
            "custo_hora": 100,
        },
        {
            "id": 9,
            "nome": "Gerente",
            "ativo": True,
            "alocacao": "overhead",
            "quantidade": 1,
            "custo_mensal": 17600,
            "custo_hora": 100,
        },
    ]
    catalog["passos"] = _passos_cartao()
    result = calcular(
        {
            "os": {"produto": "Ct Visita"},
            "tiragem": 500,
            "tecnologia": "offset",
            "componentes": [
                {
                    "nome": "Cartão",
                    "tipo": "UNICO",
                    "menor_mm": 90,
                    "maior_mm": 50,
                    "paginas": 2,
                    "cor": True,
                    "frente_verso": True,
                    "papel_codigo": "p26",
                }
            ],
        },
        catalog,
    )
    nomes = [x["nome"] for x in result["offset"]["indiretos_detalhe"]]
    assert not any(n.startswith("Gastos com pessoal") for n in nomes)
    assert result["offset"]["usa_pessoal_hora"] is True
    assert result["offset"]["custo_pessoal"] > 0


def test_os_1390_offset_papel_chapas_e_bopp():
    """Regimento Interno OS 1390 — planilha Offset 2 componentes (sem o bug da laminação)."""
    result = calcular(
        {
            "tiragem": 999,
            "tecnologia": "offset",
            "componentes": [
                {
                    "nome": "Capa",
                    "tipo": "CAPA",
                    "menor_mm": 170,
                    "maior_mm": 255,
                    "paginas": 4,
                    "cor": True,
                    "frente_verso": False,
                    "verso_cor": False,
                    "papel_codigo": "p26",
                    "laminacao": True,
                    "laminacao_fv": True,
                },
                {
                    "nome": "Miolo",
                    "tipo": "MIOLO",
                    "menor_mm": 170,
                    "maior_mm": 255,
                    "paginas": 286,
                    "cor": False,
                    "frente_verso": True,
                    "papel_codigo": "p1",
                    "espiral": True,
                    "espiral_codigo": "e1",
                },
            ],
        },
        _catalog(),
    )
    offset = result["offset"]
    capa = next(c for c in offset["componentes"] if c["tipo"] == "CAPA")
    miolo = next(c for c in offset["componentes"] if c["tipo"] == "MIOLO")
    assert capa["custo_papel"] == pytest.approx(447.83, abs=0.02)
    assert miolo["custo_papel"] == pytest.approx(8595.42, abs=0.02)
    assert capa["qtd_chapas"] == 4
    assert miolo["qtd_chapas"] == 72
    assert offset["custo_pre"] == pytest.approx(2888.0, abs=0.05)
    assert capa["custo_laminacao"] > 0
    assert miolo["custo_espiral"] == pytest.approx(59.94, abs=0.02)


def test_offset_capa_4x0_planilha_teste():
    """Offset (02 Componentes) - teste.xlsm: capa 4x0, miolo PB 308 pág., tiragem 500."""
    p25 = {
        "codigo": "p25",
        "categoria": "papel",
        "preco_unitario": 1.244,
        "ativo": True,
    }
    p0 = {
        "codigo": "p0",
        "categoria": "papel",
        "preco_unitario": 0.35494,
        "ativo": True,
    }
    c7 = {
        "codigo": "c7",
        "categoria": "cola",
        "preco_unitario": 19.2,
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
                    "menor_mm": 170,
                    "maior_mm": 255,
                    "paginas": 4,
                    "cor": True,
                    "frente_verso": False,
                    "verso_cor": False,
                    "papel_codigo": "p25",
                    "laminacao": True,
                    "laminacao_fv": False,
                },
                {
                    "nome": "Miolo",
                    "tipo": "MIOLO",
                    "menor_mm": 170,
                    "maior_mm": 255,
                    "paginas": 308,
                    "cor": False,
                    "frente_verso": True,
                    "papel_codigo": "p0",
                    "cola": True,
                },
            ],
        },
        _catalog([p25, p0, c7]),
    )
    offset = result["offset"]
    capa = next(c for c in offset["componentes"] if c["tipo"] == "CAPA")
    miolo = next(c for c in offset["componentes"] if c["tipo"] == "MIOLO")
    assert capa["qtd_chapas"] == 4
    assert miolo["qtd_chapas"] == 77
    assert offset["custo_papel"] == pytest.approx(3651.74, abs=0.02)
    assert offset["custo_pre"] == pytest.approx(3078.0, abs=0.05)
    assert offset["custo_tinta"] == pytest.approx(29.65, abs=0.02)
    assert capa["custo_laminacao"] == pytest.approx(70.71, abs=0.02)
    assert miolo["custo_cola"] == pytest.approx(41.07, abs=0.02)
