"""after_andamento_changed — refresh + WebSocket na ordem correta."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.os_andamento_post_change_service import after_andamento_changed


@patch("routers.realtime.schedule_broadcast")
@patch("routers.pcp_routes.invalidate_pcp_queue_cache")
@patch("services.os_ultimo_andamento_service.refresh_os_ultimo_andamento_operacional")
@patch("services.os_ultimo_andamento_service.fetch_operacional_row")
def test_after_andamento_changed_refresh_then_ws(
    mock_fetch,
    mock_refresh,
    mock_pcp_inv,
    mock_schedule,
):
    mock_fetch.return_value = {
        "situacao": "Saída p/",
        "setor": "SEFOC",
        "cod_status": "059672026-02",
    }

    result = after_andamento_changed(
        5967,
        2026,
        "history_added",
        source="test",
        notify=True,
        setor="SEFOC",
        situacao="Saída p/",
    )

    mock_refresh.assert_called_once_with(5967, 2026, cursor=None)
    mock_schedule.assert_called_once()
    payload = mock_schedule.call_args[0][0]
    assert payload["type"] == "system_update"
    assert payload["id"] == 5967
    assert payload["action"] == "history_added"
    assert result["notified"] is True
    assert result["situacao"] == "Saída p/"


@patch("services.os_ultimo_andamento_service.refresh_os_ultimo_andamento_operacional")
@patch("services.os_ultimo_andamento_service.fetch_operacional_row", return_value=None)
def test_after_andamento_changed_no_notify(mock_fetch, mock_refresh):
    with patch("routers.realtime.schedule_broadcast") as mock_ws:
        result = after_andamento_changed(
            1,
            2026,
            "recalc_ultimo_status",
            notify=False,
            cursor=MagicMock(),
        )
    mock_refresh.assert_called_once()
    mock_ws.assert_not_called()
    assert result["notified"] is False
    assert result.get("cleared") is True
