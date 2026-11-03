"""Config remota dos painéis OS — schema, gate 918713 e push WS."""
from __future__ import annotations

import time

from fastapi import FastAPI
from fastapi.testclient import TestClient

from painel_remote_schema import (
    CREATE_TAB_PAINEL_CONFIG,
    CREATE_TAB_PAINEL_INSTANCIA,
    CREATE_TAB_PAINEL_PRESET,
)
from routers import painel_remote_routes
from security.painel_config_admin import is_painel_config_admin_ponto
from security.session_auth import SESSION_COOKIE_NAME, SessionData, create_session_token


def _client():
    app = FastAPI()
    app.include_router(painel_remote_routes.router)
    return TestClient(app)


def _cookies(ponto: int = 918713) -> dict[str, str]:
    token = create_session_token(
        SessionData(ponto=ponto, nome="Teste", ip="127.0.0.1", iat=int(time.time()))
    )
    return {SESSION_COOKIE_NAME: token}


def test_schema_sql_creates_painel_remote_tables():
    assert "CREATE TABLE IF NOT EXISTS tabPainelInstancia" in CREATE_TAB_PAINEL_INSTANCIA
    assert "PRIMARY KEY (ClientId)" in CREATE_TAB_PAINEL_INSTANCIA
    assert "Descricao VARCHAR(255)" in CREATE_TAB_PAINEL_INSTANCIA
    assert "CREATE TABLE IF NOT EXISTS tabPainelConfig" in CREATE_TAB_PAINEL_CONFIG
    assert "Payload JSON NOT NULL" in CREATE_TAB_PAINEL_CONFIG
    assert "CREATE TABLE IF NOT EXISTS tabPainelPreset" in CREATE_TAB_PAINEL_PRESET
    assert "UNIQUE KEY uq_painel_preset_nome" in CREATE_TAB_PAINEL_PRESET


def test_admin_ponto_gate():
    assert is_painel_config_admin_ponto(918713) is True
    assert is_painel_config_admin_ponto("918713") is True
    assert is_painel_config_admin_ponto("918.713") is True
    assert is_painel_config_admin_ponto(123) is False
    assert is_painel_config_admin_ponto(None) is False


