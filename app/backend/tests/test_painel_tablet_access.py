"""Garante que MASTER/full access inclui painel tablet."""
from __future__ import annotations


def test_full_access_includes_dashboard_tablet():
    from routers.ip_admin_routes import _full_access_permissions

    perms = _full_access_permissions("127.0.0.1")
    assert perms.get("sb_dashboard_tablet") is True
    assert perms.get("sb_dashboard_setor") is True
    assert perms.get("sb_dashboard_global") is True


def test_painel_spa_path_tablet_requires_flag():
    from security.painel_access import check_painel_spa_path_access

    denied = {"sb_dashboard_tablet": False, "sb_dashboard_setor": True}
    assert check_painel_spa_path_access("/painel/tablet", denied) is False

    allowed = {"sb_dashboard_tablet": True}
    assert check_painel_spa_path_access("/painel/tablet", allowed) is True
    assert check_painel_spa_path_access("/painel/celular", allowed) is True
    assert check_painel_spa_path_access("/painel/celular", denied) is False
    assert check_painel_spa_path_access("/painel/gravacao", allowed) is True
    assert check_painel_spa_path_access("/painel/gravacao", denied) is False
    assert check_painel_spa_path_access("/painel/setor", allowed) is False
