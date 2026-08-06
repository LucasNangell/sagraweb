import bootstrap_paths  # noqa: F401 — sys.path antes dos routers

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import logging
import uvicorn
import time
import os
import re
from datetime import datetime
from pathlib import Path

# Import dos Routers (Módulos)
from routers import (
    os_routes,
    os_filter_options_routes,
    os_sub_os_routes,
    analise_routes,
    pre_analise_routes,
    auxiliar_routes,
    papelaria_routes,
    papelaria_worker_routes,
    credenciais_depol_routes,
    settings_routes,
    ip_admin_routes,
    auth_routes,
    config_routes,
    realtime,
    pcp_routes,
    gravacao_routes,
    gravacao_externa_routes,
    gravacao_pendente_routes,
    network_files_routes,
    cotas_graf_routes,
    estoque_routes,
    requisicao_routes,
    email_routes,
    report_custom_routes,
    notifications_routes,
    user_routes,
    user_admin_routes,
    setor_painel_routes,
    tablet_face_routes,
    admin_system_routes,
    admin_os_materialized_routes,
    os_arquivos_routes,
    cliente_gabinete_routes,
    proof_portal_routes,
    support_routes,
    os_notificacao_routes,
    prova_web_routes,
)
from security.api_auth import APIAccessMiddleware, is_master_client, resolve_client_ip
from logging_setup import configure_root_api_logging
from config_manager import config_manager
from static_files import (
    SpaStaticFiles,
    SafeStaticFiles,
    is_spa_frontend,
    resolve_frontend_dir,
    resolve_legacy_portal_dir,
)

configure_root_api_logging()
logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_FRONTEND_DIR = resolve_frontend_dir(_PROJECT_ROOT)

