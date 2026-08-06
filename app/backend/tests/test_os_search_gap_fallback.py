"""Filtros setor/situação: tabAndamento live primário; materializada com opt-in."""

from __future__ import annotations

from unittest.mock import patch

from services.os_search_service import execute_os_search

_MAT_POP = "services.os_search_service.materialized_table_populated"
_PREFER_MAT = "services.os_search_service._prefer_materialized_andamento"


@patch(_PREFER_MAT, return_value=False)
@patch(_MAT_POP, return_value=True)
@patch("services.os_search_service.db")
@patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
@patch("services.os_search_service._enrich_operacional_from_live", side_effect=lambda r: r)
def test_search_setor_filter_uses_tabandamento_live_by_default(
    mock_live_enrich, _enrich, mock_db, _pop, _prefer
):
    mock_db.execute_query.return_value = []

    execute_os_search(
        simple_pagination=True,
        include_finished=False,
        setor=["SEFOC"],
        situacao=["Saída p/", "Recebido"],
    )

    sql = str(mock_db.execute_query.call_args.args[0])
    assert "FROM tabProtocolos" in sql
    assert "INNER JOIN tabProtocolos" not in sql
    assert "ROW_NUMBER()" in sql
    assert "UltimoStatus = 1" in sql
    assert "a_op.SituacaoLink" in sql
    assert "a_op.SetorLink" in sql
    assert "subfx_setor" in sql
    assert "subfx_sit" in sql
    assert "a_gap.SetorLink" in sql
    assert "tab_os_ultimo_andamento_operacional" in sql
    mock_live_enrich.assert_called_once()


@patch(_PREFER_MAT, return_value=False)
@patch(_MAT_POP, return_value=True)
@patch("services.os_search_service.db")
@patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
@patch("services.os_search_service._enrich_operacional_from_live", side_effect=lambda r: r)
def test_search_setor_filter_tabandamento_gap_when_live_join_null(
    _live_enrich, _enrich, mock_db, _pop, _prefer
):
    mock_db.execute_query.return_value = []

    execute_os_search(simple_pagination=True, setor=["SEFOC"])

    sql = str(mock_db.execute_query.call_args.args[0])
    assert "a_op.SituacaoLink IS NULL" in sql
    assert "a_gap.SetorLink" in sql
    assert "UltimoStatus = 1" in sql


@patch(_PREFER_MAT, return_value=True)
@patch(_MAT_POP, return_value=True)
@patch("services.os_search_service.db")
@patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
@patch("services.os_search_service._enrich_operacional_from_live", side_effect=lambda r: r)
def test_search_setor_filter_uses_materialized_when_opt_in(
    mock_live_enrich, _enrich, mock_db, _pop, _prefer
):
    mock_db.execute_query.return_value = []

    execute_os_search(
        simple_pagination=True,
        include_finished=False,
        setor=["SEFOC"],
        situacao=["Saída p/", "Recebido"],
    )

    sql = str(mock_db.execute_query.call_args.args[0])
    assert "tab_os_ultimo_andamento_operacional" in sql
    assert "a_op.setor" in sql
    assert "a_op.situacao" in sql
    assert "a_op.nro_protocolo IS NULL" in sql
    assert "ROW_NUMBER()" not in sql
    mock_live_enrich.assert_called_once()


@patch(_PREFER_MAT, return_value=False)
@patch(_MAT_POP, return_value=False)
@patch("services.os_search_service.db")
@patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
@patch("services.os_search_service._enrich_operacional_from_live", side_effect=lambda r: r)
def test_search_setor_filter_falls_back_to_live_when_materialized_empty(
    _live_enrich, _enrich, mock_db, _pop, _prefer
):
    mock_db.execute_query.return_value = []

    execute_os_search(simple_pagination=True, setor=["SEFOC"])

    sql = str(mock_db.execute_query.call_args.args[0])
    assert "ROW_NUMBER()" in sql
    assert "UltimoStatus = 1" in sql
