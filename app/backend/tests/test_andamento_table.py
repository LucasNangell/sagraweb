"""Resolução do nome canônico tabAndamento/tabandamento."""
from __future__ import annotations

from unittest.mock import patch

from services.andamento_table import ensure_andamento_table, get_andamento_table


@patch("database.db")
def test_ensure_andamento_table_single(mock_db):
    mock_db.execute_query.side_effect = [
        [{"TABLE_NAME": "tabAndamento"}],
    ]
    from services import andamento_table

    andamento_table._RESOLVED = None
    assert ensure_andamento_table() == "tabAndamento"
    assert get_andamento_table() == "tabAndamento"


@patch("database.db")
def test_ensure_andamento_table_prefers_larger(mock_db):
    mock_db.execute_query.side_effect = [
        [{"TABLE_NAME": "tabAndamento"}, {"TABLE_NAME": "tabandamento"}],
        [{"cnt": 100}],
        [{"cnt": 5000}],
    ]
    from services import andamento_table

    andamento_table._RESOLVED = None
    assert ensure_andamento_table() == "tabandamento"
