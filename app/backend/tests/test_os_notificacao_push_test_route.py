from __future__ import annotations

import time
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import os_notificacao_routes
from security.session_auth import SESSION_COOKIE_NAME, SessionData, create_session_token


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(os_notificacao_routes.router, prefix="/api")
    return TestClient(app)


def _cookies(ponto: int = 918713) -> dict[str, str]:
    token = create_session_token(
        SessionData(ponto=ponto, nome="Operador Teste", ip="127.0.0.1", iat=int(time.time()))
    )
    return {SESSION_COOKIE_NAME: token}


def test_push_test_requires_session():
    response = _client().post("/api/push/test")
    assert response.status_code == 403


def test_push_test_sends_ws_and_web_push():
    with patch(
        "services.notification_push_service.push_user_notification"
    ) as push_ws, patch(
        "services.web_push_service.count_push_subscriptions_for_ponto",
        return_value=2,
    ), patch(
        "services.web_push_service.send_web_push_to_ponto",
        return_value=1,
    ) as web_push, patch(
        "services.os_notificacao_dispatch_service._spa_public_base",
        return_value="https://cgrafsysvm/sagra",
    ):
        response = _client().post("/api/push/test", cookies=_cookies())

    assert response.status_code == 200
    body = response.json()
    assert body == {"ws": True, "web_push_sent": 1, "web_push_subs": 2}
    push_ws.assert_called_once()
    assert push_ws.call_args.kwargs["browser_notify"] is True
    assert push_ws.call_args.kwargs["target_ponto"] == "918713"
    web_push.assert_called_once()
    assert web_push.call_args.kwargs["tag"] == "sagra-push-test"
