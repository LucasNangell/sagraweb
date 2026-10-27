"""Rotas e schema do letreiro remoto."""
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from letreiro_schema import (
    CREATE_TAB_LETREIRO_AJUSTE,
    CREATE_TAB_LETREIRO_COMANDO,
    CREATE_TAB_LETREIRO_COMANDO_JOB,
    CREATE_TAB_LETREIRO_CONFIG,
    CREATE_TAB_LETREIRO_INSTANCIA,
    HOST_USER_PRIMARY_KEY,
    hostname_only_unique_names,
    needs_host_user_primary,
)
from routers import letreiro_routes
from routers.letreiro_routes import extract_command_vars, is_letreiro_admin, render_command_content


def _client():
    app = FastAPI()
    app.include_router(letreiro_routes.router)
    return TestClient(app)


def test_schema_sql_creates_letreiro_tables():
    assert "CREATE TABLE IF NOT EXISTS tabLetreiroInstancia" in CREATE_TAB_LETREIRO_INSTANCIA
    assert "PRIMARY KEY (HostName, WindowsUser)" in CREATE_TAB_LETREIRO_INSTANCIA
    assert "Nome VARCHAR(128) NOT NULL DEFAULT ''" in CREATE_TAB_LETREIRO_INSTANCIA
    assert "Setor VARCHAR(128) NOT NULL DEFAULT ''" in CREATE_TAB_LETREIRO_INSTANCIA
    assert "CREATE TABLE IF NOT EXISTS tabLetreiroConfig" in CREATE_TAB_LETREIRO_CONFIG
    assert "Payload JSON NOT NULL" in CREATE_TAB_LETREIRO_CONFIG
    assert "CREATE TABLE IF NOT EXISTS tabLetreiroComando" in CREATE_TAB_LETREIRO_COMANDO
    assert "UNIQUE KEY uk_letreiro_comando_nome" in CREATE_TAB_LETREIRO_COMANDO
    assert "CREATE TABLE IF NOT EXISTS tabLetreiroComandoJob" in CREATE_TAB_LETREIRO_COMANDO_JOB
    assert "idx_letreiro_job_claim" in CREATE_TAB_LETREIRO_COMANDO_JOB
    assert "CREATE TABLE IF NOT EXISTS tabLetreiroAjuste" in CREATE_TAB_LETREIRO_AJUSTE
    assert "CommandPollIntervalSec" in CREATE_TAB_LETREIRO_AJUSTE


def test_host_user_primary_needed_when_host_only():
    assert HOST_USER_PRIMARY_KEY == ("HostName", "WindowsUser")
    assert needs_host_user_primary([("PRIMARY", ("HostName",), 0)]) is True
    assert needs_host_user_primary([("PRIMARY", HOST_USER_PRIMARY_KEY, 0)]) is False
    assert needs_host_user_primary([]) is True
    assert hostname_only_unique_names(
        [
            ("PRIMARY", HOST_USER_PRIMARY_KEY, 0),
            ("uk_host", ("HostName",), 0),
            ("idx_letreiro_instancia_seen", ("LastSeen",), 1),
        ]
    ) == ["uk_host"]


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


def test_instances_lists_two_users_on_same_host(monkeypatch):
    monkeypatch.setattr(
        letreiro_routes.db,
        "execute_query",
        lambda *a, **k: [
            {
                "HostName": "PC-SALA",
                "WindowsUser": r"REDECAMARA\ana",
                "Nome": "Ana Souza",
                "Setor": "SEFOC",
                "Version": "2.18.0",
                "Ponto": "654321",
                "LastSeen": datetime.now(),
                "ConfigHost": "PC-SALA",
            },
            {
                "HostName": "PC-SALA",
                "WindowsUser": r"REDECAMARA\bruno",
                "Nome": "Bruno Alves",
                "Setor": "Papelaria",
                "Version": "2.18.0",
                "Ponto": "654321",
                "LastSeen": datetime.now(),
                "ConfigHost": None,
            },
        ],
    )
    response = _client().get(
        "/api/letreiro/instances",
        headers={"X-Letreiro-Windows-User": "P_918713"},
    )
    assert response.status_code == 200
    items = response.json()["instances"]
    assert len(items) == 2
    assert items[0]["hostName"] == "PC-SALA"
    assert items[1]["hostName"] == "PC-SALA"
    assert items[0]["windowsUser"] == r"REDECAMARA\ana"
    assert items[1]["windowsUser"] == r"REDECAMARA\bruno"
    assert items[0]["nome"] == "Ana Souza"
    assert items[1]["nome"] == "Bruno Alves"


