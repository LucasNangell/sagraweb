"""Paridade RBAC no host público + helpers SPA."""
from __future__ import annotations

import time

import pytest
from starlette.requests import Request


class TestSpaAccessHelpers:
    def test_shell_paths(self):
        from security.spa_access import is_spa_shell_path

        assert is_spa_shell_path("/") is True
        assert is_spa_shell_path("/index.html") is True
        assert is_spa_shell_path("/gerencia") is False

    def test_only_gex_default_route(self):
        from security.spa_access import (
            has_screen_access_for_spa_path,
            resolve_default_spa_route,
        )

        perms = {"sb_gravacao_externa": True}
        assert has_screen_access_for_spa_path("/gravacao-externa", perms) is True
        assert has_screen_access_for_spa_path("/", perms) is False
        assert has_screen_access_for_spa_path("/gerencia", perms) is False
        assert resolve_default_spa_route(perms) == "/gravacao-externa"

    def test_gex_or_pendente(self):
        from security.spa_access import has_screen_access_for_spa_path

        assert has_screen_access_for_spa_path(
            "/gravacao-externa", {"sb_gravacao_pendente": True}
        )
        assert not has_screen_access_for_spa_path(
            "/gravacao-externa", {"sb_gravacao": True}
        )

    def test_multi_module_default_prefers_inicio(self):
        from security.spa_access import resolve_default_spa_route

        perms = {
            "sb_inicio": True,
            "sb_gerencia": True,
            "sb_gravacao_externa": True,
        }
        assert resolve_default_spa_route(perms) == "/"

    def test_gerencia_and_analise_access(self):
        from security.spa_access import has_screen_access_for_spa_path

        perms = {"sb_gerencia": True, "sb_analise": True}
        assert has_screen_access_for_spa_path("/gerencia", perms)
        assert has_screen_access_for_spa_path("/analise", perms)
        assert not has_screen_access_for_spa_path("/email", perms)

    def test_orcamento_exige_ctx_orcamento(self):
        from security.spa_access import has_screen_access_for_spa_path

        assert has_screen_access_for_spa_path("/orcamento", {"ctx_orcamento": True})
        assert not has_screen_access_for_spa_path("/orcamento", {"sb_gerencia": True})

    def test_authenticated_only_and_dynamic_deep_links_are_mapped(self):
        from security.spa_access import (
            _AUTHENTICATED_ONLY,
            has_screen_access_for_spa_path,
            required_permission_for_spa_path,
        )

        assert required_permission_for_spa_path("/mensagens") == _AUTHENTICATED_ONLY
        assert has_screen_access_for_spa_path("/mensagens", {}) is True
        assert (
            required_permission_for_spa_path("/os/2026/123/fluxo-producao")
            == "sb_gerencia"
        )
        assert required_permission_for_spa_path("/os/invalida") == "__MASTER_ONLY__"


class TestResolveClientIpCloudflare:
    def test_cf_connecting_ip_preferred_over_xff(self):
        from security.api_auth import resolve_client_ip

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [
                (b"host", b"cgrafsysvm.camara.leg.br"),
                (b"x-forwarded-for", b"104.28.193.83, 10.1.1.73"),
                (b"cf-connecting-ip", b"203.0.113.40"),
            ],
            "client": ("127.0.0.1", 50000),
        }
        assert resolve_client_ip(Request(scope)) == "203.0.113.40"


