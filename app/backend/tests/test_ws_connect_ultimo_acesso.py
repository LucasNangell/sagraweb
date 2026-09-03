"""WS connect não bloqueia o event loop com UPDATE UltimoAcesso."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_connect_updates_ultimo_acesso_via_to_thread():
    from routers.realtime import ConnectionManager

    mgr = ConnectionManager()
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.client = MagicMock(host="127.0.0.1")
    ws.url = "ws://test/ws"

    sync_calls: list[tuple] = []

    def _fake_execute(query, params=None):
        sync_calls.append((query, params))
        return []

    async def _to_thread(fn, *args):
        # Simula offload: não roda no "loop" de forma síncrona pelo caller
        return fn(*args)

    with (
        patch("routers.realtime.db.execute_query", side_effect=_fake_execute),
        patch("routers.realtime.asyncio.to_thread", side_effect=_to_thread) as to_thread_mock,
    ):
        await mgr.connect(ws, ponto="918713", scope="authenticated")

    to_thread_mock.assert_called_once()
    assert len(sync_calls) == 1
    assert "UltimoAcesso" in sync_calls[0][0]
    assert sync_calls[0][1] == (918713,)
    assert len(mgr.active_connections) == 1


@pytest.mark.asyncio
async def test_connect_painel_skips_ultimo_acesso_update():
    from routers.realtime import ConnectionManager

    mgr = ConnectionManager()
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.client = MagicMock(host="127.0.0.1")
    ws.url = "ws://test/ws"

    with (
        patch("routers.realtime.db.execute_query") as exec_mock,
        patch("routers.realtime.asyncio.to_thread", new_callable=AsyncMock) as to_thread_mock,
    ):
        await mgr.connect(ws, ponto=None, scope="painel")

    exec_mock.assert_not_called()
    to_thread_mock.assert_not_called()
    assert len(mgr.active_connections) == 1
