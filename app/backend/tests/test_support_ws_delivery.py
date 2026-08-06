"""Testes de subscribe/delivery WebSocket do chat de suporte."""
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


@pytest.fixture
def mgr():
    from routers.realtime import ConnectionManager

    return ConnectionManager()


class TestSupportPontoUtils:
    def test_normalize_ponto_digits_strips_spaces(self):
        from services.support_ponto_utils import normalize_ponto_digits, ponto_matches

        assert normalize_ponto_digits(" 918713 ") == "918713"
        assert ponto_matches(" 918713 ", "918713") is True

    def test_extract_ticket_id_variants(self):
        from services.support_ponto_utils import extract_support_ticket_id

        assert extract_support_ticket_id({"ticket_id": 6}) == 6
        assert extract_support_ticket_id({"ticketId": "6"}) == 6
        assert extract_support_ticket_id({"ticket": 6}) == 6
        assert extract_support_ticket_id({"payload": {"ticket_id": 6}}) == 6
        assert extract_support_ticket_id({"ticket_id": 0}) is None
        assert extract_support_ticket_id({"ticket_id": "x"}) is None


class TestSupportSubscribe:
    def test_subscribe_registers_ticket_on_connection(self, mgr):
        ws_a = object()
        mgr.active_connections.append(
            {
                "ws": ws_a,
                "conn_id": "aaaa1111",
                "ponto": "918713",
                "scope": "authenticated",
                "support_tickets": set(),
            }
        )
        before, after, accepted, reason = mgr.subscribe_support_ticket(ws_a, 6)
        assert accepted is True
        assert reason == "ok"
        assert before == set()
        assert after == {6}
        assert 6 in mgr.active_connections[0]["support_tickets"]

    def test_subscribe_registers_global_ponto_subscription(self, mgr):
        ws_a = object()
        ws_b = object()
        mgr.active_connections.extend(
            [
                {
                    "ws": ws_a,
                    "conn_id": "aaaa1111",
                    "ponto": "918713",
                    "scope": "authenticated",
                    "support_tickets": set(),
                },
                {
                    "ws": ws_b,
                    "conn_id": "bbbb2222",
                    "ponto": "918713",
                    "scope": "authenticated",
                    "support_tickets": set(),
                },
            ]
        )
        mgr.subscribe_support_ticket(ws_a, 6)
        assert mgr._is_ponto_subscribed("918713", 6) is True

        msg = {
            "type": "support_chat_message",
            "ticket_id": 6,
            "owner_ponto": "999999",
            "message": {"Id": 1},
        }
        conn_b = mgr.active_connections[1]
        assert mgr._should_deliver(conn_b, msg) is True

    def test_delivery_by_owner_without_subscribe(self, mgr):
        conn = {
            "ws": object(),
            "ponto": "918713",
            "scope": "authenticated",
            "support_tickets": set(),
        }
        msg = {
            "type": "support_chat_message",
            "ticket_id": 6,
            "owner_ponto": "918713",
            "message": {"Id": 1},
        }
        assert mgr._should_deliver(conn, msg) is True

    def test_no_leak_to_other_user(self, mgr):
        conn = {
            "ws": object(),
            "ponto": "999999",
            "scope": "authenticated",
            "support_tickets": set(),
        }
        msg = {
            "type": "support_chat_message",
            "ticket_id": 6,
            "owner_ponto": "918713",
            "message": {"Id": 1},
        }
        assert mgr._should_deliver(conn, msg) is False

    def test_delivery_when_subscribed_on_connection(self, mgr):
        conn = {
            "ws": object(),
            "ponto": "999999",
            "scope": "authenticated",
            "support_tickets": {6},
        }
        msg = {
            "type": "support_chat_message",
            "ticket_id": 6,
            "owner_ponto": "918713",
            "message": {"Id": 2},
        }
        assert mgr._should_deliver(conn, msg) is True

    def test_unsubscribe_removes_ticket_not_others(self, mgr):
        ws = object()
        mgr.active_connections.append(
            {
                "ws": ws,
                "conn_id": "cccc3333",
                "ponto": "918713",
                "scope": "authenticated",
                "support_tickets": {5, 6},
            }
        )
        mgr._register_ponto_subscription("918713", 5)
        mgr._register_ponto_subscription("918713", 6)
        before, after, reason = mgr.unsubscribe_support_ticket(ws, 6)
        assert reason == "ok"
        assert before == {5, 6}
        assert after == {5}
        assert mgr._is_ponto_subscribed("918713", 6) is False
        assert mgr._is_ponto_subscribed("918713", 5) is True

    def test_ws_subscribe_accepts_ticket_id_field(self, ws_client, session_cookies):
        from routers.realtime import manager

        manager.active_connections.clear()
        manager._ponto_subscriptions.clear()
        manager._ticket_conn_subscribers.clear()
        with ws_client.websocket_connect("/ws", cookies=session_cookies) as ws:
            ws.send_json({"type": "support_subscribe", "ticket_id": 6})
            conn = manager.active_connections[0]
            assert 6 in conn["support_tickets"]
            assert manager._is_ponto_subscribed("918713", 6) is True

class TestSupportBroadcast:
    def test_support_payload_uses_schedule_broadcast_not_http_only(self, monkeypatch):
        from services import notification_push_service as nps

        http_called = {"v": False}
        schedule_called = {"v": False}

        def fake_http(_payload):
            http_called["v"] = True
            return True

        def fake_schedule(payload):
            schedule_called["v"] = True
            assert payload["type"] == "support_chat_message"

        monkeypatch.setattr(nps, "_http_notify", fake_http)
        monkeypatch.setattr(
            "routers.realtime.schedule_broadcast",
            fake_schedule,
        )

        nps.broadcast_ws_payload(
            {
                "type": "support_chat_message",
                "ticket_id": 6,
                "owner_ponto": "918713",
                "message": {"Id": 1},
            }
        )

        assert schedule_called["v"] is True
        assert http_called["v"] is False

    def test_admin_receives_via_ticket_subscribe(self, mgr):
        ws_admin = object()
        mgr.active_connections.append(
            {
                "ws": ws_admin,
                "conn_id": "admin1234",
                "ponto": "111111",
                "scope": "authenticated",
                "support_tickets": set(),
            }
        )
        mgr.subscribe_support_ticket(ws_admin, 6)
        msg = {
            "type": "support_chat_message",
            "ticket_id": 6,
            "owner_ponto": "918713",
            "message": {"Id": 99, "Mensagem": "Oi admin"},
        }
        assert mgr._should_deliver(mgr.active_connections[0], msg) is True

    def test_ws_subscribe_accepts_ticket_id_camel_case(self, ws_client, session_cookies):
        from routers.realtime import manager

        manager.active_connections.clear()
        manager._ponto_subscriptions.clear()
        manager._ticket_conn_subscribers.clear()
        with ws_client.websocket_connect("/ws", cookies=session_cookies) as ws:
            ws.send_json({"type": "support_subscribe", "ticketId": 6})
            conn = manager.active_connections[0]
            assert 6 in conn["support_tickets"]
