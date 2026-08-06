"""Aliases POST …/delete para exclusões (compatibilidade Cloudflare WAF)."""

from __future__ import annotations

import pytest


def _methods_by_path(router) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    for route in router.routes:
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if not path or not methods:
            continue
        out.setdefault(path, set()).update(methods)
    return out


@pytest.fixture(scope="module")
def route_methods():
    """Mapa path completo (/api/…) -> métodos, a partir dos routers (sem subir a app)."""
    from routers import (
        admin_system_routes,
        analise_routes,
        cliente_gabinete_routes,
        os_notificacao_routes,
        os_routes,
        os_sub_os_routes,
        papelaria_routes,
        settings_routes,
        user_admin_routes,
    )

    # Routers montados com prefix="/api" em api.py
    api_prefixed = (
        os_routes.router,
        os_sub_os_routes.router,
        analise_routes.router,
        settings_routes.router,
        os_notificacao_routes.router,
        papelaria_routes.router,
    )
    # Já incluem /api no path do decorator
    absolute = (
        user_admin_routes.router,
        admin_system_routes.router,
        cliente_gabinete_routes.router,
    )

    methods: dict[str, set[str]] = {}
    for router in api_prefixed:
        for path, verbs in _methods_by_path(router).items():
            full = path if path.startswith("/api/") else f"/api{path}"
            methods.setdefault(full, set()).update(verbs)
    for router in absolute:
        for path, verbs in _methods_by_path(router).items():
            methods.setdefault(path, set()).update(verbs)
    return methods


# (path DELETE legado, path POST alias)
_DELETE_ALIAS_PAIRS = (
    (
        "/api/os/{ano}/{id}/history/{cod_status}",
        "/api/os/{ano}/{id}/history/{cod_status}/delete",
    ),
    (
        "/api/os/{ano}/{id}/vinculo/{v_num}/{v_ano}",
        "/api/os/{ano}/{id}/vinculo/{v_num}/{v_ano}/delete",
    ),
    (
        "/api/os/{ano}/{id}/sub-os/{sub_os_id}/history/{history_id}",
        "/api/os/{ano}/{id}/sub-os/{sub_os_id}/history/{history_id}/delete",
    ),
    (
        "/api/admin/users/{ponto}",
        "/api/admin/users/{ponto}/delete",
    ),
    (
        "/api/analise/item/{item_id}",
        "/api/analise/item/{item_id}/delete",
    ),
    (
        "/api/settings/filters/saved/{filter_id}",
        "/api/settings/filters/saved/{filter_id}/delete",
    ),
    (
        "/api/os/{ano}/{id}/notificacao-watch",
        "/api/os/{ano}/{id}/notificacao-watch/delete",
    ),
    (
        "/api/push/subscribe",
        "/api/push/subscribe/delete",
    ),
    (
        "/api/papelaria/admin/modelos/{modelo_id}",
        "/api/papelaria/admin/modelos/{modelo_id}/delete",
    ),
    (
        "/api/admin/system/email-templates/{template_id}/presets/{preset_id}",
        "/api/admin/system/email-templates/{template_id}/presets/{preset_id}/delete",
    ),
    (
        "/api/admin/system/email-template-models/{model_id}",
        "/api/admin/system/email-template-models/{model_id}/delete",
    ),
    (
        "/api/admin/system/catalog/{category}/{item_id}",
        "/api/admin/system/catalog/{category}/{item_id}/delete",
    ),
    (
        "/api/admin/clientes/{cliente_id}",
        "/api/admin/clientes/{cliente_id}/delete",
    ),
)


@pytest.mark.parametrize("delete_path,post_path", _DELETE_ALIAS_PAIRS)
def test_delete_and_post_delete_aliases_registered(route_methods, delete_path, post_path):
    assert "DELETE" in route_methods.get(delete_path, set()), (
        f"DELETE legado ausente: {delete_path}"
    )
    assert "POST" in route_methods.get(post_path, set()), (
        f"POST alias ausente: {post_path}"
    )


def test_push_subscribe_still_has_post_for_create(route_methods):
    """Garantir que POST /push/subscribe (criar) e POST …/delete (excluir) coexistem."""
    assert "POST" in route_methods.get("/api/push/subscribe", set())
    assert "DELETE" in route_methods.get("/api/push/subscribe", set())
    assert "POST" in route_methods.get("/api/push/subscribe/delete", set())
