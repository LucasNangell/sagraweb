"""Priors de etapas de orçamento: templates, mapa de produtos e seed versionado."""
from __future__ import annotations

from unittest.mock import patch

from services.orcamento_passo_priors import (
    ACABAMENTO_PASSOS,
    FAMILIA_E,
    PASSOS_PRIORS_VERSAO,
    PRODUTO_FAMILIA,
    bind_funcoes,
    familia_do_produto,
    passos_para_acabamento,
    passos_para_produto,
    produtos_com_passos,
)
from services.orcamento_passo_priors_seed import seed_orcamento_passos_priors


def _by_nome(passos: list[dict], trecho: str) -> dict:
    return next(p for p in passos if trecho in p["nome"])


def _codigos(passo: dict) -> list[str]:
    return [str(f.get("codigo")) for f in passo.get("funcoes") or []]


def test_livro_nove_passos_dual_tecnologia():
    passos = passos_para_produto("Livro")
    assert passos is not None
    assert len(passos) == 9

    sielt = _by_nome(passos, "SIELT")
    assert sielt["tecnologia"] == "digital"
    assert sielt["setup_min"] == 15
    assert sielt["min_por_pag"] == 0.003
    assert _codigos(sielt) == ["DIG", "AUX"]

    grav = _by_nome(passos, "Gravação")
    assert grav["tecnologia"] == "offset"
    assert grav["setup_min"] == 20
    assert grav["min_por_pag"] == 0
    assert grav["min_por_un"] == 0
    assert grav["min_por_folha"] == 0
    assert _codigos(grav) == ["GRAV"]

    seimp = _by_nome(passos, "SEIMP")
    assert seimp["tecnologia"] == "offset"
    assert seimp["setup_min"] == 30
    assert seimp["min_por_pag"] == 0.003
    assert _codigos(seimp) == ["IMP_OFF", "AUX_OFF"]

    sefoc = _by_nome(passos, "pré-montagem")
    assert sefoc["setor_link"] == "SEFOC"
    assert sefoc["min_por_pag"] == 0.08
    assert sefoc["setup_min"] == 15


def test_ct_visita_sete_passos_sielt_004():
    passos = passos_para_produto("Ct Visita")
    assert passos is not None
    assert len(passos) == 7
    sielt = _by_nome(passos, "SIELT")
    assert sielt["tecnologia"] == "digital"
    assert sielt["setup_min"] == 10
    assert sielt["min_por_pag"] == 0.004
    assert sielt["min_por_un"] == 0
    assert _codigos(sielt) == ["DIG"]
    assert _by_nome(passos, "Prova")["tipo"] == "espera_cliente"
    assert _by_nome(passos, "Expedição")["tipo"] == "fim"
    assert not _by_nome(passos, "Expedição")["cobra_pessoal"]


def test_cola_acabamento_crew_insalubre():
    passos = passos_para_acabamento("Cola")
    assert passos is not None
    assert len(passos) == 1
    cola = passos[0]
    assert cola["nome"] == "Cola"
    assert cola["setor_link"] == "SEPAC"
    assert cola["setup_min"] == 30
    assert cola["min_por_un"] == 0.5
    assert cola["min_por_pag"] == 0
    assert _codigos(cola) == ["ACAB", "AUX_INS"]


def test_familia_e_nao_gera_passos():
    assert familia_do_produto("Digitalização") == FAMILIA_E
    assert passos_para_produto("Digitalização") is None
    assert passos_para_produto("(sem produto)") is None


def test_mapa_cobre_familias_conhecidas():
    assert "Livro" in produtos_com_passos()
    assert "Digitalização" not in produtos_com_passos()
    assert set(PRODUTO_FAMILIA.values()) >= {"A", "A2", "A3", "A3_pasta", "A4", "B", "B2", "B3", "C", "D", "E"}
    assert "Cola" in ACABAMENTO_PASSOS
    assert "Capa PVC" in ACABAMENTO_PASSOS


