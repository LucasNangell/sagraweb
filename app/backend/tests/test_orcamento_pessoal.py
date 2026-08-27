"""Regressão do custeio de pessoal por etapa."""
from __future__ import annotations

from services.orcamento_pessoal import (
    blend_horas,
    cap_stint,
    custo_crew,
    custear_passos,
    iqr_filter,
    overhead_hora,
    prior_horas,
)


def test_blend_n0_usa_prior():
    assert blend_horas(2.0, n=0, mediana=10.0, k=8) == 2.0


def test_blend_n_grande_aproxima_mediana():
    valor = blend_horas(2.0, n=80, mediana=10.0, k=8)
    assert valor == 80 / 88 * 10.0 + 8 / 88 * 2.0
    assert valor > 9.0


def test_prior_horas_setup_e_tiragem():
    passo = {"setup_min": 30, "min_por_un": 0.6, "min_por_pag": 0, "min_por_folha": 0}
    # 30 + 100*0.6 = 90 min = 1.5 h
    assert prior_horas(passo, tiragem=100, paginas=2, folhas=10) == 1.5


def test_cap_stint_limita_teto():
    assert cap_stint(10, 2, 3.0) == 6.0
    assert cap_stint(1, 2, 3.0) == 1.0


def test_overhead_hora_valor():
    funcoes = [
        {"ativo": True, "alocacao": "etapa", "quantidade": 10, "custo_mensal": 10000},
        {"ativo": True, "alocacao": "overhead", "quantidade": 2, "custo_mensal": 25000},
    ]
    taxa = overhead_hora(funcoes, horas_mes=176, utilizacao=0.6)
    assert abs(taxa - 50000 / (176 * 10 * 0.6)) < 1e-6


def test_cartao_espera_cliente_zero():
    funcoes = [
        {
            "id": 1,
            "nome": "Pré",
            "ativo": True,
            "alocacao": "etapa",
            "quantidade": 1,
            "custo_mensal": 17600,
            "custo_hora": 100,
        },
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
            "id": 3,
            "nome": "Acabamento",
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
    passos = [
        {
            "id": 1,
            "nome": "SEFOC pré",
            "setor_link": "SEFOC",
            "tipo": "produtiva",
            "setup_min": 60,
            "funcoes": [{"funcao_id": 1, "quantidade": 1}],
        },
        {
            "id": 2,
            "nome": "Prova cliente",
            "setor_link": "SEFOC",
            "tipo": "espera_cliente",
            "setup_min": 999,
            "funcoes": [{"funcao_id": 1, "quantidade": 1}],
        },
        {
            "id": 3,
            "nome": "SIELT impressão",
            "setor_link": "SIELT",
            "tipo": "produtiva",
            "setup_min": 60,
            "funcoes": [{"funcao_id": 2, "quantidade": 1}],
        },
        {
            "id": 4,
            "nome": "SEPAC refile",
            "setor_link": "SEPAC",
            "tipo": "produtiva",
            "setup_min": 30,
            "funcoes": [{"funcao_id": 3, "quantidade": 1}],
        },
        {
            "id": 5,
            "nome": "Expedição",
            "setor_link": "SEDIR",
            "tipo": "fim",
            "setup_min": 10,
        },
    ]
    result = custear_passos(
        passos,
        tecnologia="digital",
        tiragem=100,
        paginas=2,
        folhas=12.5,
        funcoes=funcoes,
        k=8,
        utilizacao=0.6,
    )
    espera = next(d for d in result["detalhe"] if d["tipo"] == "espera_cliente")
    fim = next(d for d in result["detalhe"] if d["tipo"] == "fim")
    sielt = next(d for d in result["detalhe"] if d["setor_link"] == "SIELT")
    sepac = next(d for d in result["detalhe"] if d["setor_link"] == "SEPAC")
    assert espera["valor"] == 0
    assert fim["valor"] == 0
    assert sielt["valor"] > 0
    assert sepac["valor"] > 0
    assert result["tem_passos"] is True
    assert result["custo_pessoal"] > result["custo_etapas"]  # overhead


def test_custo_crew():
    funcoes = [{"id": 1, "nome": "Pré", "ativo": True, "custo_hora": 50}]
    valor, linhas = custo_crew(
        {"funcoes": [{"funcao_id": 1, "quantidade": 2}]},
        funcoes,
        1.5,
    )
    assert valor == 150.0
    assert linhas[0]["quantidade"] == 2


def test_iqr_descarta_outlier():
    kept = iqr_filter([1, 1.1, 1.2, 1.0, 1.15, 1.05, 50], min_n=4)
    assert 50 not in kept
    assert all(v < 10 for v in kept)
