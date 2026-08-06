"""Testes de cookie/sessão HMAC — sem banco."""
from __future__ import annotations

import time

import pytest
from fastapi import Response


class TestSessionToken:
    def test_valid_token_loads_session(self, valid_session_token):
        from security.session_auth import load_session_token

        session = load_session_token(valid_session_token)
        assert session is not None
        assert session.ponto == 918713
        assert session.nome == "Teste Automatizado"

    def test_expired_token_rejected(self, session_secret):
        from security.session_auth import (
            SESSION_MAX_AGE_SECONDS,
            SessionData,
            create_session_token,
            load_session_token,
        )

        old = SessionData(
            ponto=1,
            nome="Old",
            ip="127.0.0.1",
            iat=int(time.time()) - SESSION_MAX_AGE_SECONDS - 60,
        )
        token = create_session_token(old)
        assert load_session_token(token) is None

    def test_tampered_signature_rejected(self, valid_session_token):
        from security.session_auth import load_session_token

        payload, _, sig = valid_session_token.partition(".")
        tampered = f"{payload}.{'0' * len(sig)}"
        assert load_session_token(tampered) is None

    def test_missing_token_returns_none(self):
        from security.session_auth import load_session_token

        assert load_session_token(None) is None
        assert load_session_token("") is None

    def test_production_requires_secret(self, monkeypatch):
        from config_manager import config_manager

        monkeypatch.delenv("SAGRA_SESSION_SECRET", raising=False)
        monkeypatch.setenv("ENV", "production")
        monkeypatch.setattr(config_manager, "is_development", lambda: False)
        monkeypatch.setattr(config_manager, "get", lambda key, default=None: default)

        from security import session_auth

        with pytest.raises(RuntimeError, match="SAGRA_SESSION_SECRET"):
            session_auth._session_secret()

    def test_production_rejects_dev_fallback_secret(self, monkeypatch):
        from config_manager import config_manager
        from security import session_auth

        monkeypatch.setenv("SAGRA_SESSION_SECRET", session_auth._DEV_FALLBACK_SECRET)
        monkeypatch.setenv("ENV", "production")
        monkeypatch.setattr(config_manager, "is_development", lambda: False)

        with pytest.raises(RuntimeError, match="desenvolvimento"):
            session_auth._session_secret()

    def test_cookie_secure_in_production_https(self, monkeypatch):
        from config_manager import config_manager
        from security.session_auth import SessionData, set_session_cookie

        monkeypatch.setenv("ENV", "production")
        monkeypatch.delenv("SAGRA_SESSION_SECURE", raising=False)
        monkeypatch.setattr(config_manager, "is_development", lambda: False)
        monkeypatch.setattr(
            config_manager,
            "get",
            lambda key, default=None: "https://cgrafsysvm.redecamara.camara.gov.br"
            if key == "public_web_base"
            else default,
        )

        response = Response()
        set_session_cookie(
            response,
            SessionData(ponto=1, nome="U", ip="127.0.0.1", iat=int(time.time())),
        )
        set_cookie = response.headers.get("set-cookie", "")
        assert "secure" in set_cookie.lower()

    def test_cookie_not_secure_in_development(self, monkeypatch):
        from config_manager import config_manager
        from security.session_auth import SessionData, set_session_cookie

        monkeypatch.setenv("ENV", "development")
        monkeypatch.setattr(config_manager, "is_development", lambda: True)

        response = Response()
        set_session_cookie(
            response,
            SessionData(ponto=1, nome="U", ip="127.0.0.1", iat=int(time.time())),
        )
        set_cookie = response.headers.get("set-cookie", "")
        assert "secure" not in set_cookie.lower()
