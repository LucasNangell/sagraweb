"""Rotas e schema do letreiro remoto."""
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from letreiro_schema import CREATE_TAB_LETREIRO_CONFIG, CREATE_TAB_LETREIRO_INSTANCIA
from routers import letreiro_routes
from routers.letreiro_routes import is_letreiro_admin


def _client():
    app = FastAPI()
    app.include_router(letreiro_routes.router)
    return TestClient(app)


def test_schema_sql_creates_letreiro_tables():
    assert "CREATE TABLE IF NOT EXISTS tabLetreiroInstancia" in CREATE_TAB_LETREIRO_INSTANCIA
    assert "PRIMARY KEY (HostName, WindowsUser)" in CREATE_TAB_LETREIRO_INSTANCIA
    assert "CREATE TABLE IF NOT EXISTS tabLetreiroConfig" in CREATE_TAB_LETREIRO_CONFIG
    assert "Payload JSON NOT NULL" in CREATE_TAB_LETREIRO_CONFIG


def test_admin_sam_accepts_domain_prefix():
    assert is_letreiro_admin("P_918713")
    assert is_letreiro_admin(r"REDECAMARA\P_918713")
    assert is_letreiro_admin("redecamara/p_918713")
    assert not is_letreiro_admin("outro")
    assert not is_letreiro_admin("")


def test_heartbeat_upserts_instance(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().post(
        "/api/letreiro/heartbeat",
        json={"hostName": "PC1", "windowsUser": r"REDECAMARA\fulano", "version": "2.4.0", "ponto": "123"},
    )
    assert response.status_code == 200
    assert calls
    assert calls[0][1] == ("PC1", r"REDECAMARA\fulano", "2.4.0", "123")


def test_get_config_returns_payload(monkeypatch):
    monkeypatch.setattr(
        letreiro_routes.db,
        "execute_query",
        lambda sql, params=None: [{"Payload": '{"ponto":"9"}', "UpdatedAt": None, "UpdatedBy": "P_918713"}],
    )
    response = _client().get("/api/letreiro/config", params={"host": "PC1", "user": "fulano"})
    assert response.status_code == 200
    assert response.json()["payload"] == {"ponto": "9"}


def test_get_config_empty(monkeypatch):
    monkeypatch.setattr(letreiro_routes.db, "execute_query", lambda *a, **k: [])
    response = _client().get("/api/letreiro/config", params={"host": "PC1", "user": "fulano"})
    assert response.status_code == 200
    assert response.json()["payload"] is None


def test_instances_forbidden_for_non_admin():
    response = _client().get(
        "/api/letreiro/instances",
        headers={"X-Letreiro-Windows-User": "outro"},
    )
    assert response.status_code == 403


def test_instances_lists_online(monkeypatch):
    monkeypatch.setattr(
        letreiro_routes.db,
        "execute_query",
        lambda *a, **k: [
            {
                "HostName": "PC1",
                "WindowsUser": "fulano",
                "Version": "2.4.0",
                "Ponto": "10",
                "LastSeen": datetime.now(),
                "ConfigHost": "PC1",
            },
            {
                "HostName": "PC2",
                "WindowsUser": "beltrano",
                "Version": "2.3.3",
                "Ponto": "",
                "LastSeen": datetime.now() - timedelta(minutes=10),
                "ConfigHost": None,
            },
        ],
    )
    response = _client().get(
        "/api/letreiro/instances",
        headers={"X-Letreiro-Windows-User": r"REDECAMARA\P_918713"},
    )
    assert response.status_code == 200
    items = response.json()["instances"]
    assert items[0]["online"] is True
    assert items[0]["hasConfig"] is True
    assert items[1]["online"] is False
    assert items[1]["hasConfig"] is False


def test_put_config_rejected_without_admin(monkeypatch):
    monkeypatch.setattr(letreiro_routes.db, "execute_query", lambda *a, **k: [])
    response = _client().put(
        "/api/letreiro/config",
        json={
            "windowsUser": "outro",
            "hostName": "PC1",
            "targetUser": "fulano",
            "payload": {"ponto": "1"},
        },
    )
    assert response.status_code == 403


def test_put_config_apply_to_all(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        if "FROM tabLetreiroInstancia" in sql and "INSERT" not in sql:
            return [
                {"HostName": "PC1", "WindowsUser": "a"},
                {"HostName": "PC2", "WindowsUser": "b"},
            ]
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().put(
        "/api/letreiro/config",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={"windowsUser": "P_918713", "applyToAll": True, "payload": {"ponto": "7"}},
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 2
    inserts = [c for c in calls if c[1] and len(c[1]) == 4]
    assert len(inserts) == 2
    assert inserts[0][1][0] == "PC1"
    assert inserts[1][1][0] == "PC2"
