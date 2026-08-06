"""WebSocket — conexão, escopo e desconexão."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def ws_app():
    from routers import realtime

    app = FastAPI()
    app.include_router(realtime.router)
    return app


@pytest.fixture
def ws_client(ws_app):
    return TestClient(ws_app)


class TestWebSocket:
    def test_api_ws_trailing_slash(self, ws_client):
        with ws_client.websocket_connect("/api/ws/") as ws:
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"

    def test_anonymous_connection_painel_scope(self, ws_client):
        from routers.realtime import manager

        with ws_client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "ping"})
            pong = ws.receive_json()
            assert pong["type"] == "pong"
            assert len(manager.active_connections) == 1
            assert manager.active_connections[0]["scope"] == "painel"
            assert manager.active_connections[0]["ponto"] is None

    def test_authenticated_connection_sets_ponto(
        self, ws_client, session_cookies
    ):
        from routers.realtime import manager

        with ws_client.websocket_connect("/ws", cookies=session_cookies) as ws:
            ws.send_json({"type": "ping"})
            assert ws.receive_json()["type"] == "pong"
            assert len(manager.active_connections) == 1
            conn = manager.active_connections[0]
            assert conn["scope"] == "authenticated"
            assert conn["ponto"] == "918713"

    def test_disconnect_cleans_connections(self, ws_client):
        from routers.realtime import manager

        with ws_client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "ping"})
            ws.receive_json()
            assert len(manager.active_connections) == 1

        assert len(manager.active_connections) == 0

    def test_painel_scope_filters_private_message_types(self):
        from routers.realtime import ConnectionManager

        mgr = ConnectionManager()
        painel_conn = {"ws": object(), "ponto": None, "scope": "painel"}
        assert mgr._should_deliver(painel_conn, {"type": "system_update"}) is True
        assert mgr._should_deliver(painel_conn, {"type": "notification_new"}) is False

    def test_notification_new_reaches_authenticated_clients(self):
        from routers.realtime import ConnectionManager

        mgr = ConnectionManager()
        auth_conn = {"ws": object(), "ponto": "918713", "scope": "authenticated"}
        msg = {
            "type": "notification_new",
            "target_ponto": "999999",
            "mensagem": "teste",
        }
        assert mgr._should_deliver(auth_conn, msg) is True

    def test_support_chat_message_delivered_to_ticket_owner(self):
        from routers.realtime import ConnectionManager

        mgr = ConnectionManager()
        owner_conn = {
            "ws": object(),
            "ponto": "918713",
            "scope": "authenticated",
            "support_tickets": set(),
        }
        msg = {
            "type": "support_chat_message",
            "ticket_id": 5,
            "owner_ponto": "918713",
            "message": {"Id": 1, "Mensagem": "Olá"},
        }
        assert mgr._should_deliver(owner_conn, msg) is True

    def test_support_chat_message_not_delivered_to_other_user(self):
        from routers.realtime import ConnectionManager

        mgr = ConnectionManager()
        other_conn = {
            "ws": object(),
            "ponto": "111111",
            "scope": "authenticated",
            "support_tickets": set(),
        }
        msg = {
            "type": "support_chat_message",
            "ticket_id": 5,
            "owner_ponto": "918713",
            "message": {"Id": 1, "Mensagem": "Olá"},
        }
        assert mgr._should_deliver(other_conn, msg) is False

    def test_support_chat_message_delivered_when_subscribed(self):
        from routers.realtime import ConnectionManager

        mgr = ConnectionManager()
        admin_conn = {
            "ws": object(),
            "ponto": "999999",
            "scope": "authenticated",
            "support_tickets": {5},
        }
        msg = {
            "type": "support_chat_message",
            "ticket_id": 5,
            "owner_ponto": "918713",
            "message": {"Id": 2, "Mensagem": "Resposta"},
        }
        assert mgr._should_deliver(admin_conn, msg) is True

    def test_support_chat_message_not_deduped(self):
        from routers.realtime import ConnectionManager

        mgr = ConnectionManager()
        msg_a = {
            "type": "support_chat_message",
            "ticket_id": 5,
            "owner_ponto": "918713",
            "message": {"Id": 1},
        }
        msg_b = {
            "type": "support_chat_message",
            "ticket_id": 5,
            "owner_ponto": "918713",
            "message": {"Id": 2},
        }
        assert mgr._dedupe_key(msg_a) is None
        assert mgr._dedupe_key(msg_b) is None

    def test_gravacao_externa_message_not_deduped(self):
        from routers.realtime import ConnectionManager

        mgr = ConnectionManager()
        msg_a = {
            "type": "gravacao_externa_message",
            "os_ano": 2026,
            "os_nro": 100,
            "message_id": 1,
            "message": {"id": 1, "mensagem": "A"},
        }
        msg_b = {
            "type": "gravacao_externa_message",
            "os_ano": 2026,
            "os_nro": 100,
            "message_id": 2,
            "message": {"id": 2, "mensagem": "B"},
        }
        assert mgr._dedupe_key(msg_a) is None
        assert mgr._dedupe_key(msg_b) is None

    def test_gravacao_lifecycle_dedupe_includes_os_fields(self):
        from routers.realtime import ConnectionManager
        import json

        mgr = ConnectionManager()
        msg_a = {
            "type": "gravacao_externa_iniciada",
            "os_ano": 2026,
            "os_nro": 100,
            "gravacao_externa_id": 1,
        }
        msg_b = {
            "type": "gravacao_externa_iniciada",
            "os_ano": 2026,
            "os_nro": 200,
            "gravacao_externa_id": 2,
        }
        assert mgr._dedupe_key(msg_a) != mgr._dedupe_key(msg_b)
        parsed_a = json.loads(mgr._dedupe_key(msg_a))
        assert parsed_a["os_nro"] == 100
        assert parsed_a["gravacao_externa_id"] == 1

    def test_gravacao_notification_dedupe_includes_message_id(self):
        from routers.realtime import ConnectionManager
        import json

        mgr = ConnectionManager()
        msg_a = {
            "type": "notification_new",
            "action": "gravacao_externa_mensagem",
            "ano": 2026,
            "id": 100,
            "gravacao_message_id": 1,
        }
        msg_b = {
            "type": "notification_new",
            "action": "gravacao_externa_mensagem",
            "ano": 2026,
            "id": 100,
            "gravacao_message_id": 2,
        }
        assert mgr._dedupe_key(msg_a) != mgr._dedupe_key(msg_b)
        assert json.loads(mgr._dedupe_key(msg_a))["gravacao_message_id"] == 1

    def test_socket_message_preserves_support_fields(self):
        from routers.realtime import SocketMessage

        msg = SocketMessage.model_validate(
            {
                "type": "support_chat_message",
                "ticket_id": 4,
                "message_id": 99,
                "message": {"Id": 99, "Mensagem": "Oi"},
                "author_role": "admin",
            }
        )
        dumped = msg.model_dump(exclude_none=True)
        assert dumped["ticket_id"] == 4
        assert dumped["message_id"] == 99
        assert dumped["message"]["Id"] == 99
