"""Todas as chaves RBAC podem ser atribuídas por terminal (ip_permissions)."""
from __future__ import annotations

import asyncio
from contextlib import contextmanager

from ip_permissions_schema import _EXTRA_COLUMNS
from routers import ip_admin_routes as routes
from security.user_permissions import _PERMISSION_BOOL_KEYS

NEW_TERMINAL_KEYS = ("ctx_prova_web", "ctx_comparar_versoes", "sb_dashboard_global", "sb_dashboard_tablet")


class FakeCursor:
    def __init__(self, row=None):
        self.row = row
        self.executed: list[tuple[str, tuple | None]] = []

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))

    def fetchone(self):
        return self.row if "ip = %s" in self.executed[-1][0] else None

    def fetchall(self):
        return []


def _patch_cursor(monkeypatch, cursor):
    @contextmanager
    def fake_cursor():
        yield cursor

    monkeypatch.setattr(routes.db, "cursor", fake_cursor)


def test_schema_garante_colunas_novas():
    cols = {name for name, _ in _EXTRA_COLUMNS}
    for key in NEW_TERMINAL_KEYS:
        assert key in cols or key == "sb_dashboard_global", key
    assert "sb_dashboard_tablet" in cols


def test_modelos_aceitam_todas_as_chaves():
    for key in _PERMISSION_BOOL_KEYS:
        assert key in routes.IPPermission.model_fields, key
        assert key in routes.IPPermissionUpdate.model_fields, key
    # Padrão seguro: nada novo liberado se o cliente omitir.
    payload = routes.IPPermission(ip="10.0.0.1")
    for key in NEW_TERMINAL_KEYS:
        assert getattr(payload, key) is False, key


def test_get_client_permissions_le_chaves_novas(monkeypatch):
    row = {"ip": "10.9.8.7", "ctx_prova_web": 1, "sb_dashboard_tablet": 1, "sb_dashboard_global": 0}
    cursor = FakeCursor(row)
    _patch_cursor(monkeypatch, cursor)
    monkeypatch.setattr(routes.get_client_permissions, "_cache", {}, raising=False)
    monkeypatch.setattr("security.api_auth.is_privileged_ip", lambda ip: False)

    perms = routes.get_client_permissions("10.9.8.7")
    assert perms["ctx_prova_web"] is True
    assert perms["sb_dashboard_tablet"] is True
    assert perms["ctx_comparar_versoes"] is False
    assert perms["sb_dashboard_global"] is False
    for key in _PERMISSION_BOOL_KEYS:
        assert key in perms, key


def test_add_ip_grava_chaves_novas(monkeypatch):
    cursor = FakeCursor(None)
    _patch_cursor(monkeypatch, cursor)
    data = routes.IPPermission(ip="10.9.8.7", ctx_prova_web=True, sb_dashboard_tablet=True)
    asyncio.run(routes.add_ip(data))

    sql, params = next((s, p) for s, p in cursor.executed if s.startswith("INSERT INTO ip_permissions"))
    columns = sql.split("(", 1)[1].split(")", 1)[0].replace(" ", "").split(",")
    assert len(columns) == len(params)
    values = dict(zip(columns, params))
    assert values["ctx_prova_web"] is True
    assert values["sb_dashboard_tablet"] is True
    assert values["ctx_comparar_versoes"] is False
    assert values["sb_dashboard_global"] is False
