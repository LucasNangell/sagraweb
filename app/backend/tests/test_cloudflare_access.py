"""Testes de detecção de host público (domínio internet vs LAN)."""
from __future__ import annotations

from starlette.requests import Request


def _request(host: str, path: str = "/") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": [(b"host", host.encode())],
    }
    return Request(scope)


class TestTrustedPublicHost:
    def test_camara_leg_domain_is_public(self):
        from security.cloudflare_access import is_trusted_public_host

        req = _request("cgrafsysvm.camara.leg.br")
        assert is_trusted_public_host(req) is True

    def test_redecamara_domain_is_internal(self):
        from security.cloudflare_access import is_trusted_public_host

        req = _request("cgrafsysvm.redecamara.camara.gov.br")
        assert is_trusted_public_host(req) is False

    def test_intranet_hostname_is_not_public(self):
        from security.cloudflare_access import is_trusted_public_host

        req = _request("cgrafsysvm")
        assert is_trusted_public_host(req) is False

    def test_lan_ip_is_not_public(self):
        from security.cloudflare_access import is_trusted_public_host

        req = _request("10.1.1.73")
        assert is_trusted_public_host(req) is False

    def test_cgraf_online_still_public(self):
        from security.cloudflare_access import is_trusted_public_host

        req = _request("cgraf.online")
        assert is_trusted_public_host(req) is True


class TestCloudflarePublicRequest:
    def test_root_allowed_on_camara_leg_domain(self):
        from security.cloudflare_access import is_cloudflare_public_request

        req = _request("cgrafsysvm.camara.leg.br", "/")
        assert is_cloudflare_public_request(req) is True

    def test_root_blocked_on_redecamara_domain(self):
        from security.cloudflare_access import is_cloudflare_public_request

        req = _request("cgrafsysvm.redecamara.camara.gov.br", "/")
        assert is_cloudflare_public_request(req) is False

    def test_root_blocked_on_lan_host(self):
        from security.cloudflare_access import is_cloudflare_public_request

        req = _request("10.1.1.73", "/")
        assert is_cloudflare_public_request(req) is False

    def test_painel_setor_allowed_on_camara_leg(self):
        from security.cloudflare_access import is_cloudflare_public_request

        req = _request("cgrafsysvm.camara.leg.br", "/painel/setor")
        assert is_cloudflare_public_request(req) is True

    def test_login_allowed_on_camara_leg(self):
        from security.cloudflare_access import is_cloudflare_public_request

        req = _request("cgrafsysvm.camara.leg.br", "/login")
        assert is_cloudflare_public_request(req) is True

    def test_internal_route_blocked_on_camara_leg(self):
        from security.cloudflare_access import is_cloudflare_public_request

        req = _request("cgrafsysvm.camara.leg.br", "/gerencia")
        assert is_cloudflare_public_request(req) is False

    def test_password_session_allows_internal_routes_on_camara_leg(self, monkeypatch):
        from security.cloudflare_access import is_cloudflare_public_request
        from security.public_access import AUTH_MODE_PASSWORD
        from security.session_auth import SessionData

        session = SessionData(
            ponto=555001,
            nome="Ext",
            ip="203.0.113.40",
            iat=1,
            auth_mode=AUTH_MODE_PASSWORD,
        )
        monkeypatch.setattr(
            "security.public_access.get_password_session",
            lambda _request: session,
        )
        for path in ("/gerencia", "/analise", "/gravacao-externa"):
            req = _request("cgrafsysvm.camara.leg.br", path)
            assert is_cloudflare_public_request(req) is True, path

    def test_cliente_api_blocked_without_session_on_camara_leg(self):
        from security.cloudflare_access import is_cloudflare_public_request

        req = _request("cgrafsysvm.camara.leg.br", "/api/cliente/me")
        assert is_cloudflare_public_request(req) is False

    def test_cliente_session_allows_cliente_api_on_camara_leg(self, monkeypatch):
        from security.cloudflare_access import is_cloudflare_public_request
        from security.session_auth import AUTH_MODE_CLIENTE, SessionData

        session = SessionData(
            ponto=0,
            nome="Gabinete",
            ip="203.0.113.40",
            iat=1,
            auth_mode=AUTH_MODE_CLIENTE,
            cliente_id=42,
            gabinete="Teste",
            cliente_tipo="gabinete",
        )
        monkeypatch.setattr(
            "security.session_auth.get_cliente_session_from_request",
            lambda _request: session,
        )
        for path in (
            "/api/cliente/me",
            "/api/cliente/dashboard",
            "/sagra/api/cliente/me",
        ):
            req = _request("cgrafsysvm.camara.leg.br", path)
            assert is_cloudflare_public_request(req) is True, path

    def test_cliente_session_does_not_open_staff_routes(self, monkeypatch):
        from security.cloudflare_access import is_cloudflare_public_request
        from security.session_auth import AUTH_MODE_CLIENTE, SessionData

        session = SessionData(
            ponto=0,
            nome="Gabinete",
            ip="203.0.113.40",
            iat=1,
            auth_mode=AUTH_MODE_CLIENTE,
            cliente_id=42,
            gabinete="Teste",
            cliente_tipo="gabinete",
        )
        monkeypatch.setattr(
            "security.session_auth.get_cliente_session_from_request",
            lambda _request: session,
        )
        req = _request("cgrafsysvm.camara.leg.br", "/gerencia")
        assert is_cloudflare_public_request(req) is False
