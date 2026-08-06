"""Reconciliação incremental da materializada."""
from __future__ import annotations

from unittest.mock import patch

from services.os_materialized_reconcile_service import (
    find_materialized_gaps,
    reconcile_gaps,
    run_reconcile_cycle,
)


@patch("services.os_materialized_reconcile_service.db")
def test_find_gaps_sql_uses_collation_on_cross_table_compare(mock_db):
    mock_db.execute_query.return_value = []
    find_materialized_gaps(nro=1, ano=2026, max_rows=5)
    sql = str(mock_db.execute_query.call_args.args[0])
    assert "COLLATE utf8mb4_unicode_ci" in sql
    assert "m.situacao" in sql
    assert "a.SituacaoLink" in sql


@patch("services.os_materialized_reconcile_service.after_andamento_changed")
@patch("services.os_materialized_reconcile_service.fetch_operacional_row")
@patch("services.os_materialized_reconcile_service.find_materialized_gaps")
def test_reconcile_gaps_emits_individual_ws(mock_find, mock_fetch, mock_after):
    mock_find.return_value = [
        {"nro": 5967, "ano": 2026, "gap_kind": "missing"},
        {"nro": 5966, "ano": 2026, "gap_kind": "missing"},
    ]
    mock_fetch.return_value = {"setor": "SEFOC", "situacao": "Saída p/"}
    mock_after.return_value = {"reconciled": True}

    result = reconcile_gaps(mock_find.return_value, source="test")

    assert result["fixed"] == 2
    assert mock_after.call_count >= 2


@patch("services.os_materialized_reconcile_service.find_materialized_gaps", return_value=[])
def test_run_reconcile_cycle_empty(mock_find):
    result = run_reconcile_cycle()
    assert result["candidates"] == 0
    assert result["fixed"] == 0
