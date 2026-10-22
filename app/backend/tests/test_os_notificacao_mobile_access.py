"""Acesso mobile/PWA — Cloudflare e binding de IP para push/notificação."""
from __future__ import annotations

from unittest.mock import MagicMock

from security.cloudflare_access import is_cloudflare_public_request
from security.painel_access import is_mobile_session_friendly_api_route, should_skip_session_ip_binding
from security.session_auth import SessionData


def _request(*, path: str, method: str = "GET", session: SessionData | None = None):
    req = MagicMock()
    req.url.path = path
    req.method = method
    req.headers = {}
    req.cookies = {}
    if session is not None:
        from security.session_auth import create_session_token

        req.cookies["sagra_session"] = create_session_token(session)
    return req


class TestMobileSessionFriendlyRoutes:
    def test_push_routes_skip_ip_binding(self):
        assert is_mobile_session_friendly_api_route("/api/push/subscribe", "POST")
        assert is_mobile_session_friendly_api_route("/sagra/api/push/vapid-public-key", "GET")
        assert is_mobile_session_friendly_api_route("/api/push/test", "POST")
        assert should_skip_session_ip_binding("/api/push/subscribe", "POST")

    def test_painel_tablet_push_pref_skip_ip_binding(self):
        assert is_mobile_session_friendly_api_route(
            "/api/painel-tablet/push-pref", "GET"
        )
        assert is_mobile_session_friendly_api_route(
            "/sagra/api/painel-tablet/push-pref", "POST"
        )
        assert should_skip_session_ip_binding("/api/painel-tablet/push-pref", "POST")

    def test_painel_gravacao_skip_ip_binding(self):
        assert is_mobile_session_friendly_api_route("/api/painel/gravacao", "GET")
        assert is_mobile_session_friendly_api_route(
            "/api/painel/gravacao/2026/1001/lancar", "POST"
        )
        assert should_skip_session_ip_binding("/api/painel/gravacao", "GET")

    def test_notificacao_watch_skip_ip_binding(self):
        path = "/sagra/api/os/2026/42/notificacao-watch"
        assert is_mobile_session_friendly_api_route(path, "POST")
        assert should_skip_session_ip_binding(path, "POST")

    def test_os_history_delete_skips_ip_binding(self):
        path = "/sagra/api/os/2026/84/history/000842026-01"
        assert is_mobile_session_friendly_api_route(path, "DELETE")
        assert should_skip_session_ip_binding(path, "DELETE")
        post_path = f"{path}/delete"
        assert is_mobile_session_friendly_api_route(post_path, "POST")
        assert should_skip_session_ip_binding(post_path, "POST")

    def test_settings_delete_skips_ip_binding(self):
        assert should_skip_session_ip_binding("/api/settings/filters/1", "DELETE")
        assert should_skip_session_ip_binding(
            "/api/settings/filters/saved/1/delete", "POST"
        )

    def test_notificacao_watch_post_delete_skips_ip_binding(self):
        path = "/api/os/2026/42/notificacao-watch/delete"
        assert is_mobile_session_friendly_api_route(path, "POST")
        assert should_skip_session_ip_binding(path, "POST")

    def test_admin_mutation_does_not_skip(self):
        assert not should_skip_session_ip_binding("/api/admin/system/restart", "POST")

    def test_other_api_does_not_skip(self, monkeypatch):
        monkeypatch.setenv("SAGRA_PAINEL_SKIP_IP_CHECK", "false")
        assert not should_skip_session_ip_binding("/api/os/search", "GET")


class TestCloudflareAuthenticatedApi:
    def test_sagra_api_path_with_session_allowed(self):
        session = SessionData(
            ponto=1234,
            nome="Teste",
            ip="10.0.0.1",
            iat=1_700_000_000,
            auth_mode="password",
        )
        req = _request(
            path="/sagra/api/os/2026/1/notificacao-watch",
            method="POST",
            session=session,
        )
        assert is_cloudflare_public_request(req) is True

    def test_push_subscribe_with_local_session_allowed(self):
        session = SessionData(
            ponto=5678,
            nome="Local",
            ip="10.0.0.2",
            iat=1_700_000_000,
            auth_mode="local",
        )
        req = _request(path="/sagra/api/push/subscribe", method="POST", session=session)
        assert is_cloudflare_public_request(req) is True
