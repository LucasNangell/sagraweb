"""Aprendizado e realizado de orçamento a partir de andamentos."""
from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

from services.orcamento_pessoal import upsert_amostra
from services.orcamento_realizado_service import (
    aplicar_aprendizado,
    custear_matched,
    match_stints_to_passos,
    montar_realizado,
    stints_from_andamentos,
)
from services.os_andamento_post_change_service import after_andamento_changed


def _passos_cartao():
    return [
        {
            "id": 1,
            "catalog_id": 10,
            "nome": "SEFOC pré",
            "setor_link": "SEFOC",
            "tipo": "produtiva",
            "setup_min": 60,
            "funcoes": [{"funcao_id": 1, "quantidade": 1}],
        },
        {
            "id": 2,
            "catalog_id": 10,
            "nome": "Prova cliente",
            "setor_link": "SEFOC",
            "tipo": "espera_cliente",
            "setup_min": 999,
            "funcoes": [{"funcao_id": 1, "quantidade": 1}],
        },
        {
            "id": 3,
            "catalog_id": 10,
            "nome": "SIELT impressão",
            "setor_link": "SIELT",
            "tipo": "produtiva",
            "setup_min": 60,
            "funcoes": [{"funcao_id": 2, "quantidade": 1}],
        },
        {
            "id": 4,
            "catalog_id": 10,
            "nome": "SEPAC refile",
            "setor_link": "SEPAC",
            "tipo": "produtiva",
            "setup_min": 20,
            "funcoes": [{"funcao_id": 3, "quantidade": 1}],
        },
        {
            "id": 5,
            "catalog_id": 10,
            "nome": "Expedição",
            "setor_link": "SEDIR",
            "tipo": "fim",
        },
    ]


def test_tres_andamentos_stint_limitado_e_n_incrementa():
    rows = [
        {
            "CodStatus": "1",
            "SetorLink": "SIELT",
            "SituacaoLink": "Produção",
            "Data": datetime(2026, 3, 2, 8, 0, 0),
        },
        {
            "CodStatus": "2",
            "SetorLink": "SEPAC",
            "SituacaoLink": "Produção",
            "Data": datetime(2026, 3, 2, 16, 0, 0),
        },
        {
            "CodStatus": "3",
            "SetorLink": "SEDIR",
            "SituacaoLink": "Entregue",
            "Data": datetime(2026, 3, 2, 17, 0, 0),
        },
    ]
    stints = stints_from_andamentos(rows)
    assert len(stints) == 2
    assert stints[0]["setor_link"] == "SIELT"
    # 8h→16h em horário útil 6–22 = 8h; prior SIELT = 1h; teto 3× → 3h
    matched = match_stints_to_passos(
        _passos_cartao(),
        stints,
        tecnologia="digital",
        tiragem=100,
        paginas=2,
        folhas=10,
        teto_fator=3.0,
    )
    espera = next(m for m in matched if m["passo"]["tipo"] == "espera_cliente")
    sielt = next(m for m in matched if m["passo"]["setor_link"] == "SIELT")
    sepac = next(m for m in matched if m["passo"]["setor_link"] == "SEPAC")
    assert espera["horas"] == 0
    assert sielt["capped"] is True
    assert sielt["horas"] == 3.0
    assert sielt["horas_obs"] == 8.0
    assert sepac["horas"] == 1.0

    learned = aplicar_aprendizado(matched, {}, "100/2026")
    assert 2 not in learned  # espera cliente
    assert learned[3]["stats"]["n"] == 1
    assert learned[4]["stats"]["n"] == 1

    again = aplicar_aprendizado(matched, {3: learned[3]["amostras"]}, "100/2026")
    assert again[3]["stats"]["n"] == 1  # mesma OS não duplica


def test_espera_cliente_nao_consome_stint_sefoc():
    rows = [
        {"SetorLink": "SEFOC", "SituacaoLink": "Produção", "Data": datetime(2026, 3, 2, 9, 0)},
        {"SetorLink": "SEFOC", "SituacaoLink": "Aguardando cliente", "Data": datetime(2026, 3, 2, 11, 0)},
        {"SetorLink": "SIELT", "SituacaoLink": "Produção", "Data": datetime(2026, 3, 2, 12, 0)},
        {"SetorLink": "SEPAC", "SituacaoLink": "Produção", "Data": datetime(2026, 3, 2, 13, 0)},
    ]
    stints = stints_from_andamentos(rows)
    matched = match_stints_to_passos(
        _passos_cartao(),
        stints,
        tecnologia="digital",
        tiragem=1,
        paginas=1,
        folhas=1,
        teto_fator=3.0,
    )
    sefoc = next(m for m in matched if m["passo"]["id"] == 1)
    espera = next(m for m in matched if m["passo"]["id"] == 2)
    sielt = next(m for m in matched if m["passo"]["id"] == 3)
    assert sefoc["horas"] == 2.0
    assert espera["horas"] == 0
    assert espera["stint"] is None
    assert sielt["stint"] is not None
    assert sielt["stint"]["setor_link"] == "SIELT"