class TestAccessControlPublicPassword:
    @pytest.fixture
    def password_cookie(self, session_secret):
        from security.public_access import AUTH_MODE_PASSWORD
        from security.session_auth import SessionData, create_session_token

        session = SessionData(
            ponto=555001,
            nome="Fornecedor Ext",
            ip="203.0.113.40",
            iat=int(time.time()),
            auth_mode=AUTH_MODE_PASSWORD,
        )
        return create_session_token(session)

    @pytest.fixture
    def spa_app(self, monkeypatch):
        from fastapi import FastAPI
        from fastapi.responses import HTMLResponse

        # Import after env fixtures; middleware class lives on api module
        monkeypatch.setenv("SAGRA_SPA_ACCESS_CONTROL", "1")
        monkeypatch.setattr(
            "security.spa_access.is_spa_access_control_enabled",
            lambda: True,
        )
        monkeypatch.setattr(
            "security.api_auth.is_master_client",
            lambda _request: False,
        )
        monkeypatch.setattr(
            "routers.api.is_master_client",
            lambda _request: False,
        )

        from routers.api import AccessControlMiddleware

        app = FastAPI()
        app.add_middleware(AccessControlMiddleware)

        @app.get("/")
        def root():
            return HTMLResponse("<html>shell</html>")

        @app.get("/gravacao-externa")
        def gex():
            return HTMLResponse("<html>gex</html>")

        @app.get("/gerencia")
        def gerencia():
            return HTMLResponse("<html>gerencia</html>")

        @app.get("/analise")
        def analise():
            return HTMLResponse("<html>analise</html>")

        return app

    def test_shell_allowed_without_sb_inicio(
        self, spa_app, password_cookie, monkeypatch
    ):
        from fastapi.testclient import TestClient
        from security.session_auth import SESSION_COOKIE_NAME

        monkeypatch.setattr(
            "security.spa_access.resolve_page_permissions",
            lambda *_a, **_k: {"sb_gravacao_externa": True, "sb_inicio": False},
        )
        client = TestClient(spa_app, follow_redirects=False)
        res = client.get(
            "/",
            cookies={SESSION_COOKIE_NAME: password_cookie},
            headers={
                "Host": "cgrafsysvm.camara.leg.br",
                "Accept": "text/html",
            },
        )
        assert res.status_code == 200
        assert "shell" in res.text

    def test_gex_deep_link_allowed(self, spa_app, password_cookie, monkeypatch):
        from fastapi.testclient import TestClient
        from security.session_auth import SESSION_COOKIE_NAME

        monkeypatch.setattr(
            "security.spa_access.resolve_page_permissions",
            lambda *_a, **_k: {"sb_gravacao_externa": True},
        )
        client = TestClient(spa_app, follow_redirects=False)
        res = client.get(
            "/gravacao-externa",
            cookies={SESSION_COOKIE_NAME: password_cookie},
            headers={
                "Host": "cgrafsysvm.camara.leg.br",
                "Accept": "text/html",
            },
        )
        assert res.status_code == 200
        assert "gex" in res.text

    def test_gerencia_and_analise_with_flags(
        self, spa_app, password_cookie, monkeypatch
    ):
        from fastapi.testclient import TestClient
        from security.session_auth import SESSION_COOKIE_NAME

        monkeypatch.setattr(
            "security.spa_access.resolve_page_permissions",
            lambda *_a, **_k: {"sb_gerencia": True, "sb_analise": True},
        )
        client = TestClient(spa_app, follow_redirects=False)
        headers = {
            "Host": "cgrafsysvm.camara.leg.br",
            "Accept": "text/html",
        }
        cookies = {SESSION_COOKIE_NAME: password_cookie}
        assert client.get("/gerencia", cookies=cookies, headers=headers).status_code == 200
        assert client.get("/analise", cookies=cookies, headers=headers).status_code == 200

    def test_denied_route_redirects_to_allowed(
        self, spa_app, password_cookie, monkeypatch
    ):
        from fastapi.testclient import TestClient
        from security.session_auth import SESSION_COOKIE_NAME

        monkeypatch.setattr(
            "security.spa_access.resolve_page_permissions",
            lambda *_a, **_k: {"sb_gravacao_externa": True},
        )
        client = TestClient(spa_app, follow_redirects=False)
        res = client.get(
            "/gerencia",
            cookies={SESSION_COOKIE_NAME: password_cookie},
            headers={
                "Host": "cgrafsysvm.camara.leg.br",
                "Accept": "text/html",
            },
        )
        assert res.status_code == 302
        assert res.headers.get("location") == "/gravacao-externa"

    def test_no_modules_account_message_not_ip(
        self, spa_app, password_cookie, monkeypatch
    ):
        from fastapi.testclient import TestClient
        from security.session_auth import SESSION_COOKIE_NAME

        monkeypatch.setattr(
            "security.spa_access.resolve_page_permissions",
            lambda *_a, **_k: {},
        )
        client = TestClient(spa_app, follow_redirects=False)
        res = client.get(
            "/gerencia",
            cookies={SESSION_COOKIE_NAME: password_cookie},
            headers={
                "Host": "cgrafsysvm.camara.leg.br",
                "Accept": "text/html",
            },
        )
        assert res.status_code == 403
        assert "Seu IP" not in res.text
        assert "conta" in res.text.lower() or "permissão" in res.text.lower()


class TestFornecedorAutoGex:
    def test_create_fornecedor_upserts_gex(self, monkeypatch):
        from routers import user_admin_routes as routes

        calls: list[tuple] = []

        def fake_execute(sql, params=None):
            calls.append((sql, params))
            return []

        monkeypatch.setattr(routes.db, "execute_query", fake_execute)
        monkeypatch.setattr(
            routes,
            "upsert_user_permissions",
            lambda ponto, data: calls.append(("upsert", ponto, data)),
        )
        monkeypatch.setattr(routes, "send_activation_email", lambda **_k: None)
        monkeypatch.setattr(
            routes, "generate_activation_token", lambda: "tok" * 8
        )

        import asyncio

        body = routes.UserCreateRequest(
            ponto=777001,
            nome="Fornecedor Teste",
            email="fornecedor.teste@example.com",
            setor="SEFOC",
            fornecedor=True,
        )
        result = asyncio.run(routes.create_auth_user(body))
        assert result["status"] == "ok"
        assert any(
            c[0] == "upsert" and c[1] == 777001 and c[2].get("sb_gravacao_externa") is True
            for c in calls
        )

    def test_create_non_fornecedor_no_auto_gex(self, monkeypatch):
        from routers import user_admin_routes as routes

        upserts: list = []

        monkeypatch.setattr(routes.db, "execute_query", lambda *_a, **_k: [])
        monkeypatch.setattr(
            routes,
            "upsert_user_permissions",
            lambda ponto, data: upserts.append((ponto, data)),
        )
        monkeypatch.setattr(routes, "send_activation_email", lambda **_k: None)
        monkeypatch.setattr(
            routes, "generate_activation_token", lambda: "tok" * 8
        )

        import asyncio

        body = routes.UserCreateRequest(
            ponto=777002,
            nome="Usuario Interno",
            email="interno.teste@example.com",
            setor="SEFOC",
            fornecedor=False,
        )
        asyncio.run(routes.create_auth_user(body))
        assert upserts == []

    def test_update_enable_fornecedor_grants_gex(self, monkeypatch):
        from routers import user_admin_routes as routes

        upserts: list = []
        monkeypatch.setattr(
            routes.db,
            "execute_query",
            lambda sql, params=None: [{"Ponto": 777003}]
            if "SELECT" in str(sql).upper()
            else None,
        )
        monkeypatch.setattr(
            routes,
            "upsert_user_permissions",
            lambda ponto, data: upserts.append((ponto, data)),
        )

        import asyncio

        body = routes.UserProfileUpdate(fornecedor=True)
        asyncio.run(routes.update_user_profile(777003, body))
        assert upserts == [(777003, {"sb_gravacao_externa": True})]
