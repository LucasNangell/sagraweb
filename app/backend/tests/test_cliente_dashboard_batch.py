"""Batch de tokens do dashboard cliente — helpers SQL seguros."""
from routers.cliente_gabinete_routes import _os_in_clause


def test_os_in_clause_empty():
    sql, params = _os_in_clause([])
    assert sql == ""
    assert params == ()


def test_os_in_clause_single_pair():
    sql, params = _os_in_clause([(123, 2024)])
    assert "(NroProtocolo, AnoProtocolo) IN ((%s, %s))" in sql
    assert params == (123, 2024)


def test_os_in_clause_multiple_pairs():
    sql, params = _os_in_clause([(1, 2024), (2, 2025)])
    assert sql.count("(%s, %s)") == 2
    assert params == (1, 2024, 2, 2025)
