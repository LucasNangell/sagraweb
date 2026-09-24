"""Cadastro sem e-mail e geração de link de senha pelo MASTER."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from routers import user_admin_routes as routes

TOKEN = "tok" * 8


@pytest.fixture
def patched(monkeypatch):
    calls: list[tuple] = []
    state: dict = {"rows": []}
    sent: list[dict] = []

    def fake_execute(sql, params=None):
        calls.append((sql, params))
        if sql.lstrip().upper().startswith("SELECT"):
            return state["rows"]
        return []

    monkeypatch.setattr(routes.db, "execute_query", fake_execute)
    monkeypatch.setattr(routes, "upsert_user_permissions", lambda *_a, **_k: None)
    monkeypatch.setattr(routes, "send_activation_email", lambda **k: sent.append(k))
    monkeypatch.setattr(routes, "generate_activation_token", lambda: TOKEN)
    monkeypatch.setattr(
        routes, "build_activation_link", lambda t: f"http://host/login/activate?token={t}"
    )
    monkeypatch.setattr(
        routes, "build_password_reset_link", lambda t: f"http://host/login/reset?token={t}"
    )
    return {"calls": calls, "state": state, "sent": sent}


class TestCreateWithoutEmail:
    def test_blank_email_becomes_none(self):
        body = routes.UserCreateRequest(ponto=1, nome="Fulano", email="   ")
        assert body.email is None

    def test_missing_email_is_allowed(self):
        body = routes.UserCreateRequest(ponto=1, nome="Fulano")
        assert body.email is None

    def test_create_without_email_returns_link_and_skips_mail(self, patched):
        body = routes.UserCreateRequest(ponto=777100, nome="Sem Email", setor="SEFOC")
        result = asyncio.run(routes.create_auth_user(body))

        assert result["status"] == "ok"
        assert result["email"] is None
        assert result["activation_link"] == f"http://host/login/activate?token={TOKEN}"
        assert patched["sent"] == []

        insert = next(c for c in patched["calls"] if "INSERT INTO tabUsuarios" in c[0])
        assert insert[1][2] is None
        assert not any(
            "WHERE Email = %s" in c[0] for c in patched["calls"]
        ), "não deve checar duplicidade de e-mail quando não informado"

    def test_create_with_email_sends_mail_without_link(self, patched):
        body = routes.UserCreateRequest(
            ponto=777101, nome="Com Email", email="com.email@example.com"
        )
        result = asyncio.run(routes.create_auth_user(body))

        assert result["email"] == "com.email@example.com"
        assert "activation_link" not in result
        assert len(patched["sent"]) == 1


class TestGeneratePasswordLink:
    def test_active_account_gets_reset_link(self, patched):
        patched["state"]["rows"] = [
            {"Ponto": 5, "EmailVerified": 1, "PasswordHash": "hash", "AuthAtivo": 1}
        ]
        result = asyncio.run(routes.generate_password_link(5))

        assert result["tipo"] == "reset"
        assert result["link"] == f"http://host/login/reset?token={TOKEN}"
        assert any("PasswordResetToken = %s" in c[0] for c in patched["calls"])
        assert patched["sent"] == []

    def test_pending_account_gets_activation_link(self, patched):
        patched["state"]["rows"] = [
            {"Ponto": 6, "EmailVerified": 0, "PasswordHash": None, "AuthAtivo": 1}
        ]
        result = asyncio.run(routes.generate_password_link(6))

        assert result["tipo"] == "ativacao"
        assert result["link"] == f"http://host/login/activate?token={TOKEN}"
        assert any("ActivationToken = %s" in c[0] for c in patched["calls"])

    def test_unknown_user_is_404(self, patched):
        patched["state"]["rows"] = []
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.generate_password_link(999))
        assert exc.value.status_code == 404

    def test_disabled_account_is_400(self, patched):
        patched["state"]["rows"] = [
            {"Ponto": 7, "EmailVerified": 1, "PasswordHash": "hash", "AuthAtivo": 0}
        ]
        with pytest.raises(HTTPException) as exc:
            asyncio.run(routes.generate_password_link(7))
        assert exc.value.status_code == 400