def test_hello_upserts_instance(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(painel_remote_routes.svc.db, "execute_query", fake_exec)
    monkeypatch.setattr(painel_remote_routes.svc, "_lookup_ip_descricao", lambda ip: "TV SEFOC")
    response = _client().post(
        "/api/painel/hello",
        json={"clientId": "client-abc-1234", "route": "setor-moderno", "sector": "SEFOC"},
    )
    assert response.status_code == 200
    assert response.json()["clientId"] == "client-abc-1234"
    assert calls
    assert calls[0][1][0] == "client-abc-1234"
    assert "SEFOC" in calls[0][1]


def test_hello_rejects_short_client_id():
    response = _client().post(
        "/api/painel/hello",
        json={"clientId": "abc", "route": "setor", "sector": "SEFOC"},
    )
    assert response.status_code == 400


def test_get_config_empty(monkeypatch):
    monkeypatch.setattr(painel_remote_routes.svc.db, "execute_query", lambda *a, **k: [])
    response = _client().get("/api/painel/config", params={"clientId": "client-abc-1234"})
    assert response.status_code == 200
    assert response.json()["payload"] is None


def test_get_config_returns_payload(monkeypatch):
    monkeypatch.setattr(
        painel_remote_routes.svc.db,
        "execute_query",
        lambda sql, params=None: [
            {"Payload": '{"sector":"SEFOC"}', "UpdatedAt": None, "UpdatedBy": "918713"}
        ],
    )
    response = _client().get("/api/painel/config", params={"clientId": "client-abc-1234"})
    assert response.status_code == 200
    assert response.json()["payload"] == {"sector": "SEFOC"}


def test_instances_forbidden_for_other_ponto():
    response = _client().get("/api/admin/painel/instances", cookies=_cookies(111111))
    assert response.status_code == 403


def test_instances_lists_live_hello_connections(monkeypatch):
    class FakeManager:
        @staticmethod
        def get_painel_instances():
            return [
                {
                    "clientId": "client-abc-1234",
                    "route": "tablet",
                    "sector": "SEIMP",
                    "ip": "10.1.1.9",
                }
            ]

    monkeypatch.setattr(
        "routers.realtime.manager",
        FakeManager(),
        raising=False,
    )
    monkeypatch.setattr(
        painel_remote_routes.svc,
        "fetch_instances_map",
        lambda ids: {
            "client-abc-1234": {
                "clientId": "client-abc-1234",
                "nome": "TV SEIMP",
                "setor": "SEIMP",
                "descricao": "Corredor",
                "ip": "10.1.1.9",
                "route": "tablet",
                "lastSeen": "2026-04-01 10:00:00",
            }
        },
    )
    response = _client().get("/api/admin/painel/instances", cookies=_cookies())
    assert response.status_code == 200
    rows = response.json()["instances"]
    assert len(rows) == 1
    assert rows[0]["nome"] == "TV SEIMP"
    assert rows[0]["setor"] == "SEIMP"
    assert rows[0]["online"] is True


def test_put_config_broadcasts_target_client(monkeypatch):
    pushed = []

    monkeypatch.setattr(
        painel_remote_routes.svc,
        "upsert_config",
        lambda cid, payload, actor: {
            "payload": payload,
            "updatedAt": "2026-04-01 10:00:00",
            "updatedBy": actor,
        },
    )
    monkeypatch.setattr(painel_remote_routes.svc, "upsert_instance", lambda *a, **k: None)
    monkeypatch.setattr(
        painel_remote_routes.svc,
        "push_config_update",
        lambda cid, payload=None, sector=None: pushed.append(
            {"clientId": cid, "payload": payload, "sector": sector}
        ),
    )
    response = _client().put(
        "/api/admin/painel/config/client-abc-1234",
        cookies=_cookies(),
        json={"payload": {"sector": "SEFOC", "columnCount": 1, "columns": []}},
    )
    assert response.status_code == 200
    assert pushed[0]["clientId"] == "client-abc-1234"
    assert pushed[0]["payload"]["sector"] == "SEFOC"


def test_push_config_update_emits_target_client_id(monkeypatch):
    sent = []
    monkeypatch.setattr(
        "routers.realtime.schedule_broadcast",
        lambda message: sent.append(message),
    )
    from services.painel_remote_config_service import push_config_update

    push_config_update(
        "client-abc-1234",
        payload={"sector": "SEFOC"},
        sector="SEFOC",
    )
    assert sent[0]["type"] == "painel_config_update"
    assert sent[0]["target_client_id"] == "client-abc-1234"
    assert sent[0]["payload"]["sector"] == "SEFOC"


def test_put_instance_sector_pushes_update(monkeypatch):
    pushed = []
    monkeypatch.setattr(
        painel_remote_routes.svc,
        "update_instance_profile",
        lambda *a, **k: {
            "clientId": "client-abc-1234",
            "nome": "TV SEPAC",
            "setor": "SEPAC",
            "descricao": "Corredor",
        },
    )
    monkeypatch.setattr(
        painel_remote_routes.svc,
        "merge_config_sector",
        lambda *a, **k: {"payload": {"sector": "SEPAC"}},
    )
    monkeypatch.setattr(
        painel_remote_routes.svc,
        "push_config_update",
        lambda cid, payload=None, sector=None: pushed.append(
            {"clientId": cid, "payload": payload, "sector": sector}
        ),
    )
    response = _client().put(
        "/api/admin/painel/instances/client-abc-1234",
        cookies=_cookies(),
        json={"nome": "TV SEPAC", "setor": "SEPAC", "descricao": "Corredor"},
    )
    assert response.status_code == 200
    assert pushed[0]["clientId"] == "client-abc-1234"
    assert pushed[0]["payload"]["sector"] == "SEPAC"
    assert pushed[0]["sector"] == "SEPAC"


def test_put_config_forbidden_for_other_ponto():
    response = _client().put(
        "/api/admin/painel/config/client-abc-1234",
        cookies=_cookies(222222),
        json={"payload": {"sector": "SEFOC"}},
    )
    assert response.status_code == 403


def test_admin_painel_path_is_not_master_only():
    from security.api_auth import _is_admin_api

    assert _is_admin_api("/api/admin/secret") is True
    assert _is_admin_api("/api/admin/painel/instances") is False
    assert _is_admin_api("/api/admin/painel/config/abc") is False
    assert _is_admin_api("/api/admin/painel/presets") is False


def test_presets_forbidden_for_other_ponto():
    response = _client().get("/api/admin/painel/presets", cookies=_cookies(111111))
    assert response.status_code == 403


def test_preset_crud(monkeypatch):
    store = []

    def fake_list():
        return list(store)

    def fake_create(nome, payload, actor):
        row = {
            "id": len(store) + 1,
            "nome": nome,
            "payload": payload,
            "updatedAt": "2026-04-01 10:00:00",
            "updatedBy": actor,
        }
        store.append(row)
        return row

    def fake_delete(pid):
        before = len(store)
        store[:] = [row for row in store if row["id"] != pid]
        return len(store) < before or True

    monkeypatch.setattr(painel_remote_routes.svc, "list_presets", fake_list)
    monkeypatch.setattr(painel_remote_routes.svc, "create_preset", fake_create)
    monkeypatch.setattr(painel_remote_routes.svc, "delete_preset", fake_delete)

    client = _client()
    created = client.post(
        "/api/admin/painel/presets",
        cookies=_cookies(),
        json={
            "nome": "TV SEFOC vermelho",
            "payload": {"models": {"high": "v79-red"}, "entryAnimation": "fx-iris"},
        },
    )
    assert created.status_code == 200
    assert created.json()["preset"]["nome"] == "TV SEFOC vermelho"
    listed = client.get("/api/admin/painel/presets", cookies=_cookies())
    assert listed.status_code == 200
    assert len(listed.json()["presets"]) == 1
    deleted = client.delete("/api/admin/painel/presets/1", cookies=_cookies())
    assert deleted.status_code == 200
