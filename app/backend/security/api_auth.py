"""

Autenticação/autorização da API — Fase B (sessão HttpOnly) + RBAC por IP.

Sem fail-open: sem sessão válida ou IP não cadastrado → HTTP 403.

"""

from __future__ import annotations



import logging

import os
import re

from typing import Optional, Set, Tuple



from fastapi import HTTPException, Request

from starlette.middleware.base import BaseHTTPMiddleware

from starlette.responses import JSONResponse



from security.session_auth import get_session_from_request



logger = logging.getLogger(__name__)



# Rotas públicas (sem sessão)

_PUBLIC_GET_EXACT: Set[str] = {

    "/health",

    "/api/app-version",

    "/api/config/public",

    "/api/auth/me",

    "/api/auth/activate/check",

    "/api/auth/reset-password/check",

    "/api/auth/cliente/activate/check",

    "/api/permissions/painel-scope",

    "/api/push/vapid-public-key",

    "/openapi.json",

    "/docs",

    "/redoc",

}

_PUBLIC_POST_EXACT: Set[str] = {

    "/api/access-request",

    "/api/auth/session",

    "/api/auth/login",

    "/api/auth/activate",

    "/api/auth/forgot-password",

    "/api/auth/reset-password",

    "/api/auth/logout",

    "/api/users/identify",

    "/api/auth/cliente/login",

    "/api/auth/cliente/activate",

    "/api/auth/cliente/logout",

}

_PUBLIC_PREFIXES: Tuple[str, ...] = (

    "/api/client/",

)

# Portal do cliente: GET com token na query (validado no handler da rota)
_CLIENT_ANALYSIS_GET_RE = re.compile(r"^/api/analise/client/\d+/\d+$")
_CLIENT_INDICATION_GET_RE = re.compile(
    r"^/api/analise/item/\d+/indication/[^/]+\.(png|jpg|jpeg|webp)$",
    re.IGNORECASE,
)
_USER_NAME_LOOKUP_RE = re.compile(r"^/api/auth/user-name/\d+$")



# Apenas MASTER / servidor local (+ sessão válida)

_ADMIN_PREFIXES: Tuple[str, ...] = (

    "/api/admin/",

    "/api/sync/",

)

_ADMIN_EXACT: Set[str] = {

    "/api/connected-ips",

}





def _trusted_proxy_peers() -> set[str]:
    from config_manager import config_manager

    master, local = _get_allowed_ips_config()
    server_host = str(config_manager.get("server_host") or local or "10.1.1.73")
    return {master, local, server_host, "127.0.0.1", "::1", "10.1.1.73", "10.120.2.11"}


def _ips_from_forwarded_headers(request: Request) -> list[str]:
    """Todos os IPs informados pelo Nginx (cadeia X-Forwarded-For + X-Real-IP)."""
    found: list[str] = []
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        for part in xff.split(","):
            ip = part.strip()
            if ip and ip not in found:
                found.append(ip)
    x_real = (request.headers.get("x-real-ip") or "").strip()
    if x_real and x_real not in found:
        found.append(x_real)
    return found


def resolve_client_ip(request: Request) -> str:
    """IP do cliente; atrás do Nginx/Cloudflare usa CF-Connecting-IP / X-Forwarded-For / X-Real-IP."""
    # Cloudflare: IP real do visitante (evitar edge 104.x no primeiro hop do XFF).
    cf_ip = (request.headers.get("cf-connecting-ip") or "").strip()
    if cf_ip:
        return cf_ip.split(",")[0].strip()

    peer = request.client.host if request.client else "unknown"
    forwarded = _ips_from_forwarded_headers(request)
    trusted = _trusted_proxy_peers()

    if peer in trusted or forwarded:
        if forwarded:
            return forwarded[0]
        if peer in trusted:
            return peer

    if peer in ("127.0.0.1", "::1"):
        if forwarded:
            return forwarded[0]
        if _is_development_mode():
            dev_ip = os.getenv("SAGRA_DEV_CLIENT_IP", "").strip()
            if dev_ip:
                return dev_ip

    return peer


def is_privileged_ip(ip: str) -> bool:
    """MASTER (10.120.2.11), servidor local e loopback — acesso total."""
    if not ip or ip == "unknown":
        return False
    master, local = _get_allowed_ips_config()
    privileged = _trusted_proxy_peers() | {master, local}
    if ip in privileged:
        return True
    if _is_development_mode():
        dev_ip = os.getenv("SAGRA_DEV_CLIENT_IP", "").strip()
        if dev_ip and ip == dev_ip:
            return True
    return False


