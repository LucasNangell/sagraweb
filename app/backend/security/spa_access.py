"""
Controle de acesso às páginas SPA (HTML) — uma porta, decisão no servidor.

Complementa APIAccessMiddleware (rotas /api/*).
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import Request

# Rotas React → permissão (espelha apps/web nav-config ROUTE_PERMISSIONS)
SPA_ROUTE_PERMISSIONS: dict[str, str] = {
    "/": "sb_inicio",
    "/gerencia": "sb_gerencia",
    "/email": "sb_email",
    "/analise": "sb_analise",
    "/papelaria": "sb_papelaria",
    "/relatorios": "sb_relatorio",
    "/painel/global": "sb_dashboard_global",
    "/painel/setor": "sb_dashboard_setor",
    "/painel/tablet": "sb_dashboard_tablet",
    "/painel/celular": "sb_dashboard_tablet",
    "/pcp": "sb_pcp",
    "/gravacao": "sb_gravacao",
    "/cotas-graf": "sb_cotas_graf",
    "/estoque": "sb_estoque",
    "/credenciais-depol": "sb_credenciais_depol",
    "/prova-web": "ctx_prova_web",
    "/gravacao-externa": "sb_gravacao_externa",
    "/usuarios": "sb_usuarios",
    "/admin/ips": "sb_admin_ips",
    "/admin/mensagens": "sb_admin_ips",
    "/admin/configuracoes": "sb_admin_ips",
    "/impressao/requisicao": "ctx_imprimir_ficha",
}

# HTML legado na raiz do mount (sem React Router)
LEGACY_HTML_PERMISSIONS: dict[str, str] = {
    "/index.html": "sb_inicio",
    "/gerencia.html": "sb_gerencia",
    "/email.html": "sb_email",
    "/analise.html": "sb_analise",
    "/papelaria.html": "sb_papelaria",
    "/usuarios.html": "sb_usuarios",
    "/settings.html": "sb_configuracoes",
    "/relatorio.html": "sb_relatorio",
    "/dashboard_setor.html": "sb_dashboard_setor",
    "/dashboard_global.html": "sb_dashboard_global",
    "/pcp.html": "sb_pcp",
    "/gravacao.html": "sb_gravacao",
    "/requisicao.html": "ctx_imprimir_ficha",
    "/controls/sync_control.html": "sb_admin_ips",
}

_MASTER_ONLY = "__MASTER_ONLY__"

_STATIC_SUFFIXES = (
    ".js",
    ".css",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".map",
    ".mjs",
)


def is_spa_access_control_enabled() -> bool:
    flag = os.getenv("SAGRA_SPA_ACCESS_CONTROL", "").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    if flag in ("1", "true", "yes", "on", "sim"):
        return True
    try:
        from config_manager import config_manager

        return not config_manager.is_development()
    except Exception:
        return True


def api_url_prefix(request: Request) -> str:
    """Prefixo /sagra quando a app está atrás do Nginx ou build com VITE_BASE_PATH."""
    path = (request.url.path or "").lower()
    if path.startswith("/sagra/") or path == "/sagra":
        return "/sagra"
    return ""


def normalize_spa_path(path: str) -> str:
    p = (path or "/").split("?")[0].rstrip("/") or "/"
    lower = p.lower()
    if lower.startswith("/sagra/"):
        rest = lower[6:] or "/"
        return rest if rest.startswith("/") else f"/{rest}"
    if lower == "/sagra":
        return "/"
    return lower


def is_exempt_path(path: str) -> bool:
    lower = path.lower()
    if lower in ("/health", "/sagra/health"):
        return True
    if "client_" in lower:
        return True
    if lower.startswith("/api/") or "/api/" in lower:
        return True
    if lower in ("/ws", "/sagra/ws") or lower.startswith("/api/ws"):
        return True
    norm = normalize_spa_path(lower)
    if norm.startswith("/assets/") or "/assets/" in lower:
        return True
    if any(lower.endswith(sfx) for sfx in _STATIC_SUFFIXES):
        return True
    if lower.endswith("config_painel_global.json") or norm.endswith(
        "config_painel_global.json"
    ):
        return True
    if norm in ("/login", "/login/activate") or norm.startswith("/login/"):
        return True
    return False


def is_public_spa_path(app_path: str) -> bool:
    if app_path in ("/login", "/login/activate"):
        return True
    if app_path.startswith("/cliente"):
        return True
    if app_path.startswith("/portal"):
        return True
    return False


def is_spa_navigation_request(request: Request) -> bool:
    if request.method.upper() != "GET":
        return False
    path = request.url.path or ""
    if is_exempt_path(path):
        return False
    accept = (request.headers.get("accept") or "").lower()
    if "text/html" in accept or "*/*" in accept or not accept:
        return True
    # Fallback: rotas sem extensão de arquivo
    norm = normalize_spa_path(path)
    if "." in norm.rsplit("/", 1)[-1]:
        return False
    return True


def required_permission_for_spa_path(app_path: str) -> Optional[str]:
    """
    None = rota pública (login, portal).
    str = permissão exigida em ip_permissions.
    _MASTER_ONLY = rota não mapeada (só MASTER/servidor).
    """
    if is_public_spa_path(app_path):
        return None

    if app_path in LEGACY_HTML_PERMISSIONS:
        return LEGACY_HTML_PERMISSIONS[app_path]

    best_len = -1
    matched: Optional[str] = None
    for route, perm in SPA_ROUTE_PERMISSIONS.items():
        if app_path == route:
            if len(route) > best_len:
                best_len = len(route)
                matched = perm
        elif route != "/" and app_path.startswith(route + "/"):
            if len(route) > best_len:
                best_len = len(route)
                matched = perm

    if matched is not None:
        return matched
    if app_path.endswith(".html"):
        return LEGACY_HTML_PERMISSIONS.get(app_path, _MASTER_ONLY)
    return _MASTER_ONLY


def resolve_page_permissions(client_ip: str, app_path: str, request: Optional[Request] = None) -> Optional[dict]:
    """Permissões do IP ou do usuário (internet); None = bloqueio."""
    if is_public_spa_path(app_path):
        return {}

    if request is not None:
        from security.session_auth import get_session_from_request
        from security.user_permissions import resolve_effective_permissions

        session = get_session_from_request(request)
        if session is not None:
            from routers.ip_admin_routes import get_client_permissions

            return resolve_effective_permissions(
                request,
                session,
                get_client_permissions=get_client_permissions,
            )

    from routers.ip_admin_routes import get_client_permissions

    return get_client_permissions(client_ip)


def is_spa_shell_path(app_path: str) -> bool:
    """Raiz SPA — no host público o React redireciona conforme ACL do usuário."""
    return app_path in ("/", "/index.html")


def has_screen_access_for_spa_path(app_path: str, perms: dict) -> bool:
    """True se a ACL efetiva libera a rota SPA (espelha AccessControlMiddleware / nav)."""
    required = required_permission_for_spa_path(app_path)
    if required is None:
        return True
    if required == _MASTER_ONLY:
        return False

    if app_path.startswith("/painel"):
        from security.painel_access import check_painel_spa_path_access

        return check_painel_spa_path_access(app_path, perms)

    if app_path == "/gravacao-externa" or app_path.startswith("/gravacao-externa/"):
        return bool(
            perms.get("sb_gravacao_externa") or perms.get("sb_gravacao_pendente")
        )

    if app_path == "/estoque" or app_path.startswith("/estoque/"):
        return bool(perms.get("sb_estoque") or perms.get("sb_estoque_gerente"))

    return bool(perms.get(required, False))


def resolve_default_spa_route(perms: dict) -> Optional[str]:
    """
    Primeira rota SPA liberada pela ACL (ordem de SPA_ROUTE_PERMISSIONS).
    None se o usuário não tem nenhum módulo de tela.
    """
    for route in SPA_ROUTE_PERMISSIONS:
        if has_screen_access_for_spa_path(route, perms):
            return route
    return None