app = FastAPI(
    title="SAGRA API",
    version="7.1 Modular",
    openapi_version="3.1.0",
    description="API SAGRA Web — contratos OpenAPI 3.1 para UI React/TypeScript",
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    from database import DatabaseConnectionError, DatabasePoolExhausted
    from resilience.http_errors import GENERIC_BUSY, GENERIC_DB, GENERIC_INTERNAL, log_internal_error

    if isinstance(exc, DatabasePoolExhausted):
        log_internal_error("db_pool", exc, path=request.url.path)
        return JSONResponse(
            status_code=503,
            content={"detail": GENERIC_BUSY},
            headers={"Retry-After": "5"},
        )
    if isinstance(exc, DatabaseConnectionError):
        log_internal_error("db_connection", exc, path=request.url.path)
        return JSONResponse(status_code=503, content={"detail": GENERIC_DB})

    log_internal_error("unhandled", exc, path=request.url.path)
    return JSONResponse(status_code=500, content={"detail": GENERIC_INTERNAL})


# --- MONITORAMENTO DE IPs ---
connected_ips = {}  # {ip: timestamp}

class ConnectedIPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host
        # Update timestamp
        connected_ips[client_ip] = time.time()
        response = await call_next(request)
        return response

class SagraApiPrefixMiddleware(BaseHTTPMiddleware):
    """DEV/unificado sem Nginx: expõe /sagra/api/* como alias de /api/*."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path == "/sagra/api" or path.startswith("/sagra/api/"):
            request.scope["path"] = path[len("/sagra") :]
            request.scope["raw_path"] = request.scope["path"].encode("utf-8")
        return await call_next(request)


app.add_middleware(SagraApiPrefixMiddleware)

# --- MIDDLEWARE NO-CACHE ---
class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        # Aplica headers de no-cache para todas as rotas da API
        if request.url.path.startswith("/api/") or request.url.path.startswith("/sagra/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response

app.add_middleware(NoCacheMiddleware)

# --- MIDDLEWARE CONTROLE DE ACESSO (PERMISSÕES/IP) ---
from routers.ip_admin_routes import get_client_permissions
from starlette.responses import HTMLResponse

class AccessControlMiddleware(BaseHTTPMiddleware):
    """
    Middleware que controla o acesso às telas do sistema (HTML) baseando-se no IP.
    Bloqueia IPs não cadastrados e verifica permissões específicas por tela.
    """
    
    # Mapeamento URL -> Permissão necessária (coluna do banco)
    SCREEN_PERMISSIONS = {
        "/index.html": "sb_inicio",
        "/": "sb_inicio",
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
    
    async def dispatch(self, request: Request, call_next):
        from security.spa_access import (
            _MASTER_ONLY,
            api_url_prefix,
            has_screen_access_for_spa_path,
            is_exempt_path,
            is_spa_access_control_enabled,
            is_spa_navigation_request,
            is_spa_shell_path,
            normalize_spa_path,
            required_permission_for_spa_path,
            resolve_default_spa_route,
            resolve_page_permissions,
        )

        path = request.url.path or ""
        path_lower = path.lower()

        if not is_spa_access_control_enabled():
            return await call_next(request)

        if is_master_client(request):
            return await call_next(request)

        if is_exempt_path(path_lower):
            return await call_next(request)

        if not is_spa_navigation_request(request):
            return await call_next(request)

        allowed = config_manager.get("allowed_ips") or {}
        master_ip = allowed.get("master") or "10.120.1.14"
        local_ip = allowed.get("local_network") or config_manager.get("server_host", "10.1.1.73")
        api_prefix = api_url_prefix(request)
        api_client_prefix = config_manager.get_api_path_prefix()
        app_path = normalize_spa_path(path_lower)

        # --- LÓGICA DE BLOQUEIO (SPA + HTML legado) ---

        client_ip = resolve_client_ip(request)
        xff = request.headers.get("x-forwarded-for")
        
        # LOG IP DEBUG
        logger.info(f"🛡️ MW_CHECK: Path={path} | IP={client_ip} | XFF={xff}")

        
        perms = resolve_page_permissions(client_ip, app_path, request=request)

        from security.cloudflare_access import is_trusted_public_host
        from security.public_access import get_password_session, should_use_user_permissions
        from security.session_auth import get_session_from_request
        from starlette.responses import RedirectResponse

        password_session = get_password_session(request)
        public_password = bool(password_session) and is_trusted_public_host(request)
        session_for_msg = get_session_from_request(request)
        use_user_acl_messaging = bool(
            session_for_msg
            and should_use_user_permissions(request, session_for_msg)
        )

        # Host público + login senha: shell SPA sempre liberado (React redireciona pela ACL).
        if public_password and is_spa_shell_path(app_path):
            return await call_next(request)

        # 1. IP não cadastrado (exceto rotas públicas: login, portal, painel)
        if perms is None:
            if is_trusted_public_host(request):
                # cgraf.online e intranet: SPA na raiz; /sagra/* legado redireciona no Worker/HTML
                prefix = api_url_prefix(request)
                login_path = f"{prefix}/login" if prefix else "/login"
                redirect_q = app_path if app_path not in ("/", "/login", "/index.html") else ""
                target = f"{login_path}?redirect={redirect_q}" if redirect_q else login_path
                logger.info(
                    "Internet pública: redirecionando para login path=%s", app_path
                )
                return RedirectResponse(url=target, status_code=302)

            logger.warning(f"🚫 ACESSO NEGADO: IP {client_ip} não cadastrado tentando acessar {path}")
            html_content = f"""
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Acesso Restrito</title>
                <style>
                    body {{
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        background-color: #f4f6f9;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                    }}
                    .container {{
                        background: white;
                        padding: 30px;
                        border-radius: 10px;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                        width: 100%;
                        max-width: 400px;
                        text-align: center;
                    }}
                    h1 {{ color: #dc3545; margin-bottom: 10px; font-size: 24px; }}
                    p {{ color: #666; margin-bottom: 20px; }}
                    .form-group {{ margin-bottom: 15px; text-align: left; }}
                    label {{ display: block; margin-bottom: 5px; font-weight: 600; color: #333; }}
                    input {{
                        width: 100%;
                        padding: 10px;
                        border: 1px solid #ddd;
                        border-radius: 5px;
                        box-sizing: border-box;
                    }}
                    button {{
                        width: 100%;
                        padding: 12px;
                        background-color: #007bff;
                        color: white;
                        border: none;
                        border-radius: 5px;
                        font-size: 16px;
                        font-weight: bold;
                        cursor: pointer;
                        transition: background 0.2s;
                    }}
                    button:hover {{ background-color: #0056b3; }}
                    .message {{
                        margin-top: 15px;
                        padding: 10px;
                        border-radius: 5px;
                        display: none;
                        font-size: 14px;
                    }}
                    .success {{ background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }}
                    .error {{ background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }}
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🚫 Acesso Restrito</h1>
                    <p>IP não autorizado: <strong>{client_ip}</strong></p>
                    <p>Preencha os dados abaixo para solicitar acesso:</p>
                    
                    <form id="accessForm" onsubmit="event.preventDefault(); requestAccess();">
                        <div class="form-group">
                            <label>Nome Completo</label>
                            <input type="text" id="nome" required placeholder="Seu nome">
                        </div>
                        <div class="form-group">
                            <label>Ponto (Matrícula)</label>
                            <input type="number" id="ponto" required placeholder="Ex: 1234">
                        </div>
                        <div class="form-group">
                            <label>Seção</label>
                            <input type="text" id="secao" required list="secoesList" placeholder="Ex: Sefoc">
                            <datalist id="secoesList">
                                <option value="Sefoc">
                                <option value="Sefoc/Offset">
                                <option value="Sefoc/Digital">
                                <option value="Sefoc/Acabamento">
                                <option value="Sefoc/Expedição">
                                <option value="Protocolo">
                                <option value="Administrativo">
                            </datalist>
                        </div>
                        <button type="submit" id="btnSubmit">Solicitar Acesso</button>
                    </form>
                    <div id="msgBox" class="message"></div>
                </div>

                <script>
                    async function requestAccess() {{
                        const btn = document.getElementById('btnSubmit');
                        const msgBox = document.getElementById('msgBox');
                        const form = document.getElementById('accessForm');
                        
                        btn.disabled = true;
                        btn.innerText = 'Enviando...';
                        msgBox.style.display = 'none';

                        const data = {{
                            ip: "{client_ip}",
                            nome: document.getElementById('nome').value,
                            ponto: parseInt(document.getElementById('ponto').value),
                            secao: document.getElementById('secao').value
                        }};

                        try {{
                            const res = await fetch('{api_client_prefix}/access-request', {{
                                method: 'POST',
                                headers: {{ 'Content-Type': 'application/json' }},
                                body: JSON.stringify(data)
                            }});
                            
                            const json = await res.json();
                            
                            if (res.ok) {{
                                msgBox.className = 'message success';
                                msgBox.innerHTML = '✅ Solicitação enviada! Aguarde a liberação.';
                                msgBox.style.display = 'block';
                                form.reset();
                            }} else {{
                                throw new Error(json.detail || 'Erro ao enviar');
                            }}
                        }} catch (e) {{
                            msgBox.className = 'message error';
                            msgBox.innerHTML = '❌ ' + e.message;
                            msgBox.style.display = 'block';
                        }} finally {{
                            btn.disabled = false;
                            btn.innerText = 'Solicitar Acesso';
                        }}
                    }}
                </script>
            </body>
            </html>
            """
            return HTMLResponse(content=html_content, status_code=403)

        required_perm = required_permission_for_spa_path(app_path)

        if required_perm == _MASTER_ONLY:
            if (
                client_ip != master_ip
                and client_ip != local_ip
                and client_ip not in ("127.0.0.1", "::1")
            ):
                logger.warning(
                    "🔒 ACESSO EXCLUSIVO: IP %s tentou acessar rota não mapeada %s",
                    client_ip,
                    app_path,
                )
                return HTMLResponse(
                    content="<div style='display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;flex-direction:column;color:#fff;background:#343a40'>"
                    "<h1>🔒 Área Restrita</h1>"
                    "<p>Esta tela é acessível apenas pelo terminal administrativo central.</p>"
                    "</div>",
                    status_code=403,
                )
            return await call_next(request)

        if required_perm:
            has_screen_access = has_screen_access_for_spa_path(app_path, perms)

            # Se a tela requer permissão e o IP/usuário não tem -> BLOQUEAR
            if not has_screen_access:
                # Internet (login senha): redirect para módulo liberado ou mensagem de conta.
                if public_password or use_user_acl_messaging:
                    fallback = resolve_default_spa_route(perms or {})
                    if fallback and fallback != app_path:
                        prefix = api_url_prefix(request)
                        target = f"{prefix}{fallback}" if prefix else fallback
                        logger.info(
                            "Internet: sem ACL para %s — redirect para %s ponto=%s",
                            app_path,
                            target,
                            getattr(session_for_msg, "ponto", None),
                        )
                        return RedirectResponse(url=target, status_code=302)

                    logger.warning(
                        "⛔ ACESSO RESTRITO (usuário): ponto=%s path=%s sem permissão '%s'",
                        getattr(session_for_msg, "ponto", None),
                        path,
                        required_perm,
                    )
                    return HTMLResponse(
                        content=(
                            "<div style='display:flex;justify-content:center;align-items:center;"
                            "height:100vh;font-family:sans-serif;flex-direction:column;"
                            "color:#333;background:#f8f9fa;text-align:center;padding:24px'>"
                            "<h1 style='color:#856404'>⛔ Acesso Restrito</h1>"
                            "<p>Sua conta não tem permissão para este módulo. "
                            "Solicite liberação ao administrador.</p>"
                            f"<p style='color:#666;font-size:14px'>Módulo: <strong>{required_perm}</strong></p>"
                            "</div>"
                        ),
                        status_code=403,
                    )

                logger.warning(f"⛔ ACESSO RESTRITO: IP {client_ip} tentou acessar {path} sem permissão '{required_perm}'")
                html_content = f"""
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Acesso Restrito</title>
                    <style>
                        body {{
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background-color: #fff3cd; /* Yellow for restricted */
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                        }}
                        .container {{
                            background: white;
                            padding: 30px;
                            border-radius: 10px;
                            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                            width: 100%;
                            max-width: 400px;
                            text-align: center;
                            border-top: 5px solid #ffc107;
                        }}
                        h1 {{ color: #856404; margin-bottom: 10px; font-size: 24px; }}
                        p {{ color: #666; margin-bottom: 20px; }}
                        .form-group {{ margin-bottom: 15px; text-align: left; }}
                        label {{ display: block; margin-bottom: 5px; font-weight: 600; color: #333; }}
                        input {{
                            width: 100%;
                            padding: 10px;
                            border: 1px solid #ddd;
                            border-radius: 5px;
                            box-sizing: border-box;
                        }}
                        button {{
                            width: 100%;
                            padding: 12px;
                            background-color: #ffc107;
                            color: black;
                            border: none;
                            border-radius: 5px;
                            font-size: 16px;
                            font-weight: bold;
                            cursor: pointer;
                            transition: background 0.2s;
                        }}
                        button:hover {{ background-color: #e0a800; }}
                        .message {{
                            margin-top: 15px;
                            padding: 10px;
                            border-radius: 5px;
                            display: none;
                            font-size: 14px;
                        }}
                        .success {{ background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }}
                        .error {{ background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }}
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>⛔ Acesso Restrito</h1>
                        <p>Seu IP (<strong>{client_ip}</strong>) não tem permissão para: <strong>{required_perm}</strong></p>
                        <p>Preencha para solicitar liberação:</p>
                        
                        <form id="accessForm" onsubmit="event.preventDefault(); requestAccess();">
                            <div class="form-group">
                                <label>Nome Completo</label>
                                <input type="text" id="nome" required placeholder="Seu nome">
                            </div>
                            <div class="form-group">
                                <label>Ponto (Matrícula)</label>
                                <input type="number" id="ponto" required placeholder="Ex: 1234">
                            </div>
                            <div class="form-group">
                                <label>Seção</label>
                                <input type="text" id="secao" required list="secoesList" placeholder="Ex: Sefoc">
                                <datalist id="secoesList">
                                    <option value="Sefoc">
                                    <option value="Sefoc/Offset">
                                    <option value="Sefoc/Digital">
                                    <option value="Sefoc/Acabamento">
                                    <option value="Sefoc/Expedição">
                                    <option value="Protocolo">
                                    <option value="Administrativo">
                                </datalist>
                            </div>
                            <button type="submit" id="btnSubmit">Solicitar Acesso</button>
                        </form>
                        <div id="msgBox" class="message"></div>
                    </div>

                    <script>
                        async function requestAccess() {{
                            const btn = document.getElementById('btnSubmit');
                            const msgBox = document.getElementById('msgBox');
                            const form = document.getElementById('accessForm');
                            
                            btn.disabled = true;
                            btn.innerText = 'Enviando...';
                            msgBox.style.display = 'none';

                            const data = {{
                                ip: "{client_ip}",
                                nome: document.getElementById('nome').value,
                                ponto: parseInt(document.getElementById('ponto').value),
                                secao: document.getElementById('secao').value
                            }};

                            try {{
                                const res = await fetch('{api_client_prefix}/access-request', {{
                                    method: 'POST',
                                    headers: {{ 'Content-Type': 'application/json' }},
                                    body: JSON.stringify(data)
                                }});
                                
                                const json = await res.json();
                                
                                if (res.ok) {{
                                    msgBox.className = 'message success';
                                    msgBox.innerHTML = '✅ Solicitação enviada! Aguarde liberação.';
                                    msgBox.style.display = 'block';
                                    form.reset();
                                }} else {{
                                    throw new Error(json.detail || 'Erro ao enviar');
                                }}
                            }} catch (e) {{
                                msgBox.className = 'message error';
                                msgBox.innerHTML = '❌ ' + e.message;
                                msgBox.style.display = 'block';
                            }} finally {{
                                btn.disabled = false;
                                btn.innerText = 'Solicitar Acesso';
                            }}
                        }}
                    </script>
                </body>
                </html>
                """
                return HTMLResponse(content=html_content, status_code=403)

        return await call_next(request)

app.add_middleware(AccessControlMiddleware)

# --- SEGURANÇA CLOUDFLARE TUNNEL / DOMÍNIO PÚBLICO ---
from security.cloudflare_access import is_cloudflare_public_request, is_trusted_public_host


class CloudflareTunnelSecurityMiddleware(BaseHTTPMiddleware):
    """
    Bloqueia rotas internas quando a requisição vem do Cloudflare ou domínio público HTTPS.
    Permite portal cliente, painéis (/painel/*) e APIs de leitura dos painéis.
    Acesso direto LAN (cgrafsysvm/10.1.1.73, sem host público) permanece liberado.
    """

    async def dispatch(self, request: Request, call_next):
        cf_connecting_ip = (request.headers.get("CF-Connecting-IP") or "").strip()
        # CF-RAY sozinho aparece no proxy Worker->zrok (zrok.io na borda Cloudflare).
        # Tratar só CF-Connecting-IP evita bloquear o painel como se fosse tunel publico.
        is_cloudflare = bool(cf_connecting_ip)
        is_public_host = is_trusted_public_host(request)

        if not is_cloudflare and not is_public_host:
            return await call_next(request)

        path = request.url.path or ""
        if is_cloudflare_public_request(request):
            logger.info(
                "Cloudflare: acesso permitido %s %s de %s (host=%s)",
                request.method,
                path,
                cf_connecting_ip,
                request.headers.get("x-forwarded-host") or request.headers.get("host"),
            )
            return await call_next(request)

        logger.warning(
            "Cloudflare: acesso bloqueado %s %s de %s (host=%s)",
            request.method,
            path,
            cf_connecting_ip,
            request.headers.get("x-forwarded-host") or request.headers.get("host"),
        )
        return JSONResponse(
            status_code=403,
            content={
                "error": "Access Denied",
                "message": "Esta página não está disponível publicamente.",
            },
        )

# Cloudflare Tunnel: desativado em ENV=development (acesso 100% local)
if not config_manager.is_development():
    app.add_middleware(CloudflareTunnelSecurityMiddleware)
else:
    logger.info("Modo development: middleware Cloudflare Tunnel DESATIVADO")

app.add_middleware(ConnectedIPMiddleware)

# CORS — apenas origens internas da LAN (sem wildcard + credentials)
_cors_origins = config_manager.get_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-Sagra-Notify-Secret",
    ],
)

# API: validação de IP (último = executa primeiro) — remove bypass cego de /api/
app.add_middleware(APIAccessMiddleware)


class AuditClientIpMiddleware(BaseHTTPMiddleware):
    """Propaga o IP do cliente para registros de auditoria de OS (contextvar)."""

    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        from routers.os_audit_service import bind_audit_client_ip, reset_audit_client_ip

        bind_audit_client_ip(resolve_client_ip(request))
        try:
            return await call_next(request)
        finally:
            reset_audit_client_ip()


app.add_middleware(AuditClientIpMiddleware)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Headers básicos de hardening — compatível com painéis e PWA."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault(
            "Referrer-Policy", "strict-origin-when-cross-origin"
        )
        response.headers.setdefault(
            "Permissions-Policy", "camera=(self), microphone=(self), geolocation=()"
        )
        path = request.url.path or ""
        if path.startswith("/api/auth/") or path.startswith("/api/client/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        from security.rate_limit import check_rate_limit

        blocked = check_rate_limit(request)
        if blocked is not None:
            return blocked
        return await call_next(request)


_SLOW_REQUEST_MS = 500.0
_SLOW_REQUEST_PREFIXES = (
    "/api/cliente/dashboard",
    "/api/pcp/queue",
    "/api/os/search",
    "/api/client/",
)


class SlowRequestLoggingMiddleware(BaseHTTPMiddleware):
    """Registra latência elevada em rotas críticas (sem logar corpo ou tokens)."""

    async def dispatch(self, request: Request, call_next):
        path = (request.url.path or "").rstrip("/") or "/"
        should_watch = path == "/api/cliente/dashboard" or any(
            path.startswith(prefix) for prefix in _SLOW_REQUEST_PREFIXES
        )
        if not should_watch:
            return await call_next(request)

        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        if elapsed_ms >= _SLOW_REQUEST_MS:
            logger.warning(
                "Slow request: %s %s %.0fms status=%s",
                request.method,
                path,
                elapsed_ms,
                response.status_code,
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SlowRequestLoggingMiddleware)

# --- ROTAS DE MONITORAMENTO ---
@app.get("/health/live")
def health_live():
    """Liveness rápido — não consulta MySQL (uso: Vite proxy / iniciar-api.bat)."""
    return {"status": "ok"}


@app.get("/api/app-version")
def app_version():
    """Build id do frontend publicado — público, sem DB (detecção de update no client)."""
    build_id = ""
    try:
        from config_manager import PROJECT_ROOT

        build_file = PROJECT_ROOT / "app" / "frontend" / "build-id.txt"
        if build_file.is_file():
            build_id = build_file.read_text(encoding="utf-8").strip()
    except Exception:
        pass
    return {"build_id": build_id}


@app.get("/health")
def health():
    release_info = {}
    try:
        from config_manager import PROJECT_ROOT

        release_file = PROJECT_ROOT / "RELEASE.txt"
        if release_file.is_file():
            for line in release_file.read_text(encoding="utf-8").splitlines():
                if "=" in line:
                    key, val = line.split("=", 1)
                    release_info[key.strip()] = val.strip()
    except Exception:
        pass

    try:
        from database import db

        db.execute_query("SELECT 1 AS ok")
        payload = {"status": "ok", "db": "ok"}
        if release_info:
            payload["release"] = release_info.get("release")
            payload["deployed_at"] = release_info.get("deployed_at")
        return payload
    except Exception as exc:
        logger.error("Health check DB falhou: %s", exc)
        payload = {"status": "degraded", "db": "unavailable"}
        if release_info:
            payload["release"] = release_info.get("release")
        return JSONResponse(status_code=503, content=payload)

@app.get("/api/connected-ips")
def get_connected_ips(request: Request):
    if not is_master_client(request):
        raise HTTPException(status_code=403, detail="Acesso restrito ao MASTER_IP.")
    # Limpa IPs inativos (> 60s)
    now = time.time()
    active_ips = {ip: ts for ip, ts in connected_ips.items() if now - ts < 60}
    
    # Atualiza a lista global (side effect para limpeza)
    connected_ips.clear()
    connected_ips.update(active_ips)
    
    # Retorna lista formatada
    return [
        {"ip": ip, "last_seen": datetime.fromtimestamp(ts).strftime('%H:%M:%S')}
        for ip, ts in active_ips.items()
    ]

@app.get("/api/download/folder-opener")
async def download_folder_opener():
    """
    Endpoint para download do executável SAGRA Folder Opener
    
    Permite que usuários baixem o serviço local que possibilita
    a abertura automática de pastas do Windows Explorer.
    
    Returns:
        FileResponse: Executável .exe
    """
    try:
        exe_path = os.path.join("local_services", "dist", "SAGRA-FolderOpener.exe")
        
        if not os.path.exists(exe_path):
            logger.warning(f"Executável não encontrado: {exe_path}")
            from fastapi import HTTPException
            raise HTTPException(
                status_code=404,
                detail="Executável não disponível. Execute o build primeiro: cd local_services && build_executable.bat"
            )
        
        # Caminho sugerido para instalação automática no startup
        suggested_filename = "SAGRA-FolderOpener.exe"
        
        logger.info(f"Download do folder opener iniciado")
        
        return FileResponse(
            path=exe_path,
            media_type="application/octet-stream",
            filename=suggested_filename,
            headers={
                "Content-Disposition": f'attachment; filename="{suggested_filename}"',
                "X-Suggested-Path": "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"
            }
        )
    except Exception as e:
        logger.error(f"Erro no download: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))

# Rotas públicas / auth / config (Fase B)
app.include_router(config_routes.router)
app.include_router(auth_routes.router)
app.include_router(user_admin_routes.router)
app.include_router(setor_painel_routes.router)
app.include_router(tablet_face_routes.router)
app.include_router(admin_system_routes.router)
app.include_router(admin_os_materialized_routes.router, prefix="/api")

# Incluir as Rotas (Modularização)
app.include_router(os_routes.router, prefix="/api")
app.include_router(os_filter_options_routes.router, prefix="/api")
app.include_router(os_sub_os_routes.router, prefix="/api")
app.include_router(os_arquivos_routes.router, prefix="/api")
app.include_router(cliente_gabinete_routes.router)
app.include_router(proof_portal_routes.router, prefix="/api")
app.include_router(analise_routes.router, prefix="/api")
app.include_router(pre_analise_routes.router, prefix="/api")
app.include_router(auxiliar_routes.router, prefix="/api")
app.include_router(papelaria_routes.router, prefix="/api")
app.include_router(papelaria_worker_routes.router, prefix="/api")
app.include_router(settings_routes.router, prefix="/api")
app.include_router(ip_admin_routes.router)  # Já tem /api no próprio router
app.include_router(user_routes.router)

@app.on_event("startup")
async def startup_bind_realtime_loop():
    import asyncio
    import os
    from routers.realtime import bind_main_event_loop
    from services.support_fix_version import SUPPORT_WS_FIX_VERSION

    bind_main_event_loop(asyncio.get_running_loop())
    from services.os_materialized_reconcile_scheduler import (
        start_materialized_reconcile_scheduler,
    )

    start_materialized_reconcile_scheduler()
    try:
        from services.andamento_table import ensure_andamento_table

        tbl = ensure_andamento_table()
        logger.info("Startup: tabela de andamento MySQL = %s", tbl)
    except Exception as exc:
        logger.warning("Startup: não foi possível resolver tabela de andamento: %s", exc)
    logger.info(
        "[SUPPORT WS FIX VERSION] %s pid=%s",
        SUPPORT_WS_FIX_VERSION,
        os.getpid(),
    )


@app.on_event("startup")
def startup_init():
    try:
        config_manager.write_client_config_js()
        logger.info(
            "Startup: ENV=%s | API=%s | MYSQL_ONLY=%s | SYNC=%s",
            config_manager.get("env"),
            config_manager.get_api_base(),
            config_manager.is_mysql_only(),
            config_manager.is_sync_andamentos_enabled(),
        )
    except Exception as exc:
        logger.error("Erro ao gerar config_client.js: %s", exc)

    try:
        from database import db
        db.execute_query("""
            CREATE TABLE IF NOT EXISTS tabUsuarios (
                Ponto INT PRIMARY KEY,
                Nome VARCHAR(255),
                UltimoAcesso DATETIME,
                IPUltimoAcesso VARCHAR(45)
            );
        """)
    except Exception as exc:
        logger.error("Erro no startup check de DB: %s", exc)

    try:
        from user_auth_schema import ensure_user_auth_schema
        ensure_user_auth_schema()
    except Exception as exc:
        logger.error("Erro ao migrar user_auth no startup: %s", exc)

    try:
        from user_registered_ips_schema import ensure_user_registered_ips_schema
        ensure_user_registered_ips_schema()
    except Exception as exc:
        logger.error("Erro ao migrar user_registered_ips no startup: %s", exc)

    try:
        from setor_painel_schema import ensure_setor_painel_schema
        ensure_setor_painel_schema()
    except Exception as exc:
        logger.error("Erro ao migrar setor_painel no startup: %s", exc)

    try:
        from usuario_face_schema import ensure_usuario_face_schema
        ensure_usuario_face_schema()
    except Exception as exc:
        logger.error("Erro ao migrar tabUsuarioFace no startup: %s", exc)

    try:
        from ip_permissions_schema import ensure_ip_permissions_schema
        ensure_ip_permissions_schema()
    except Exception as exc:
        logger.error("Erro ao migrar ip_permissions no startup: %s", exc)

    try:
        from saved_filters_schema import ensure_saved_filters_schema
        ensure_saved_filters_schema()
    except Exception as exc:
        logger.error("Erro ao migrar saved_filters no startup: %s", exc)

    try:
        from cliente_cota_schema import ensure_cliente_cota_schema
        ensure_cliente_cota_schema()
    except Exception as exc:
        logger.error("Erro ao migrar cliente_cota no startup: %s", exc)

    try:
        from coef_a4_produto_schema import ensure_coef_a4_produto_schema
        from services.coef_a4_produto_service import seed_coef_a4_produto_from_protocolos

        ensure_coef_a4_produto_schema()
        seed_coef_a4_produto_from_protocolos()
    except Exception as exc:
        logger.error("Erro ao migrar coef_a4_produto no startup: %s", exc)

    try:
        from services.email_config_service import ensure_email_config_schema
        ensure_email_config_schema()
    except Exception as exc:
        logger.error("Erro ao migrar tabEmailExchangeConfig no startup: %s", exc)

    try:
        from services.email_template_store import ensure_email_template_config_schema
        ensure_email_template_config_schema()
    except Exception as exc:
        logger.error("Erro ao migrar tabEmailTemplateConfig no startup: %s", exc)

    try:
        from services.email_template_model_service import (
            ensure_default_email_template_models,
            ensure_email_template_model_schema,
        )
        ensure_email_template_model_schema()
        ensure_default_email_template_models()
    except Exception as exc:
        logger.error("Erro ao migrar tabEmailTemplateModel no startup: %s", exc)

    try:
        from cliente_gabinete_schema import ensure_cliente_gabinete_schema
        ensure_cliente_gabinete_schema()
    except Exception as exc:
        logger.error("Erro ao migrar cliente_gabinete no startup: %s", exc)

    try:
        from system_catalog_schema import ensure_system_catalog_schema
        ensure_system_catalog_schema()
    except Exception as exc:
        logger.error("Erro ao migrar system_catalog no startup: %s", exc)

    try:
        from os_sub_os_schema import ensure_os_sub_os_schema
        ensure_os_sub_os_schema()
    except Exception as exc:
        logger.error("Erro ao migrar schema Sub OS no startup: %s", exc)

    try:
        from os_vinculo_grupo_schema import ensure_os_vinculo_grupo_schema
        ensure_os_vinculo_grupo_schema()
    except Exception as exc:
        logger.error("Erro ao migrar schema grupo vínculo OS no startup: %s", exc)

    try:
        from os_search_indexes_schema import ensure_os_search_indexes
        ensure_os_search_indexes()
        from os_text_search_indexes_schema import ensure_os_text_search_indexes
        ensure_os_text_search_indexes()
        from os_filter_options_schema import ensure_os_filter_options_schema
        ensure_os_filter_options_schema()
    except Exception as exc:
        logger.error("Erro ao garantir índices de busca OS no startup: %s", exc)

    try:
        from os_ultimo_andamento_schema import ensure_os_ultimo_andamento_schema
        ensure_os_ultimo_andamento_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema ultimo andamento operacional: %s", exc)

    try:
        from user_preferences_schema import ensure_user_preferences_schema
        ensure_user_preferences_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema tabUserPreferences no startup: %s", exc)

    try:
        from os_notificacao_schema import ensure_os_notificacao_schema
        ensure_os_notificacao_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema de notificação OS no startup: %s", exc)

    try:
        from services.gravacao_externa_schema import ensure_gravacao_externa_schema
        ensure_gravacao_externa_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema Gravação Externa no startup: %s", exc)

    try:
        from services.gravacao_pendente_schema import ensure_gravacao_pendente_schema
        ensure_gravacao_pendente_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema Gravação Pendente no startup: %s", exc)

    try:
        from services.gravacao_externa_service import repair_legacy_gravacao_externa_andamentos

        repaired = repair_legacy_gravacao_externa_andamentos()
        if repaired:
            logger.info(
                "Reparo andamentos legado Gravação Externa: %s OS(s)",
                len(repaired),
            )
    except Exception as exc:
        logger.error("Erro no reparo de andamentos legado Gravação Externa: %s", exc)

    try:
        from services.gravacao_preview_cache_service import (
            enqueue_preview_warmup_for_active_sessions,
        )

        enqueue_preview_warmup_for_active_sessions()
    except Exception as exc:
        logger.error("Warmup preview gravação no startup: %s", exc)

    try:
        from estoque_schema import ensure_estoque_schema
        ensure_estoque_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema Estoque no startup: %s", exc)

    try:
        from credenciais_depol_schema import ensure_credenciais_depol_schema
        ensure_credenciais_depol_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema Credenciais DEPOL no startup: %s", exc)

    try:
        from custo_funcao_schema import ensure_custo_funcao_schema
        ensure_custo_funcao_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema Custo Função no startup: %s", exc)

    try:
        from prova_web_schema import ensure_prova_web_schema
        ensure_prova_web_schema()
    except Exception as exc:
        logger.error("Erro ao garantir schema Prova WEB no startup: %s", exc)

    try:
        from services.prova_web_fold_model_service import (
            ensure_prova_web_fold_model_schema,
        )
        ensure_prova_web_fold_model_schema()
    except Exception as exc:
        logger.error(
            "Erro ao garantir schema tabProvaWebFoldModel no startup: %s", exc
        )

    try:
        from services.deputados_local_service import importar_deputados_xls_se_necessario
        importar_deputados_xls_se_necessario()
    except Exception as exc:
        logger.error("Erro ao importar deputado.xls no startup: %s", exc)
app.include_router(pcp_routes.router, prefix="/api")
app.include_router(gravacao_routes.router, prefix="/api")
app.include_router(cotas_graf_routes.router, prefix="/api")
app.include_router(estoque_routes.router, prefix="/api")
app.include_router(credenciais_depol_routes.router, prefix="/api")
app.include_router(gravacao_externa_routes.router, prefix="/api")
app.include_router(gravacao_pendente_routes.router, prefix="/api")
app.include_router(network_files_routes.router, prefix="/api")
app.include_router(prova_web_routes.router, prefix="/api")
app.include_router(realtime.router)
app.include_router(requisicao_routes.router, prefix="/api")
app.include_router(email_routes.router, prefix="/api")
app.include_router(report_custom_routes.router, prefix="/api")
app.include_router(notifications_routes.router, prefix="/api")
app.include_router(os_notificacao_routes.router, prefix="/api")
app.include_router(support_routes.router)

if config_manager.is_sync_andamentos_enabled():
    from routers import sync_routes
    app.include_router(sync_routes.router, prefix="/api")
    logger.info("Rotas /api/sync/* habilitadas (SYNC_ANDAMENTOS_ENABLED=true)")
else:
    logger.info(
        "Rotas /api/sync/* desabilitadas — sync_andamentos executado por outro sistema (MYSQL_ONLY)"
    )

# Portal cliente (HTML legado em app/frontend/legacy quando o deploy usa SPA)
_LEGACY_PORTAL_DIR = resolve_legacy_portal_dir(_PROJECT_ROOT)


def _register_portal_client_routes() -> None:
    if not _LEGACY_PORTAL_DIR:
        return

    @app.get("/client_pt.html", include_in_schema=False)
    async def _serve_client_pt_html(request: Request):
        os_id = request.query_params.get("os")
        ano = request.query_params.get("ano")
        token = request.query_params.get("token")
        if os_id and ano and token:
            from starlette.responses import RedirectResponse

            base = config_manager.get_public_web_base().rstrip("/")
            return RedirectResponse(
                url=f"{base}/portal/pt/{token}?os={os_id}&ano={ano}",
                status_code=302,
            )
        path = _LEGACY_PORTAL_DIR / "client_pt.html"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(path, media_type="text/html; charset=utf-8")

    @app.get("/client_proof.html", include_in_schema=False)
    async def _serve_client_proof_html():
        path = _LEGACY_PORTAL_DIR / "client_proof.html"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(path, media_type="text/html; charset=utf-8")

    styles = _LEGACY_PORTAL_DIR / "styles.css"
    if styles.is_file():

        @app.get("/styles.css", include_in_schema=False)
        async def _serve_portal_styles():
            return FileResponse(styles, media_type="text/css")

    for subdir in ("js", "lib"):
        sub_path = _LEGACY_PORTAL_DIR / subdir
        if sub_path.is_dir():
            app.mount(
                f"/{subdir}",
                SafeStaticFiles(directory=str(sub_path)),
                name=f"portal_{subdir}",
            )

    logger.info("Portal cliente: rotas em %s", _LEGACY_PORTAL_DIR)


def _register_spa_shell_routes() -> None:
    """Deep links do React Router (ex.: /login/activate) — sempre servir index.html."""
    if not _FRONTEND_DIR or not is_spa_frontend(_FRONTEND_DIR):
        return
    index = _FRONTEND_DIR / "index.html"
    if not index.is_file():
        return

    async def _spa_shell() -> FileResponse:
        return FileResponse(index, media_type="text/html; charset=utf-8")

    for shell_path in (
        "/login",
        "/login/activate",
        "/cliente",
        "/cliente/login",
        "/cliente/login/activate",
        "/sagra/login",
        "/sagra/login/activate",
        "/sagra/cliente",
        "/sagra/cliente/login",
        "/sagra/cliente/login/activate",
    ):
        app.add_api_route(
            shell_path,
            _spa_shell,
            methods=["GET"],
            include_in_schema=False,
        )
    logger.info("SPA shell: rotas /login e /login/activate registradas")


_register_portal_client_routes()
_register_spa_shell_routes()

# Mount static files — SPA React (fallback index.html) ou HTML legado
if _FRONTEND_DIR and _FRONTEND_DIR.is_dir():
    static_cls = SpaStaticFiles if is_spa_frontend(_FRONTEND_DIR) else SafeStaticFiles
    mode = "SPA" if static_cls is SpaStaticFiles else "legado"
    logger.info("Frontend %s: %s", mode, _FRONTEND_DIR)
    mount_kwargs = {"directory": str(_FRONTEND_DIR), "html": True}
    if static_cls is SpaStaticFiles and _LEGACY_PORTAL_DIR:
        mount_kwargs["legacy_directory"] = str(_LEGACY_PORTAL_DIR)
    app.mount("/", static_cls(**mount_kwargs), name="static")
else:
    logger.error("Diretório frontend ausente em %s", _PROJECT_ROOT / "app" / "frontend")

if __name__ == "__main__":
    _srv = config_manager.get_server_config()
    _reload = config_manager.is_development()
    uvicorn.run(
        app,
        host=_srv["host"],
        port=_srv["port"],
        reload=_reload,
        access_log=True,
    )