def is_privileged_request(request: Request) -> bool:
    """True se qualquer IP da requisição (incl. X-Forwarded-For) for MASTER/servidor."""
    candidates = [resolve_client_ip(request)]
    candidates.extend(_ips_from_forwarded_headers(request))
    peer = request.client.host if request.client else ""
    if peer:
        candidates.append(peer)
    return any(is_privileged_ip(ip) for ip in candidates)





def _get_allowed_ips_config():

    from config_manager import config_manager



    allowed = config_manager.get("allowed_ips") or {}

    master = allowed.get("master") or config_manager.get("allowed_ips.master") or "10.120.2.11"

    local = allowed.get("local_network") or config_manager.get("allowed_ips.local_network") or "10.1.1.73"

    return str(master), str(local)





def is_master_client(request: Request) -> bool:
    if is_privileged_request(request):
        return True
    from security.remote_master import is_remote_master_request

    return is_remote_master_request(request)





def require_master_ip(request: Request) -> None:

    if not is_master_client(request):

        logger.warning(

            "Acesso admin negado para IP %s em %s",

            resolve_client_ip(request),

            request.url.path,

        )

        raise HTTPException(

            status_code=403,

            detail="Acesso restrito ao terminal administrativo (MASTER_IP).",

        )





def _is_public_api(path: str, method: str) -> bool:

    if path in _PUBLIC_GET_EXACT and method == "GET":

        return True

    if path in _PUBLIC_POST_EXACT and method == "POST":

        return True

    if method == "GET" and _CLIENT_ANALYSIS_GET_RE.match(path):

        return True

    if method == "GET" and _CLIENT_INDICATION_GET_RE.match(path):

        return True

    if method == "GET" and _USER_NAME_LOOKUP_RE.match(path):

        return True

    return any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)





def _is_admin_api(path: str) -> bool:

    if path in _ADMIN_EXACT:

        return True

    return any(path.startswith(prefix) for prefix in _ADMIN_PREFIXES)





def _is_development_mode() -> bool:

    try:

        from config_manager import config_manager

        return config_manager.is_development()

    except Exception:

        return os.getenv("ENV", "").lower() in ("development", "dev", "local")





def _forbidden(detail: str) -> JSONResponse:

    return JSONResponse(status_code=403, content={"detail": detail})


def _normalize_api_middleware_path(path: str) -> str:
    """Remove prefixo /sagra quando a requisição chega direto ao Uvicorn unificado."""
    norm = (path or "").rstrip("/") or "/"
    if norm == "/sagra/api":
        return "/api"
    if norm.startswith("/sagra/api/"):
        return norm[len("/sagra") :]
    return norm


def _is_websocket_upgrade_path(path: str) -> bool:
    norm = _normalize_api_middleware_path(path).rstrip("/") or "/"
    return norm in ("/ws", "/api/ws")


