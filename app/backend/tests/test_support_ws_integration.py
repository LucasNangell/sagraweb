"""Teste integrado: manager.broadcast entrega mensagem à conexão inscrita."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_broadcast_delivers_to_subscribed_connection():
    from routers.realtime import ConnectionManager

    mgr = ConnectionManager()
    ws = AsyncMock()
    mgr.active_connections.append(
        {
            "ws": ws,
            "conn_id": "user1234",
            "ponto": "918713",
            "scope": "authenticated",
            "support_tickets": {1},
        }
    )
    mgr._ticket_conn_subscribers[1] = {"user1234"}

    payload = {
        "type": "support_chat_message",
        "ticket_id": 1,
        "owner_ponto": "918713",
        "message_id": 42,
        "message": {
            "Id": 42,
            "TicketId": 1,
            "AutorTipo": "admin",
            "Mensagem": "Olá",
            "DataCriacao": "2026-06-09T12:00:00",
        },
    }
    await mgr.broadcast(payload)

    ws.send_json.assert_called_once()
    sent = ws.send_json.call_args[0][0]
    assert sent["type"] == "support_chat_message"
    assert sent["ticket_id"] == 1
    assert sent["message"]["Mensagem"] == "Olá"


@pytest.mark.asyncio
async def test_broadcast_delivers_to_admin_subscriber_not_owner():
    from routers.realtime import ConnectionManager

    mgr = ConnectionManager()
    ws = AsyncMock()
    mgr.active_connections.append(
        {
            "ws": ws,
            "conn_id": "admin5678",
            "ponto": "918713",
            "scope": "authenticated",
            "support_tickets": {1},
        }
    )
    mgr._ticket_conn_subscribers[1] = {"admin5678"}

    await mgr.broadcast(
        {
            "type": "support_chat_message",
            "ticket_id": 1,
            "owner_ponto": "654987",
            "message_id": 43,
            "message": {
                "Id": 43,
                "TicketId": 1,
                "AutorTipo": "usuario",
                "Mensagem": "Oi admin",
            },
        }
    )

    ws.send_json.assert_called_once()


@pytest.mark.asyncio
async def test_schedule_broadcast_from_worker_thread():
    import asyncio
    import threading

    from routers.realtime import bind_main_event_loop, manager, schedule_broadcast

    loop = asyncio.get_running_loop()
    bind_main_event_loop(loop)

    ws = AsyncMock()
    manager.active_connections.clear()
    manager.active_connections.append(
        {
            "ws": ws,
            "conn_id": "thr9999",
            "ponto": "918713",
            "scope": "authenticated",
            "support_tickets": {2},
        }
    )
    manager._ticket_conn_subscribers[2] = {"thr9999"}

    done = threading.Event()
    errors: list[str] = []

    def worker() -> None:
        try:
            schedule_broadcast(
                {
                    "type": "support_chat_message",
                    "ticket_id": 2,
                    "owner_ponto": "654987",
                    "message": {"Id": 1, "TicketId": 2, "Mensagem": "x"},
                }
            )
        except Exception as exc:
            errors.append(str(exc))
        finally:
            done.set()

    threading.Thread(target=worker, daemon=True).start()
    for _ in range(50):
        if done.is_set():
            break
        await asyncio.sleep(0.05)

    assert not errors, errors
    assert done.is_set()
    await asyncio.sleep(0.05)
    ws.send_json.assert_called_once()
