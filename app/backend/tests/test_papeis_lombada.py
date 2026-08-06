"""Contrato de GET /aux/papeis-lombada."""
from __future__ import annotations

from unittest.mock import patch

from routers.auxiliar_routes import get_papeis_lombada
from schemas.auxiliar import PapelLombadaRow


class _FakeResponse:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


class TestPapeisLombada:
    @patch("lookup_sync.sync_papel_espessura_from_lombada_mdb")
    @patch("routers.auxiliar_routes.sync_lookup_tables_from_mdb_if_empty")
    @patch("routers.auxiliar_routes.db")
    def test_returns_rows_with_espessura(self, mock_db, _sync, _esp_sync):
        mock_db.execute_query.return_value = [
            {"CodPapel": 1, "Papel": "ap 75gr AA", "Espessura": 80.0},
            {"CodPapel": 23, "Papel": "Couché Fosco 250gr", "Espessura": 220},
            {"CodPapel": 9, "Papel": "Normal", "Espessura": None},
            {"CodPapel": 99, "Papel": "", "Espessura": 10},
        ]
        response = _FakeResponse()
        rows = get_papeis_lombada(response)  # type: ignore[arg-type]
        assert response.headers.get("Cache-Control") == "private, max-age=60"
        assert rows == [
            PapelLombadaRow(CodPapel=1, Papel="ap 75gr AA", Espessura=80.0),
            PapelLombadaRow(CodPapel=23, Papel="Couché Fosco 250gr", Espessura=220.0),
        ]
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "Espessura IS NOT NULL" in sql
        assert "ORDER BY Papel" in sql
        _esp_sync.assert_called_once()