class APIAccessMiddleware(BaseHTTPMiddleware):

    """

    1) Exige cookie de sessão válido (Fase B).

    2) Valida IP da sessão contra ip_permissions (sem fail-open).

    3) Rotas admin exigem MASTER_IP.

    """



    async def dispatch(self, request: Request, call_next):

        path = request.url.path.rstrip("/") or "/"
        api_path = _normalize_api_middleware_path(path)

        method = request.method.upper()

        # WebSocket — autenticação no handler (realtime.py); não bypassar totalmente
        if _is_websocket_upgrade_path(path):
            return await call_next(request)

        # Notify — autenticação dedicada (secret / IP legado / MASTER+sessão)
        if api_path == "/api/realtime/notify" and method == "POST":
            from security.notify_auth import is_notify_authorized

            if is_notify_authorized(request):
                return await call_next(request)
            logger.warning(
                "Notify negado: ip=%s path=%s",
                resolve_client_ip(request),
                path,
            )
            return _forbidden("Notificação não autorizada.")

        # Worker Papelaria Corel — secret dedicado (sem sessão humana)
        from security.papelaria_worker_auth import (
            is_papelaria_worker_authorized,
            is_papelaria_worker_path,
        )

        if is_papelaria_worker_path(api_path, method):
            if is_papelaria_worker_authorized(request):
                return await call_next(request)
            logger.warning(
                "Worker papelaria negado: ip=%s path=%s",
                resolve_client_ip(request),
                path,
            )
            return JSONResponse(
                status_code=401,
                content={"detail": "Worker não autorizado."},
            )

        if not api_path.startswith("/api/"):
            return await call_next(request)



        if _is_public_api(api_path, method):

            return await call_next(request)



        from security.painel_access import (
            allow_painel_anonymous_api,
            resolve_permissions_for_api,
            should_skip_session_ip_binding,
        )
        from security.session_auth import (
            get_cliente_session_from_request,
            get_session_from_request,
            is_cliente_session,
        )

        from routers.ip_admin_routes import get_client_permissions

        session = get_session_from_request(request)
        client_ip = resolve_client_ip(request)

        if api_path.startswith("/api/cliente/"):
            cliente_session = get_cliente_session_from_request(request)
            if not is_cliente_session(cliente_session):
                return _forbidden("Sessão de cliente ausente ou inválida.")
            request.state.sagra_session = cliente_session
            request.state.sagra_permissions = {}
            return await call_next(request)

        if session is None:
            if allow_painel_anonymous_api(
                api_path,
                method,
                client_ip=client_ip,
                get_client_permissions=get_client_permissions,
            ):
                request.state.sagra_permissions = get_client_permissions(client_ip)
                return await call_next(request)
            logger.warning("API 403: sessão ausente path=%s", path)
            # #region agent log
            try:
                import json as _json, time as _time
                from pathlib import Path as _Path
                _log = _Path(__file__).resolve().parents[3] / "debug-68f609.log"
                _log.open("a", encoding="utf-8").write(
                    _json.dumps(
                        {
                            "sessionId": "68f609",
                            "hypothesisId": "B",
                            "location": "api_auth.py:session_absent",
                            "message": "API 403 sessão ausente",
                            "data": {
                                "path": path,
                                "api_path": api_path,
                                "method": method,
                                "client_ip": client_ip,
                            },
                            "timestamp": int(_time.time() * 1000),
                        }
                    )
                    + "\n"
                )
            except Exception:
                pass
            # #endregion
            return _forbidden(
                "Sessão ausente ou inválida. Autentique-se em POST /api/auth/session."
            )

        from security.public_access import should_use_user_permissions

        use_user_perms = should_use_user_permissions(request, session)

        # Produção: IP da sessão deve coincidir (exceto painel e login password via internet)
        if (
            not _is_development_mode()
            and not use_user_perms
            and session.ip != client_ip
            and not should_skip_session_ip_binding(api_path, method)
        ):
            logger.warning(
                "API 403: IP da sessão (%s) != IP atual (%s) path=%s",
                session.ip,
                client_ip,
                path,
            )
            # #region agent log
            try:
                import json as _json, time as _time
                from pathlib import Path as _Path
                _log = _Path(__file__).resolve().parents[3] / "debug-68f609.log"
                _log.open("a", encoding="utf-8").write(
                    _json.dumps(
                        {
                            "sessionId": "68f609",
                            "hypothesisId": "A",
                            "location": "api_auth.py:ip_mismatch",
                            "message": "API 403 IP divergente",
                            "data": {
                                "path": path,
                                "api_path": api_path,
                                "method": method,
                                "session_ip": session.ip,
                                "client_ip": client_ip,
                                "auth_mode": session.auth_mode,
                                "skip_ip": should_skip_session_ip_binding(
                                    api_path, method
                                ),
                            },
                            "timestamp": int(_time.time() * 1000),
                        }
                    )
                    + "\n"
                )
            except Exception:
                pass
            # #endregion
            return _forbidden("Sessão inválida para este terminal (IP divergente).")

        if api_path.startswith("/api/sync/"):

            try:

                from config_manager import config_manager

                if not config_manager.is_sync_andamentos_enabled():

                    return JSONResponse(

                        status_code=503,

                        content={

                            "detail": "Sync andamentos desabilitado. Sistema em modo MYSQL_ONLY."

                        },

                    )

            except Exception:

                pass



        if _is_admin_api(api_path):

            if not is_master_client(request):

                logger.warning("API admin bloqueada: IP=%s path=%s", client_ip, path)

                return _forbidden("Acesso administrativo restrito ao MASTER_IP.")

            return await call_next(request)



        from security.user_permissions import resolve_effective_permissions

        perms = resolve_effective_permissions(
            request,
            session,
            path=api_path,
            method=method,
            get_client_permissions=get_client_permissions,
        )

        if perms is None:
            logger.warning(
                "API 403: sem permissão ponto=%s ip=%s path=%s",
                session.ponto,
                session.ip,
                path,
            )
            return _forbidden("Acesso não autorizado para esta API.")

        request.state.sagra_session = session
        request.state.sagra_permissions = perms

        return await call_next(request)


