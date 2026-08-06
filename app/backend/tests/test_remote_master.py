"""Testes de acesso remote-master (918713 via internet)."""
from __future__ import annotations

import time

import pytest


@pytest.fixture
def remote_master_session_token(session_secret):
    from security.public_access import AUTH_MODE_PASSWORD
    from security.session_auth import SessionData, create_session_token

    session = SessionData(
        ponto=918713,
        nome="Admin Remoto",
        ip="203.0.113.50",
        iat=int(time.time()),
        auth_mode=AUTH_MODE_PASSWORD,
    )
    return create_session_token(session)


@pytest.fixture
def remote_master_cookies(remote_master_session_token):
    from security.session_auth import SESSION_COOKIE_NAME

    return {SESSION_COOKIE_NAME: remote_master_session_token}


class TestRemoteMaster:
    def test_is_remote_master_ponto(self):
        from security.remote_master import is_remote_master_ponto

        assert is_remote_master_ponto(918713) is True
        assert is_remote_master_ponto(123456) is False
        assert is_remote_master_ponto(None) is False

    def test_is_master_client_on_public_internet(
        self, api_client, remote_master_cookies, monkeypatch
    ):
        def _master_client_impl(request):
            from security.api_auth import is_privileged_request
            from security.remote_master import is_remote_master_request

            return is_privileged_request(request) or is_remote_master_request(request)

        monkeypatch.setattr(
            "security.api_auth.is_master_client",
            _master_client_impl,
        )
        monkeypatch.setattr(
            "security.public_access.is_public_internet_request",
            lambda _request: True,
        )
        monkeypatch.setattr(
            "security.api_auth.is_privileged_request",
            lambda _request: False,
        )

        res = api_client.get(
            "/api/admin/secret",
            cookies=remote_master_cookies,
            headers={"Host": "cgraf.online"},
        )
        assert res.status_code == 200
        assert res.json()["admin"] is True

    def test_non_remote_master_still_blocked_on_internet(
        self, api_client, monkeypatch
    ):
        from security.public_access import AUTH_MODE_PASSWORD
        from security.session_auth import SESSION_COOKIE_NAME, SessionData, create_session_token

        monkeypatch.setattr(
            "security.public_access.is_public_internet_request",
            lambda _request: True,
        )
        monkeypatch.setattr(
            "security.api_auth.is_privileged_request",
            lambda _request: False,
        )

        token = create_session_token(
            SessionData(
                ponto=111111,
                nome="Outro Usuário",
                ip="203.0.113.51",
                iat=int(time.time()),
                auth_mode=AUTH_MODE_PASSWORD,
            )
        )
        res = api_client.get(
            "/api/admin/secret",
            cookies={SESSION_COOKIE_NAME: token},
            headers={"Host": "cgraf.online"},
        )
        assert res.status_code == 403

    def test_remote_master_full_permissions(self, monkeypatch):
        from starlette.requests import Request

        from security.public_access import AUTH_MODE_PASSWORD
        from security.session_auth import SessionData

        monkeypatch.setattr(
            "security.public_access.is_public_internet_request",
            lambda _request: True,
        )
        monkeypatch.setattr(
            "security.user_permissions.db.execute_query",
            lambda *_a, **_k: [{"AuthAtivo": 1, "EmailVerified": 1}],
        )

        session = SessionData(
            ponto=918713,
            nome="Admin Remoto",
            ip="203.0.113.50",
            iat=int(time.time()),
            auth_mode=AUTH_MODE_PASSWORD,
        )

        scope = {
            "type": "http",
            "method": "GET",
            "path": "/api/permissions",
            "headers": [(b"host", b"cgraf.online")],
            "query_string": b"",
        }
        request = Request(scope)

        from security.user_permissions import resolve_effective_permissions

        perms = resolve_effective_permissions(
            request,
            session,
            get_client_permissions=lambda _ip: None,
        )
        assert perms is not None
        assert perms["sb_admin_ips"] is True
        assert perms["sb_usuarios"] is True
        assert perms["sb_cotas_graf"] is True


class TestPublicUserPermissionsOverride:
    """Internet + password: user_permissions prevalece; sem fallback IP."""

    def test_timestamp_alone_is_not_customized(self):
        from datetime import datetime, timedelta

        from security.user_permissions import is_user_permissions_customized

        created = datetime(2026, 1, 1, 12, 0, 0)
        row = {
            "created_at": created,
            "updated_at": created + timedelta(hours=1),
            "sb_inicio": 0,
        }
        assert is_user_permissions_customized(row) is False

    def test_flag_true_is_customized(self):
        from security.user_permissions import is_user_permissions_customized

        assert is_user_permissions_customized({"sb_inicio": 1}) is True

    def test_public_password_no_custom_does_not_inherit_ip(self, monkeypatch):
        from starlette.requests import Request

        from security.public_access import AUTH_MODE_PASSWORD
        from security.session_auth import SessionData
        from security.user_permissions import resolve_effective_permissions

        monkeypatch.setattr(
            "security.public_access.is_public_internet_request",
            lambda _request: True,
        )
        monkeypatch.setattr(
            "security.user_permissions.db.execute_query",
            lambda *_a, **_k: [{"AuthAtivo": 1, "EmailVerified": 1}],
        )
        monkeypatch.setattr(
            "security.user_permissions.get_user_permissions_row",
            lambda _ponto: {"sb_inicio": 0, "sb_admin_ips": 0},
        )

        session = SessionData(
            ponto=222222,
            nome="User Net",
            ip="203.0.113.90",
            iat=int(time.time()),
            auth_mode=AUTH_MODE_PASSWORD,
        )
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/",
                "headers": [(b"host", b"cgrafsysvm.camara.leg.br")],
                "query_string": b"",
            }
        )

        generous_ip = {"ip": "203.0.113.90", "sb_inicio": True, "sb_admin_ips": True}
        perms = resolve_effective_permissions(
            request,
            session,
            get_client_permissions=lambda _ip: generous_ip,
        )
        assert perms is not None
        assert perms["sb_inicio"] is False
        assert perms["sb_admin_ips"] is False

    def test_public_password_custom_user_overrides_ip(self, monkeypatch):
        from starlette.requests import Request

        from security.public_access import AUTH_MODE_PASSWORD
        from security.session_auth import SessionData
        from security.user_permissions import resolve_effective_permissions

        monkeypatch.setattr(
            "security.public_access.is_public_internet_request",
            lambda _request: True,
        )
        monkeypatch.setattr(
            "security.user_permissions.db.execute_query",
            lambda *_a, **_k: [{"AuthAtivo": 1, "EmailVerified": 1}],
        )
        monkeypatch.setattr(
            "security.user_permissions.get_user_permissions_row",
            lambda _ponto: {"sb_inicio": 1, "sb_analise": 1, "sb_admin_ips": 0},
        )

        session = SessionData(
            ponto=333333,
            nome="User Net",
            ip="203.0.113.91",
            iat=int(time.time()),
            auth_mode=AUTH_MODE_PASSWORD,
        )
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/",
                "headers": [(b"host", b"cgrafsysvm.camara.leg.br")],
                "query_string": b"",
            }
        )

        ip_with_admin = {
            "ip": "203.0.113.91",
            "sb_inicio": False,
            "sb_analise": False,
            "sb_admin_ips": True,
        }
        perms = resolve_effective_permissions(
            request,
            session,
            get_client_permissions=lambda _ip: ip_with_admin,
        )
        assert perms is not None
        assert perms["sb_inicio"] is True
        assert perms["sb_analise"] is True
        # Usuário não herda sb_admin_ips do IP na internet
        assert perms["sb_admin_ips"] is False
