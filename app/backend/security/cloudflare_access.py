"""
Rotas permitidas quando a requisição passa pelo Cloudflare ou domínio público HTTPS.

Complementa CloudflareTunnelSecurityMiddleware em routers/api.py.
Acesso direto ao zrok/IIS (sem CF-Connecting-IP) continua liberado pelo middleware.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from security.painel_access import is_painel_api_route, is_painel_data_api_route
from security.spa_access import is_public_spa_path, normalize_spa_path

if TYPE_CHECKING:
    from starlette.requests import Request

# Hosts públicos (Worker, Tunnel, domínio customizado)
_TRUSTED_PUBLIC_HOSTS = frozenset(
    {
        "cgraf.online",
        "www.cgraf.online",
        "cgrafsysvm.camara.leg.br",
        "white-sun-19a3.fotolitocd.workers.dev",
        "sagra-painel.shares.zrok.io",
    }
)

# Shell SPA (raiz e index.html) — AccessControlMiddleware redireciona / → /login na internet
_SPA_SHELL_PATHS = frozenset({"/", "/index.html"})

# Rotas exatas (com e sem prefixo /sagra no path original)
_EXACT_PATHS = frozenset(
    {
        "/health",
        "/client_pt.html",
        "/client_proof.html",
        "/styles.css",
        "/dashboard_setor.html",
        "/dashboard_global.html",
        "/config_painel_global.json",
    }
)

# Prefixos públicos (portal, assets, painéis SPA, etc.)
_PUBLIC_PREFIXES = (
    "/api/client/",
    "/lib/",
    "/js/",
    "/portal/",
    "/assets/",
    "/painel/",
    "/sagra/painel/",
    "/api/pcp/",
)

# Leituras auxiliares usadas pelos modais de configuração dos painéis
_PAINEL_AUX_GET_PREFIXES = (
    "/api/aux/setores",
    "/api/aux/situacoes",
    "/api/aux/andamentos",
)


def normalize_cloudflare_path(path: str) -> str:
    """Remove prefixo /sagra usado pelo Nginx (ex.: /sagra/painel/setor -> /painel/setor)."""
    p = (path or "").split("?")[0].rstrip("/") or "/"
    lower = p.lower()
    if lower.startswith("/sagra/"):
        rest = lower[6:]
        return rest if rest.startswith("/") else f"/{rest}"
    if lower == "/sagra":
        return "/"
    return lower


def is_cloudflare_public_path(path: str, method: str) -> bool:
    """True se a rota pode ser acessada via Cloudflare (domínio público)."""
    norm = normalize_cloudflare_path(path)
    verb = (method or "GET").upper()

    if norm in _EXACT_PATHS:
        return True

    if norm.startswith("/login"):
        return True

    if any(norm.startswith(prefix) for prefix in _PUBLIC_PREFIXES):
        return True

    if norm.endswith("config_painel_global.json"):
        return True

    app_path = normalize_spa_path(path)
    if is_public_spa_path(app_path):
        return True

    api_path = norm if norm.startswith("/api/") else norm
    if api_path.startswith("/api/"):
        if api_path.startswith("/api/auth/"):
            return True
        if is_painel_api_route(api_path, verb):
            return True
        if verb == "GET" and is_painel_data_api_route(api_path, verb):
            return True
        if verb == "GET" and any(
            api_path.startswith(prefix) for prefix in _PAINEL_AUX_GET_PREFIXES
        ):
            return True

    if verb == "GET" and re.match(r"^/api/analise/client/\d+/\d+$", norm):
        return True

    if verb == "GET" and re.match(
        r"^/api/analise/item/\d+/indication/[^/]+\.(png|jpg|jpeg|webp)$",
        norm,
        re.IGNORECASE,
    ):
        return True

    return False


def _request_host(request: "Request") -> str:
    raw = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or ""
    )
    return raw.split(",")[0].split(":")[0].strip().lower()


def _hostname_is_public(host: str) -> bool:
    h = (host or "").strip().lower()
    if not h:
        return False
    if h in _TRUSTED_PUBLIC_HOSTS:
        return True
    return h.endswith(".workers.dev") or h.endswith(".cgraf.online")


def _host_from_origin_referer(request: "Request") -> str:
    """Host público do navegador quando o proxy repassa Host interno (zrok/LAN)."""
    from urllib.parse import urlparse

    for header in ("origin", "referer"):
        raw = (request.headers.get(header) or "").strip()
        if not raw:
            continue
        try:
            parsed = urlparse(raw)
        except Exception:
            continue
        host = (parsed.hostname or "").strip().lower()
        if host:
            return host
    return ""


def is_trusted_public_host(request: "Request") -> bool:
    """True para domínio público HTTPS (cgrafsysvm.camara.leg.br, cgraf.online, workers.dev)."""
    if _hostname_is_public(_request_host(request)):
        return True
    return _hostname_is_public(_host_from_origin_referer(request))


def _referer_is_painel(request: "Request") -> bool:
    ref = (request.headers.get("referer") or "").lower()
    return "/painel/" in ref or ref.rstrip("/").endswith("/painel")


def _has_authenticated_api_session(request: "Request") -> bool:
    """Sessão válida (local ou senha) para liberar /api/* via domínio público."""
    from security.session_auth import get_session_from_request

    session = get_session_from_request(request)
    if session is None or not session.ponto:
        return False
    norm = normalize_cloudflare_path(request.url.path or "")
    return norm.startswith("/api/")


def _has_authenticated_cliente_api_session(request: "Request") -> bool:
    """Sessão do portal cliente: libera só /api/cliente/* (não APIs staff)."""
    from security.session_auth import (
        get_cliente_session_from_request,
        is_cliente_session,
    )

    session = get_cliente_session_from_request(request)
    if not is_cliente_session(session):
        return False
    norm = normalize_cloudflare_path(request.url.path or "")
    return norm.startswith("/api/cliente/")


def is_cloudflare_public_request(request: "Request") -> bool:
    """Decide se a requisição via Cloudflare pode acessar a rota."""
    from security.public_access import get_password_session

    path = request.url.path or ""
    method = request.method or "GET"
    norm = normalize_cloudflare_path(path)

    if _has_authenticated_api_session(request):
        return True

    if _has_authenticated_cliente_api_session(request):
        return True

    if get_password_session(request):
        if path.startswith("/api/") or norm.startswith("/api/") or not is_cloudflare_public_path(path, method):
            return True

    if is_cloudflare_public_path(path, method):
        return True

    trusted = is_trusted_public_host(request)
    zrok_painel = _request_host(request) == "sagra-painel.shares.zrok.io"

    # Painéis via domínio público (Worker / Tunnel / share zrok)
    if trusted or zrok_painel:
        if norm.startswith("/painel/") or norm == "/painel":
            return True
        if norm.startswith("/assets/"):
            return True
        if norm in _SPA_SHELL_PATHS and (
            trusted or zrok_painel or _referer_is_painel(request)
        ):
            return True

    return False