def test_heartbeat_keeps_same_host_different_users(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    client = _client()
    first = client.post(
        "/api/letreiro/heartbeat",
        json={"hostName": "PC-SALA", "windowsUser": r"REDECAMARA\ana", "version": "2.18.0", "ponto": "654321"},
    )
    second = client.post(
        "/api/letreiro/heartbeat",
        json={"hostName": "PC-SALA", "windowsUser": r"REDECAMARA\bruno", "version": "2.18.0", "ponto": "654321"},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    users = [c[1][1] for c in calls]
    assert users == [r"REDECAMARA\ana", r"REDECAMARA\bruno"]
    assert all(c[1][0] == "PC-SALA" for c in calls)


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


def test_put_config_one_user_does_not_touch_others(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    payload = {
        "board": {
            "sector": "Papelaria",
            "showOs": True,
            "showSp": False,
            "columns": [{"id": "col_0", "title": "Em Execução", "statuses": ["Em Execução"]}],
        },
        "window": {"width": 900, "opacity": 0.8, "speedPxPerSec": 60},
    }
    response = _client().put(
        "/api/letreiro/config",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={
            "windowsUser": "P_918713",
            "applyToAll": False,
            "hostName": "PC-ALVO",
            "targetUser": "usr_sefoc",
            "payload": payload,
        },
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 1
    assert not any("FROM tabLetreiroInstancia" in (c[0] or "") for c in calls)
    inserts = [c for c in calls if c[1] and len(c[1]) == 4]
    assert len(inserts) == 1
    assert inserts[0][1][0] == "PC-ALVO"
    assert inserts[0][1][1] == "usr_sefoc"
    stored = inserts[0][1][2]
    assert "Papelaria" in stored
    assert "col_0" in stored
    assert "900" in stored


def test_put_instance_profile_forbidden():
    response = _client().put(
        "/api/letreiro/instances",
        json={"windowsUser": "outro", "hostName": "PC1", "targetUser": "fulano", "nome": "Ana", "setor": "SEFOC"},
    )
    assert response.status_code == 403


def test_put_instance_profile_updates_nome_setor(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        if "SELECT HostName FROM tabLetreiroInstancia" in sql:
            return [{"HostName": "PC1"}]
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().put(
        "/api/letreiro/instances",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={
            "windowsUser": "P_918713",
            "hostName": "PC1",
            "targetUser": r"REDECAMARA\fulano",
            "nome": "Ana Silva",
            "setor": "SEFOC",
        },
    )
    assert response.status_code == 200
    updates = [c for c in calls if c[0].strip().startswith("UPDATE")]
    assert updates
    assert updates[0][1] == ("Ana Silva", "SEFOC", "PC1", r"REDECAMARA\fulano")


def test_commands_forbidden_for_non_admin():
    response = _client().get(
        "/api/letreiro/commands",
        headers={"X-Letreiro-Windows-User": "outro"},
    )
    assert response.status_code == 403


def test_create_command_inserts_catalog(monkeypatch):
    calls = []

    def fake_tx(ops):
        class Cursor:
            lastrowid = 11

            def execute(self, sql, params=None):
                calls.append((sql, params))

        return [ops[0](Cursor())]

    monkeypatch.setattr(letreiro_routes.db, "execute_transaction", fake_tx)
    response = _client().post(
        "/api/letreiro/commands",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={
            "windowsUser": "P_918713",
            "name": "ping",
            "kind": "bat",
            "content": "@echo hi",
            "timeoutSec": 30,
        },
    )
    assert response.status_code == 200
    assert response.json()["id"] == 11
    assert calls[0][1][0] == "ping"
    assert calls[0][1][1] == "bat"


def test_run_command_queues_selected_and_online(monkeypatch):
    calls = []
    now = datetime.now()

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        if "FROM tabLetreiroComando" in sql and "INSERT" not in sql:
            return [{"Id": 3, "Nome": "ping", "Tipo": "bat", "Conteudo": "@echo hi", "TimeoutSec": 60}]
        if "FROM tabLetreiroInstancia" in sql:
            return [
                {"HostName": "PC1", "WindowsUser": "a", "LastSeen": now},
                {"HostName": "PC2", "WindowsUser": "b", "LastSeen": now - timedelta(minutes=10)},
            ]
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().post(
        "/api/letreiro/commands/3/run",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={
            "windowsUser": "P_918713",
            "allOnline": True,
            "targets": [{"hostName": "PC9", "windowsUser": "c"}],
        },
    )
    assert response.status_code == 200
    assert response.json()["queued"] == 2
    inserts = [c for c in calls if "INSERT INTO tabLetreiroComandoJob" in c[0]]
    hosts = {c[1][5] for c in inserts}
    assert hosts == {"PC9", "PC1"}


def test_adhoc_run_forbidden():
    response = _client().post(
        "/api/letreiro/jobs/run",
        json={
            "windowsUser": "outro",
            "kind": "bat",
            "content": "dir",
            "targets": [{"hostName": "PC1", "windowsUser": "a"}],
        },
    )
    assert response.status_code == 403


def test_adhoc_run_queues_without_catalog(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().post(
        "/api/letreiro/jobs/run",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={
            "windowsUser": "P_918713",
            "kind": "bat",
            "content": "ipconfig /all",
            "name": "terminal",
            "targets": [{"hostName": "PC1", "windowsUser": "a"}],
        },
    )
    assert response.status_code == 200
    assert response.json()["queued"] == 1
    inserts = [c for c in calls if "INSERT INTO tabLetreiroComandoJob" in c[0]]
    assert inserts[0][1][0] is None
    assert inserts[0][1][1] == "terminal"
    assert inserts[0][1][2] == "bat"
    assert inserts[0][1][3] == "ipconfig /all"


def test_extract_command_vars_keeps_order_and_unique():
    assert extract_command_vars("ping {{host}} -n {{count}} && ping {{host}}") == ["host", "count"]
    assert extract_command_vars("echo ok") == []
    assert extract_command_vars("{{ nome }}") == ["nome"]


def test_render_command_content_fills_and_reports_missing():
    rendered, missing = render_command_content("ping {{host}} -n {{count}}", {"host": "pc1", "count": "2"})
    assert missing == []
    assert rendered == "ping pc1 -n 2"
    _, missing = render_command_content("ping {{host}}", {})
    assert missing == ["host"]


def test_run_command_substitutes_variables(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        if "FROM tabLetreiroComando" in sql and "INSERT" not in sql:
            return [{
                "Id": 3,
                "Nome": "ping",
                "Tipo": "bat",
                "Conteudo": "ping {{host}} -n {{count}}",
                "TimeoutSec": 60,
            }]
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().post(
        "/api/letreiro/commands/3/run",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={
            "windowsUser": "P_918713",
            "variables": {"host": "pc-alvo", "count": "4"},
            "targets": [{"hostName": "PC1", "windowsUser": "a"}],
        },
    )
    assert response.status_code == 200
    inserts = [c for c in calls if "INSERT INTO tabLetreiroComandoJob" in c[0]]
    assert inserts[0][1][3] == "ping pc-alvo -n 4"


def test_run_command_requires_variables(monkeypatch):
    monkeypatch.setattr(
        letreiro_routes.db,
        "execute_query",
        lambda sql, params=None: [{
            "Id": 3,
            "Nome": "ping",
            "Tipo": "bat",
            "Conteudo": "ping {{host}}",
            "TimeoutSec": 60,
        }] if "FROM tabLetreiroComando" in sql else [],
    )
    response = _client().post(
        "/api/letreiro/commands/3/run",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={
            "windowsUser": "P_918713",
            "targets": [{"hostName": "PC1", "windowsUser": "a"}],
        },
    )
    assert response.status_code == 400
    assert "host" in response.json()["detail"]


def test_pending_job_claims_running(monkeypatch):
    def fake_tx(ops):
        class Cursor:
            rowcount = 1

            def execute(self, sql, params=None):
                return None

            def fetchone(self):
                return {
                    "Id": 9,
                    "ComandoId": 3,
                    "Nome": "ping",
                    "Tipo": "bat",
                    "Conteudo": "@echo hi",
                    "TimeoutSec": 60,
                    "HostName": "PC1",
                    "WindowsUser": "fulano",
                }

        return [ops[0](Cursor())]

    monkeypatch.setattr(letreiro_routes.db, "execute_transaction", fake_tx)
    monkeypatch.setattr(
        letreiro_routes.db,
        "execute_query",
        lambda *a, **k: [{"CommandPollIntervalSec": 7}],
    )
    response = _client().get("/api/letreiro/jobs/pending", params={"host": "PC1", "user": "fulano"})
    assert response.status_code == 200
    body = response.json()
    assert body["job"]["id"] == 9
    assert body["job"]["content"] == "@echo hi"
    assert body["pollIntervalSec"] == 7


def test_settings_put_forbidden():
    response = _client().put(
        "/api/letreiro/settings",
        json={"windowsUser": "outro", "commandPollIntervalSec": 5},
    )
    assert response.status_code == 403


def test_settings_put_clamps_interval(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().put(
        "/api/letreiro/settings",
        headers={"X-Letreiro-Windows-User": "P_918713"},
        json={"windowsUser": "P_918713", "commandPollIntervalSec": 999},
    )
    assert response.status_code == 200
    assert response.json()["commandPollIntervalSec"] == 120
    assert calls[0][1][0] == 120


def test_settings_get_returns_interval(monkeypatch):
    monkeypatch.setattr(
        letreiro_routes.db,
        "execute_query",
        lambda *a, **k: [{"CommandPollIntervalSec": 3}],
    )
    response = _client().get("/api/letreiro/settings")
    assert response.status_code == 200
    assert response.json()["commandPollIntervalSec"] == 3


def test_job_result_rejects_wrong_host(monkeypatch):
    monkeypatch.setattr(
        letreiro_routes.db,
        "execute_query",
        lambda *a, **k: [{"Id": 9, "HostName": "PC1", "WindowsUser": "fulano", "Status": "running"}],
    )
    response = _client().post(
        "/api/letreiro/jobs/9/result",
        json={"hostName": "OUTRO", "windowsUser": "fulano", "exitCode": 0, "stdout": "ok"},
    )
    assert response.status_code == 403


def test_job_result_snapshot_independent_of_catalog(monkeypatch):
    calls = []

    def fake_exec(sql, params=None):
        calls.append((sql, params))
        if sql.strip().startswith("SELECT"):
            return [{"Id": 9, "HostName": "PC1", "WindowsUser": "fulano", "Status": "running"}]
        return []

    monkeypatch.setattr(letreiro_routes.db, "execute_query", fake_exec)
    response = _client().post(
        "/api/letreiro/jobs/9/result",
        json={
            "hostName": "PC1",
            "windowsUser": "fulano",
            "exitCode": 0,
            "stdout": "ok",
            "stderr": "",
            "timedOut": False,
        },
    )
    assert response.status_code == 200
    updates = [c for c in calls if c[0].strip().startswith("UPDATE")]
    assert updates
    assert updates[0][1][0] == "ok"
    assert updates[0][1][2] == "ok"
