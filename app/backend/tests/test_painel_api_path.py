"""Painel — rotas com prefixo /sagra/api (Uvicorn unificado)."""
from __future__ import annotations

from security.painel_access import is_painel_api_route, is_painel_data_api_route


def test_modern_sector_panel_uses_sector_permissions():
    from security.painel_access import check_painel_spa_path_access
    from security.spa_access import (
        has_screen_access_for_spa_path,
        required_permission_for_spa_path,
    )

    assert check_painel_spa_path_access("/painel/setor-moderno", {}) is False
    assert check_painel_spa_path_access("/painel/setor-moderno", {"sb_dashboard_global": True}) is False
    assert check_painel_spa_path_access("/painel/setor-moderno", {"sb_dashboard_setor": True}) is True
    assert check_painel_spa_path_access("/painel/setor-moderno", {"painel_setores": ["SEFOC"]}) is True
    assert required_permission_for_spa_path("/painel/setor-moderno") == "sb_dashboard_setor"
    assert has_screen_access_for_spa_path(
        "/painel/setor-moderno", {"sb_dashboard_setor": True}
    ) is True
    assert has_screen_access_for_spa_path("/painel/setor-moderno", {}) is False


def test_painel_data_route_accepts_sagra_api_prefix():
    assert is_painel_data_api_route("/sagra/api/pcp/queue", "GET") is True
    assert is_painel_data_api_route("/sagra/api/os/search", "GET") is True
    assert is_painel_data_api_route("/sagra/api/aux/setores", "GET") is True


def test_painel_data_route_keeps_api_prefix():
    assert is_painel_data_api_route("/api/pcp/queue", "GET") is True


def test_admin_reload_poll_is_painel_anonymous_get():
    assert is_painel_api_route("/api/realtime/admin-reload", "GET") is True
    assert is_painel_api_route("/sagra/api/realtime/admin-reload", "GET") is True
    assert is_painel_api_route("/api/realtime/admin-reload", "POST") is False


def test_painel_remote_hello_and_config_are_painel_anonymous():
    assert is_painel_api_route("/api/painel/config", "GET") is True
    assert is_painel_api_route("/sagra/api/painel/config", "GET") is True
    assert is_painel_api_route("/api/painel/hello", "POST") is True
    assert is_painel_api_route("/sagra/api/painel/hello", "POST") is True
    assert is_painel_api_route("/api/painel/hello", "GET") is False
    assert is_painel_api_route("/api/admin/painel/instances", "GET") is False


def test_admin_paineis_spa_is_ponto_gated():
    from security.spa_access import (
        _PAINEL_CONFIG_ADMIN,
        has_screen_access_for_spa_path,
        required_permission_for_spa_path,
    )

    assert required_permission_for_spa_path("/admin/paineis") == _PAINEL_CONFIG_ADMIN
    assert has_screen_access_for_spa_path("/admin/paineis", {"sb_admin_ips": True}) is False


def test_sync_andamentos_service_status_is_painel_anonymous_get():
    assert is_painel_api_route("/api/sync-andamentos/service-status", "GET") is True
    assert is_painel_api_route(
        "/sagra/api/sync-andamentos/service-status", "GET"
    ) is True
    assert is_painel_api_route("/api/sync-andamentos/service-status", "POST") is False