def test_montar_realizado_sem_estoque_usa_teorico():
    estimado = {
        "usa_pessoal_hora": True,
        "custo_papel": 10,
        "custo_clique": 5,
        "custo_pre": 0,
        "custo_tinta": 0,
        "custo_acabamento": 2,
        "indiretos_detalhe": [
            {"nome": "Energia elétrica", "valor": 1.2},
            {"nome": "Pessoal: SIELT", "valor": 80},
        ],
    }
    pessoal = {"custo_pessoal": 50, "detalhe": [], "horas_produtivas": 1}
    out = montar_realizado(estimado=estimado, pessoal=pessoal, consumo=None)
    assert out["custo_material"] == 17
    assert out["desperdicio"] == 0
    assert out["nota_material"]
    assert out["custo_pessoal"] == 50
    assert out["total"] == 17 + 50 + 1.2


def test_montar_realizado_desperdicio_estoque():
    estimado = {
        "usa_pessoal_hora": True,
        "custo_papel": 10,
        "custo_clique": 0,
        "custo_pre": 0,
        "custo_tinta": 0,
        "custo_acabamento": 0,
        "indiretos_detalhe": [],
    }
    out = montar_realizado(
        estimado=estimado,
        pessoal={"custo_pessoal": 0, "detalhe": []},
        consumo=18,
    )
    assert out["desperdicio"] == 8
    assert out["custo_material"] == 18


def test_custear_matched_espera_zero():
    funcoes = [
        {"id": 1, "nome": "Pré", "ativo": True, "custo_hora": 100, "alocacao": "etapa", "quantidade": 1},
        {"id": 2, "nome": "Dig", "ativo": True, "custo_hora": 100, "alocacao": "etapa", "quantidade": 1},
        {"id": 3, "nome": "Acab", "ativo": True, "custo_hora": 100, "alocacao": "etapa", "quantidade": 1},
    ]
    matched = match_stints_to_passos(
        _passos_cartao(),
        [
            {"setor_link": "SIELT", "horas": 2.0},
            {"setor_link": "SEPAC", "horas": 0.5},
        ],
        tecnologia="digital",
        tiragem=1,
        paginas=1,
        folhas=1,
        teto_fator=3.0,
    )
    result = custear_matched(matched, funcoes)
    espera = next(d for d in result["detalhe"] if d["tipo"] == "espera_cliente")
    assert espera["valor"] == 0
    assert result["custo_etapas"] > 0


def test_upsert_mesma_os_nao_incrementa_n():
    rows, stats = upsert_amostra([], "1/2026", 1.5)
    assert stats["n"] == 1
    rows, stats = upsert_amostra(rows, "1/2026", 2.0)
    assert stats["n"] == 1
    assert rows[0]["horas"] == 2.0
    _, stats = upsert_amostra(rows, "2/2026", 3.0)
    assert stats["n"] == 2


@patch("services.orcamento_realizado_service.on_os_entregue")
@patch("routers.realtime.schedule_broadcast")
@patch("routers.pcp_routes.invalidate_pcp_queue_cache")
@patch("services.os_ultimo_andamento_service.refresh_os_ultimo_andamento_operacional")
@patch("services.os_ultimo_andamento_service.fetch_operacional_row")
def test_after_andamento_entregue_dispara_aprendizado(
    mock_fetch,
    mock_refresh,
    mock_pcp_inv,
    mock_schedule,
    mock_learn,
):
    mock_fetch.return_value = {"situacao": "Entregue", "setor": "SEDIR", "cod_status": "1"}
    after_andamento_changed(10, 2026, "history_added", situacao="Entregue", notify=True)
    mock_learn.assert_called_once_with(10, 2026)


@patch("services.orcamento_realizado_service.on_os_entregue")
@patch("services.os_ultimo_andamento_service.refresh_os_ultimo_andamento_operacional")
@patch("services.os_ultimo_andamento_service.fetch_operacional_row", return_value=None)
def test_after_andamento_com_cursor_nao_aprende(mock_fetch, mock_refresh, mock_learn):
    after_andamento_changed(
        1,
        2026,
        "recalc_ultimo_status",
        situacao="Entregue",
        notify=False,
        cursor=MagicMock(),
    )
    mock_learn.assert_not_called()
