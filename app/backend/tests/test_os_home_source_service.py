"""refresh_home_os_sources — materializada + filtros + WS na ordem correta."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.os_home_source_service import refresh_home_os_sources


@patch("routers.realtime.schedule_broadcast")
@patch("services.os_filter_options_service.upsert_filter_options_for_os")
@patch("services.os_ultimo_andamento_service.refresh_os_ultimo_andamento_operacional")
@patch("services.os_ultimo_andamento_service.fetch_operacional_row")
def test_refresh_home_os_sources_order(
    mock_fetch,
    mock_refresh,
    mock_filter,
    mock_schedule,
):
    mock_fetch.return_value = {
        "situacao": "Recebido",
        "setor": "SEFOC",
        "cod_status": "059672026-01",
    }

    result = refresh_home_os_sources(
        5967,
        2026,
        "history_added",
        source="sagra_web",
        notify=True,
    )

    mock_refresh.assert_called_once()
    mock_filter.assert_called_once_with(5967, 2026, cursor=None)
    mock_schedule.assert_called_once()
    assert result["notified"] is True
    assert result["filter_options_refreshed"] is True


@patch("services.os_ultimo_andamento_service.refresh_os_ultimo_andamento_operacional")
@patch("services.os_ultimo_andamento_service.fetch_operacional_row", return_value=None)
def test_refresh_home_os_sources_no_notify(mock_fetch, mock_refresh):
    with patch("routers.realtime.schedule_broadcast") as mock_ws:
        result = refresh_home_os_sources(
            1,
            2026,
            "recalc",
            notify=False,
            cursor=MagicMock(),
        )
    mock_refresh.assert_called_once()
    mock_ws.assert_not_called()
    assert result.get("cleared") is True
