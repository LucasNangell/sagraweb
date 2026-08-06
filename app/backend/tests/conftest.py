"""Fixtures compartilhadas — sem banco de produção."""
from __future__ import annotations

import os
import time

import pytest

# Garante modo dev e secret estável antes de importar módulos de segurança.
os.environ.setdefault("ENV", "development")
os.environ.setdefault(
    "SAGRA_SESSION_SECRET",
    "test-session-secret-32-chars-minimum!!",
)
os.environ.setdefault("SAGRA_RATE_LIMIT_ENABLED", "true")
os.environ.setdefault("MYSQL_ONLY", "true")


@pytest.fixture
def session_secret(monkeypatch):
    secret = "test-session-secret-32-chars-minimum!!"
    monkeypatch.setenv("SAGRA_SESSION_SECRET", secret)
    monkeypatch.setenv("ENV", "development")
    return secret


@pytest.fixture
def valid_session_token(session_secret):
    from security.session_auth import SessionData, create_session_token

    session = SessionData(
        ponto=918713,
        nome="Teste Automatizado",
        ip="127.0.0.1",
        iat=int(time.time()),
    )
    return create_session_token(session)


@pytest.fixture
def session_cookies(valid_session_token):
    from security.session_auth import SESSION_COOKIE_NAME

    return {SESSION_COOKIE_NAME: valid_session_token}


@pytest.fixture
def api_test_app(monkeypatch):
    """App mínimo com APIAccessMiddleware e rotas fake (sem MySQL)."""
    from fastapi import FastAPI
    from security.api_auth import APIAccessMiddleware

    app = FastAPI()
    app.add_middleware(APIAccessMiddleware)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/app-version")
    def app_version():
        return {"build_id": "test-build"}

    @app.get("/api/config/public")
    def public_config():
        return {"env": "test"}

    @app.get("/api/protected")
    def protected():
        return {"ok": True, "permissions": True}

    @app.get("/api/admin/secret")
    def admin_secret():
        return {"admin": True}

    def _allow_permissions(*_args, **_kwargs):
        return {"sb_inicio": True, "sb_analise": True}

    monkeypatch.setattr(
        "security.user_permissions.resolve_effective_permissions",
        _allow_permissions,
    )
    monkeypatch.setattr(
        "security.api_auth.is_master_client",
        lambda _request: False,
    )
    monkeypatch.setattr(
        "config_manager.config_manager.is_development",
        lambda: True,
    )
    return app


@pytest.fixture
def api_client(api_test_app):
    from fastapi.testclient import TestClient

    return TestClient(api_test_app)


@pytest.fixture(autouse=True)
def reset_ws_connections():
    from routers.realtime import manager

    manager.active_connections.clear()
    yield
    manager.active_connections.clear()


@pytest.fixture
def storage_root(tmp_path, monkeypatch):
    """Root autorizado isolado para testes de file_access."""
    root = tmp_path / "storage"
    root.mkdir()
    monkeypatch.setattr(
        "security.file_access.get_allowed_roots",
        lambda: [str(root.resolve())],
    )
    return root
