"""GET /os/{ano}/{id}/ultimo-andamento — alinhado ao andamento operacional."""
from __future__ import annotations

from unittest.mock import patch

from routers.analise_routes import get_last_movement


@patch("services.os_ultimo_andamento_service.fetch_operacional_row")
def test_get_last_movement_uses_operacional_row(mock_fetch):
    mock_fetch.return_value = {
        "situacao": "Em Execução",
        "setor": "SEFOC",
        "ponto": "918713",
        "observacao": "Em análise",
        "data": "2026-07-07",
    }

    result = get_last_movement(ano=2026, id=100)

    mock_fetch.assert_called_once_with(100, 2026)
    assert result == {
        "situacao": "Em Execução",
        "setor": "SEFOC",
        "ponto": "918713",
        "obs": "Em análise",
        "data": "2026-07-07",
        "usuario": "918713",
    }


@patch("services.os_ultimo_andamento_service.fetch_operacional_row", return_value=None)
def test_get_last_movement_empty_when_no_operacional(mock_fetch):
    assert get_last_movement(ano=2026, id=999) == {"situacao": None}
    mock_fetch.assert_called_once_with(999, 2026)
