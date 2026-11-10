"""Sessão deslizante: cookie renovado enquanto o sistema estiver em uso."""
from __future__ import annotations

import time


def _token(age_seconds: int) -> str:
    from security.session_auth import SessionData, create_session_token

    return create_session_token(
        SessionData(
            ponto=918713,
            nome="Teste Automatizado",
            ip="127.0.0.1",
            iat=int(time.time()) - age_seconds,
        )
    )


class TestSessionSlidingRefresh:
    def test_recent_session_not_reissued(self, api_client, session_secret):
        from security.session_auth import SESSION_COOKIE_NAME

        res = api_client.get(
            "/api/protected", cookies={SESSION_COOKIE_NAME: _token(60)}
        )
        assert res.status_code == 200
        assert SESSION_COOKIE_NAME not in res.cookies

    def test_old_session_is_reissued_with_new_iat(self, api_client, session_secret):
        from security.session_auth import (
            SESSION_COOKIE_NAME,
            SESSION_MAX_AGE_SECONDS,
            load_session_token,
        )

        # 6 dias e 23h: perto de expirar — deve ser renovada ao usar o sistema.
        old = _token(SESSION_MAX_AGE_SECONDS - 3600)
        res = api_client.get("/api/protected", cookies={SESSION_COOKIE_NAME: old})
        assert res.status_code == 200
        renewed = res.cookies.get(SESSION_COOKIE_NAME)
        assert renewed and renewed != old
        # SimpleCookie aspeia valores com "=" (padding base64); o Starlette remove ao ler.
        session = load_session_token(renewed.strip('"'))
        assert session is not None
        assert session.ponto == 918713
        assert time.time() - session.iat < 60

    def test_expired_session_returns_session_code(self, api_client, session_secret):
        from security.session_auth import (
            SESSION_COOKIE_NAME,
            SESSION_ERROR_INVALID,
            SESSION_MAX_AGE_SECONDS,
        )

        res = api_client.get(
            "/api/protected",
            cookies={SESSION_COOKIE_NAME: _token(SESSION_MAX_AGE_SECONDS + 60)},
        )
        assert res.status_code == 403
        assert res.json()["code"] == SESSION_ERROR_INVALID

    def test_ip_mismatch_returns_specific_code(
        self, api_client, session_secret, monkeypatch
    ):
        from security.session_auth import SESSION_COOKIE_NAME, SESSION_ERROR_IP_MISMATCH

        monkeypatch.setattr(
            "config_manager.config_manager.is_development", lambda: False
        )
        monkeypatch.setattr(
            "security.api_auth.resolve_client_ip", lambda _r: "10.9.9.9"
        )
        res = api_client.get(
            "/api/protected", cookies={SESSION_COOKIE_NAME: _token(60)}
        )
        assert res.status_code == 403
        assert res.json()["code"] == SESSION_ERROR_IP_MISMATCH

    def test_permission_denied_has_no_session_code(
        self, api_client, session_cookies, monkeypatch
    ):
        monkeypatch.setattr(
            "security.user_permissions.resolve_effective_permissions",
            lambda *_a, **_k: None,
        )
        res = api_client.get("/api/protected", cookies=session_cookies)
        assert res.status_code == 403
        assert "code" not in res.json()

    def test_session_needs_refresh_threshold(self, session_secret):
        from security.session_auth import (
            SESSION_REFRESH_AFTER_SECONDS,
            SessionData,
            session_needs_refresh,
        )

        now = time.time()
        fresh = SessionData(ponto=1, nome="x", ip="1", iat=int(now) - 10)
        old = SessionData(
            ponto=1, nome="x", ip="1", iat=int(now) - SESSION_REFRESH_AFTER_SECONDS
        )
        assert session_needs_refresh(fresh, now) is False
        assert session_needs_refresh(old, now) is True
        assert session_needs_refresh(None, now) is False
