"""Regressão: fanout WS com peer travado não prende o event loop / notify."""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import Request
from starlette.datastructures import Headers


class _HangingWebSocket:
    """send_json nunca completa — simula socket half-open."""

    def __init__(self) -> None:
        self.send_started = asyncio.Event()

    async def send_json(self, _message) -> None:
        self.send_started.set()
        await asyncio.Future()  # never resolves


class _OkWebSocket:
    def __init__(self) -> None:
        self.sent: list = []

    async def send_json(self, message) -> None:
        self.sent.append(message)


@pytest.mark.asyncio
async def test_broadcast_times_out_hanging_peer_and_keeps_healthy():
    from routers.realtime import ConnectionManager, _WS_SEND_TIMEOUT_SEC

    mgr = ConnectionManager()
    hanging = _HangingWebSocket()
    ok = _OkWebSocket()
    mgr.active_connections = [
        {"ws": hanging, "ponto": "1", "scope": "authenticated", "conn_id": "hang"},
        {"ws": ok, "ponto": "2", "scope": "authenticated", "conn_id": "ok"},
    ]

    message = {
        "type": "force_refresh",
        "action": "reload",
        "origem": "admin_panel",
        "id": 0,
        "ano": 0,
    }

    started = time.monotonic()
    await mgr.broadcast(message)
    elapsed = time.monotonic() - started

    assert elapsed < _WS_SEND_TIMEOUT_SEC + 1.5
    assert ok.sent == [message]
    assert len(mgr.active_connections) == 1
    assert mgr.active_connections[0]["ws"] is ok


@pytest.mark.asyncio
async def test_send_notification_returns_without_awaiting_broadcast():
    from routers.realtime import send_notification

    body = {
        "type": "force_refresh",
        "action": "reload",
        "origem": "admin_panel",
        "id": 0,
        "ano": 0,
    }

    request = MagicMock(spec=Request)
    request.json = AsyncMock(return_value=body)
    request.headers = Headers({})

    scheduled: list = []

    def _capture(msg):
        scheduled.append(msg)

    with (
        patch(
            "security.notify_auth.is_notify_authorized",
            return_value=True,
        ),
        patch(
            "services.admin_reload_state.record_admin_reload",
            return_value={"epoch": 1, "overwriteConfig": False},
        ) as record_mock,
        patch("routers.realtime.schedule_broadcast", side_effect=_capture) as sched_mock,
        patch("routers.realtime.manager") as mgr_mock,
    ):
        mgr_mock.active_connections = [object(), object()]
        result = await send_notification(request)

    assert result["status"] == "queued"
    assert result["listeners"] == 2
    record_mock.assert_called_once_with(overwrite_config=False)
    sched_mock.assert_called_once_with(body)
    assert scheduled == [body]
    mgr_mock.broadcast.assert_not_called()
