"""Enrich de fornecedor Grav. Externa no /os/search?painel=1."""

from __future__ import annotations

from unittest.mock import patch

from services.os_search_service import (
    _enrich_painel_fornecedores_gravacao_externa,
    execute_os_search,
)

_MAT_POP = "services.os_search_service.materialized_table_populated"
_PREFER_MAT = "services.os_search_service._prefer_materialized_andamento"


def test_enrich_painel_fornecedores_only_grav_externa():
    rows = [
        {"nr_os": 1, "ano": 2026, "setor": "Grav. Externa", "situacao": "Saída p/"},
        {"nr_os": 2, "ano": 2026, "setor": "SEFOC", "situacao": "Em Execução"},
        {"nr_os": 3, "ano": 2026, "setor": "Grav. Externa", "situacao": "Recebido"},
    ]
    with patch(
        "services.gravacao_externa_service.map_fornecedores_por_os",
        return_value={
            "2026-1": [{"ponto": "111", "nome": "Alfa"}],
            "2026-3": [
                {"ponto": "222", "nome": "Beta"},
                {"ponto": "333", "nome": "Gama"},
            ],
        },
    ) as mock_map:
        out = _enrich_painel_fornecedores_gravacao_externa(rows)

    mock_map.assert_called_once()
    args, kwargs = mock_map.call_args
    assert args[0] == [(1, 2026), (3, 2026)]
    assert set(kwargs["statuses"]) == {"pendente", "iniciada"}
    assert out[0]["fornecedor_nome"] == "Alfa"
    assert out[0]["fornecedor_ponto"] == "111"
    assert out[0]["fornecedores"] == [{"ponto": "111", "nome": "Alfa"}]
    assert "fornecedores" not in out[1]
    assert out[2]["fornecedor_nome"] == "Beta"
    assert len(out[2]["fornecedores"]) == 2


def test_enrich_painel_fornecedores_gravacao_ext_concluida():
    rows = [
        {
            "nr_os": 10,
            "ano": 2026,
            "setor": "SEGEP",
            "situacao": "Gravação Ext. Concluída",
        },
        {"nr_os": 11, "ano": 2026, "setor": "SEFOC", "situacao": "Em Execução"},
    ]

    def _fake_map(pairs, *, statuses):
        assert set(statuses) == {"concluida"}
        assert pairs == [(10, 2026)]
        return {
            "2026-10": [
                {"ponto": "111", "nome": "Alfa"},
                {"ponto": "222", "nome": "Beta"},
            ]
        }

    with patch(
        "services.gravacao_externa_service.map_fornecedores_por_os",
        side_effect=_fake_map,
    ) as mock_map:
        out = _enrich_painel_fornecedores_gravacao_externa(rows)

    mock_map.assert_called_once()
    assert out[0]["fornecedor_nome"] == "Alfa"
    assert out[0]["fornecedores"] == [
        {"ponto": "111", "nome": "Alfa"},
        {"ponto": "222", "nome": "Beta"},
    ]
    assert "fornecedores" not in out[1]


def test_enrich_painel_fornecedores_skips_when_no_grav_externa():
    rows = [{"nr_os": 1, "ano": 2026, "setor": "SEFOC", "situacao": "Em Execução"}]
    with patch(
        "services.gravacao_externa_service.map_fornecedores_por_os"
    ) as mock_map:
        out = _enrich_painel_fornecedores_gravacao_externa(rows)
    mock_map.assert_not_called()
    assert out == rows


@patch("services.os_search_service.get_andamento_table", return_value="tabAndamento")
@patch(_PREFER_MAT, return_value=False)
@patch(_MAT_POP, return_value=False)
@patch("services.os_search_service.db")
@patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
@patch(
    "services.os_search_service._enrich_operacional_from_live",
    side_effect=lambda r, **_kwargs: r,
)
@patch(
    "services.os_search_service._enrich_painel_fornecedores_gravacao_externa",
    side_effect=lambda r: r,
)
def test_execute_os_search_painel_calls_fornecedor_enrich(
    mock_fornecedor_enrich, _live, _details, mock_db, _pop, _prefer, _tbl
):
    mock_db.execute_query.return_value = []
    execute_os_search(simple_pagination=True, painel=True, setor=["Grav. Externa"])
    mock_fornecedor_enrich.assert_called_once()


@patch("services.os_search_service.get_andamento_table", return_value="tabAndamento")
@patch(_PREFER_MAT, return_value=False)
@patch(_MAT_POP, return_value=False)
@patch("services.os_search_service.db")
@patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
@patch(
    "services.os_search_service._enrich_operacional_from_live",
    side_effect=lambda r, **_kwargs: r,
)
@patch(
    "services.os_search_service._enrich_painel_fornecedores_gravacao_externa",
    side_effect=lambda r: r,
)
def test_execute_os_search_home_skips_fornecedor_enrich(
    mock_fornecedor_enrich, _live, _details, mock_db, _pop, _prefer, _tbl
):
    mock_db.execute_query.return_value = []
    with patch(
        "services.os_search_service.annotate_search_sub_os_matches",
        side_effect=lambda r, **_kwargs: r,
    ):
        execute_os_search(simple_pagination=True, painel=False, setor=["SEFOC"])
    mock_fornecedor_enrich.assert_not_called()