def test_bind_funcoes_resolve_codigo():
    passos = passos_para_produto("Ct Visita")
    bound = bind_funcoes(passos or [], {"PRE": 11, "DIG": 22, "ACAB": 33, "AUX": 44})
    sielt = _by_nome(bound, "SIELT")
    assert sielt["funcoes"] == [{"funcao_id": 22, "quantidade": 1}]
    prova = _by_nome(bound, "Prova")
    assert prova["funcoes"] == []


@patch("services.orcamento_passo_priors_seed.replace_passos")
@patch("services.orcamento_passo_priors_seed._upsert_parametro")
@patch("services.orcamento_passo_priors_seed._codigo_to_id", return_value={"PRE": 1})
@patch("services.orcamento_passo_priors_seed._ler_versao", return_value=PASSOS_PRIORS_VERSAO)
def test_seed_mesma_versao_nao_reaplica(mock_ver, mock_codes, mock_up, mock_replace):
    result = seed_orcamento_passos_priors(force=False)
    assert result["applied"] is False
    assert result["produtos"] == 0
    mock_replace.assert_not_called()
    mock_up.assert_not_called()


@patch("services.orcamento_passo_priors_seed.replace_passos")
@patch("services.orcamento_passo_priors_seed.ensure_produto_catalog_id", return_value={"id": 10})
@patch("services.orcamento_passo_priors_seed._ensure_acabamento", return_value={"id": 20})
@patch("services.orcamento_passo_priors_seed._upsert_parametro")
@patch(
    "services.orcamento_passo_priors_seed._codigo_to_id",
    return_value={
        "PRE": 1,
        "DIG": 2,
        "AUX": 3,
        "ACAB": 4,
        "GRAV": 5,
        "IMP_OFF": 6,
        "AUX_OFF": 7,
        "AUX_INS": 8,
    },
)
@patch("services.orcamento_passo_priors_seed._ler_versao", return_value=PASSOS_PRIORS_VERSAO)
def test_seed_force_reaplica_mesma_versao(
    mock_ver, mock_codes, mock_up, mock_acab, mock_prod, mock_replace
):
    result = seed_orcamento_passos_priors(force=True, ponto="99")
    assert result["applied"] is True
    assert mock_replace.call_count == len(produtos_com_passos()) + len(ACABAMENTO_PASSOS)
    mock_up.assert_any_call(
        "passos_priors_versao",
        str(PASSOS_PRIORS_VERSAO),
        "number",
        "Versão dos priors de etapas de orçamento já aplicados",
        "99",
    )



@patch("services.orcamento_passo_priors_seed.replace_passos")
@patch("services.orcamento_passo_priors_seed.ensure_produto_catalog_id", return_value={"id": 10})
@patch("services.orcamento_passo_priors_seed._ensure_acabamento", return_value={"id": 20})
@patch("services.orcamento_passo_priors_seed._upsert_parametro")
@patch(
    "services.orcamento_passo_priors_seed._codigo_to_id",
    return_value={
        "PRE": 1,
        "DIG": 2,
        "AUX": 3,
        "ACAB": 4,
        "GRAV": 5,
        "IMP_OFF": 6,
        "AUX_OFF": 7,
        "AUX_INS": 8,
    },
)
@patch("services.orcamento_passo_priors_seed._ler_versao", return_value=0)
def test_seed_stale_aplica_produtos_e_acabamentos(
    mock_ver, mock_codes, mock_up, mock_acab, mock_prod, mock_replace
):
    result = seed_orcamento_passos_priors(force=False)
    assert result["applied"] is True
    assert result["versao"] == PASSOS_PRIORS_VERSAO
    n_prod = len(produtos_com_passos())
    n_acab = len(ACABAMENTO_PASSOS)
    assert result["produtos"] == n_prod
    assert result["acabamentos"] == n_acab
    assert mock_replace.call_count == n_prod + n_acab
    mock_up.assert_any_call(
        "passos_priors_versao",
        str(PASSOS_PRIORS_VERSAO),
        "number",
        "Versão dos priors de etapas de orçamento já aplicados",
        "seed-priors",
    )
    mock_up.assert_any_call(
        "pessoal_por_hora",
        "1",
        "bool",
        "Usar custo/hora das etapas em vez da faixa/87%",
        "seed-priors",
    )
