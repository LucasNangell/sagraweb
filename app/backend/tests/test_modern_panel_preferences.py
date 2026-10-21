"""Preferências do novo painel isoladas do painel de setor existente, sem banco real."""
import json
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import settings_routes
from security.session_auth import SessionData, require_session


@pytest.fixture
def preference_client(monkeypatch):
    monkeypatch.setattr(settings_routes, "_ensure_user_preferences_table", lambda: None)
    app = FastAPI()
    app.include_router(settings_routes.router)
    app.dependency_overrides[require_session] = lambda: SessionData(
        ponto=999, nome="Teste", ip="127.0.0.1", iat=int(time.time())
    )
    return TestClient(app)


def test_modern_panel_saves_to_its_own_key(preference_client, monkeypatch):
    calls = []
    monkeypatch.setattr(settings_routes.db, "execute_query", lambda sql, args: calls.append(args))
    payload = {"sector": "SEFOC", "columns": [{"id": "1", "title": "Entrada", "statuses": []}]}
    response = preference_client.put("/settings/preferences/painel_setor_moderno", json={"payload": payload})
    assert response.status_code == 200
    assert calls[0][:2] == ("999", "painel_setor_moderno")
    assert json.loads(calls[0][2]) == payload


@pytest.mark.parametrize("key", ["painel_setor", "painel_setor_moderno"])
def test_both_panels_keep_sector_defaults(key, preference_client, monkeypatch):
    monkeypatch.setattr(settings_routes.db, "execute_query", lambda *args: [])
    monkeypatch.setattr(settings_routes, "fetch_user_setor", lambda ponto: "SEFOC")
    monkeypatch.setattr(settings_routes, "fetch_setor_painel_default", lambda sector: {"columns": [{"id": "1"}]})
    response = preference_client.get(f"/settings/preferences/{key}")
    assert response.status_code == 200
    assert response.json()["payload"] == {"sector": "SEFOC", "columns": [{"id": "1"}]}


def test_preference_key_validation_is_preserved(preference_client):
    assert preference_client.get("/settings/preferences/invalid").status_code == 400
