"""Testes do APIAccessMiddleware — rotas públicas, sessão e RBAC."""
from __future__ import annotations


class TestAPIAccessMiddleware:
    def test_public_health_without_session(self, api_client):
        res = api_client.get("/health")
        assert res.status_code == 200

    def test_public_app_version_without_session(self, api_client):
        res = api_client.get("/api/app-version")
        assert res.status_code == 200
        assert "build_id" in res.json()

    def test_public_api_config_without_session(self, api_client):
        res = api_client.get("/api/config/public")
        assert res.status_code == 200

    def test_protected_route_denied_without_session(self, api_client):
        res = api_client.get("/api/protected")
        assert res.status_code == 403
        assert "Sessão" in res.json().get("detail", "")

    def test_protected_route_allowed_with_session(
        self, api_client, session_cookies
    ):
        res = api_client.get("/api/protected", cookies=session_cookies)
        assert res.status_code == 200
        assert res.json()["ok"] is True

    def test_admin_route_denied_for_non_master(
        self, api_client, session_cookies
    ):
        res = api_client.get("/api/admin/secret", cookies=session_cookies)
        assert res.status_code == 403
        assert "MASTER" in res.json().get("detail", "")

    def test_fail_closed_when_permissions_none(
        self, api_client, session_cookies, monkeypatch
    ):
        monkeypatch.setattr(
            "security.user_permissions.resolve_effective_permissions",
            lambda *_a, **_k: None,
        )
        res = api_client.get("/api/protected", cookies=session_cookies)
        assert res.status_code == 403
        assert "não autorizado" in res.json().get("detail", "").lower()

    def test_admin_allowed_for_master(
        self, api_client, session_cookies, monkeypatch
    ):
        monkeypatch.setattr(
            "security.api_auth.is_master_client",
            lambda _request: True,
        )
        res = api_client.get("/api/admin/secret", cookies=session_cookies)
        assert res.status_code == 200
        assert res.json()["admin"] is True

    def test_notify_denied_without_auth(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from security.api_auth import APIAccessMiddleware

        app = FastAPI()
        app.add_middleware(APIAccessMiddleware)

        @app.post("/api/realtime/notify")
        def notify():
            return {"ok": True}

        monkeypatch.setattr(
            "security.notify_auth.is_notify_authorized",
            lambda _request: False,
        )
        client = TestClient(app)
        res = client.post("/api/realtime/notify", json={"type": "system_update"})
        assert res.status_code == 403

    def test_notify_denied_with_sagra_api_prefix(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from security.api_auth import APIAccessMiddleware

        app = FastAPI()
        app.add_middleware(APIAccessMiddleware)

        @app.post("/sagra/api/realtime/notify")
        def notify():
            return {"ok": True}

        monkeypatch.setattr(
            "security.notify_auth.is_notify_authorized",
            lambda _request: False,
        )
        client = TestClient(app)
        res = client.post("/sagra/api/realtime/notify", json={"type": "system_update"})
        assert res.status_code == 403
