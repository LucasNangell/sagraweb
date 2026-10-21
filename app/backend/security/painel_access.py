"""
Acesso aos painéis (setor/global) conforme ip_permissions e overlay do usuário.

Rotas de API dos painéis sem sessão exigem IP cadastrado com permissão de painel.
"""
from __future__ import annotations

import os
import re
from typing import Callable, Optional

from painel_permissions import enrich_permissions

_PAINEL_SKIP_IP_ENV = "SAGRA_PAINEL_SKIP_IP_CHECK"

# GET de dados dos painéis (sem sessão, se IP autorizado)
_PAINEL_DATA_GET_PREFIXES = (
    "/api/pcp/queue",
    "/api/os/search",
)

# Modais de configuração dos painéis (setores, situações, andamentos)
_PAINEL_AUX_GET_PREFIXES = (
    "/api/aux/setores",
    "/api/aux/situacoes",
    "/api/aux/andamentos",
)

_PAINEL_API_GET_EXACT = frozenset({
    "/api/realtime/admin-reload",
    "/api/sync-andamentos/service-status",
})
_PAINEL_API_GET_PREFIXES = _PAINEL_DATA_GET_PREFIXES


def _normalize_painel_api_path(path: str) -> str:
    norm = (path or "").rstrip("/") or "/"
    if norm == "/sagra/api":
        return "/api"
    if norm.startswith("/sagra/api/"):
        return norm[len("/sagra") :]
    return norm


def is_painel_skip_ip_check_enabled() -> bool:
    raw = os.getenv(_PAINEL_SKIP_IP_ENV, "true").strip().lower()
    return raw in ("1", "true", "yes", "on", "sim")


def has_painel_setor_access(perms: dict) -> bool:
    setores = perms.get("painel_setores") or []
    if setores:
        return True
    if perms.get("painel_setores_legacy_all"):
        return bool(perms.get("sb_dashboard_setor"))
    return bool(perms.get("sb_dashboard_setor"))


def has_painel_global_access(perms: dict) -> bool:
    return bool(perms.get("sb_dashboard_global"))


def has_painel_tablet_access(perms: dict) -> bool:
    return bool(perms.get("sb_dashboard_tablet"))


def has_any_painel_access(perms: dict) -> bool:
    return (
        has_painel_setor_access(perms)
        or has_painel_global_access(perms)
        or has_painel_tablet_access(perms)
    )


def check_painel_spa_path_access(app_path: str, perms: dict) -> bool:
    norm = (app_path or "").rstrip("/") or "/"
    if norm == "/painel/global":
        return has_painel_global_access(perms)
    if norm in {"/painel/setor", "/painel/setor-moderno"} or norm.startswith("/painel/setor/"):
        return has_painel_setor_access(perms)
    if norm == "/painel/tablet" or norm.startswith("/painel/tablet/"):
        return has_painel_tablet_access(perms)
    if norm == "/painel/celular" or norm.startswith("/painel/celular/"):
        return has_painel_tablet_access(perms)
    if norm == "/painel/gravacao" or norm.startswith("/painel/gravacao/"):
        return has_painel_tablet_access(perms)
    return False


def build_painel_only_permissions(client_ip: str) -> dict:
    """Legado — não concede dashboards automaticamente."""
    return enrich_permissions({
        "ctx_nova_os": False,
        "ctx_duplicar_os": False,
        "ctx_editar_os": False,
        "ctx_vincular_os": False,
        "ctx_abrir_pasta": False,
        "ctx_mover_pastas": False,
        "ctx_imprimir_ficha": False,
        "ctx_imprimir_separador": False,
        "ctx_detalhes_os": False,
        "sb_inicio": False,
        "sb_gerencia": False,
        "sb_email": False,
        "sb_analise": False,
        "sb_papelaria": False,
        "sb_usuario": False,
        "sb_configuracoes": False,
        "sb_relatorio": False,
        "sb_dashboard_setor": False,
        "sb_dashboard_global": False,
        "sb_dashboard_tablet": False,
        "sb_admin_ips": False,
        "sb_pcp": False,
        "sb_usuarios": False,
        "sb_active_computers": False,
        "sb_gravacao": False,
        "sb_cotas_graf": False,
        "sb_gravacao_externa": False,
        "sb_gravacao_pendente": False,
        "sb_gravacao_externa_operador": False,
        "sb_gravacao_pendente_excluir": False,
        "sb_gravacao_externa_entrega": False,
        "sb_gravacao_externa_lancar": False,
        "sb_estoque": False,
        "sb_estoque_gerente": False,
        "sb_lombada": False,
        "sb_credenciais_depol": False,
        "sb_manipular_imagem": False,
        "ip": client_ip,
    })


def is_painel_data_api_route(path: str, method: str) -> bool:
    """Leitura de fila/OS e auxiliares para painel setor/global (sem login)."""
    if method != "GET":
        return False
    norm = _normalize_painel_api_path(path)
    if any(norm.startswith(prefix) for prefix in _PAINEL_DATA_GET_PREFIXES):
        return True
    return any(norm.startswith(prefix) for prefix in _PAINEL_AUX_GET_PREFIXES)


def is_painel_api_route(path: str, method: str) -> bool:
    """Rotas de API usadas pelos painéis (dados + auxiliares)."""
    if method != "GET":
        return False
    norm = _normalize_painel_api_path(path)
    if norm in _PAINEL_API_GET_EXACT:
        return True
    return is_painel_data_api_route(path, method)


def allow_painel_anonymous_api(
    path: str,
    method: str,
    *,
    client_ip: str,
    get_client_permissions: Callable[[str], Optional[dict]],
) -> bool:
    """Painel TV: dados somente para IP cadastrado com permissão de painel."""
    if not is_painel_api_route(path, method):
        return False
    perms = get_client_permissions(client_ip)
    if perms is None:
        return False
    return has_any_painel_access(perms)


def resolve_permissions_for_api(
    session_ip: str,
    path: str,
    method: str,
    *,
    get_client_permissions: Callable[[str], Optional[dict]],
) -> Optional[dict]:
    """Permissões para APIAccessMiddleware: cadastro IP ou overlay de usuário."""
    return get_client_permissions(session_ip)


def resolve_permissions_for_session(
    session_ip: str,
    *,
    get_client_permissions: Callable[[str], Optional[dict]],
) -> Optional[dict]:
    """GET /api/permissions — somente IP cadastrado (sem fail-open de painel)."""
    return get_client_permissions(session_ip)


_OS_NOTIFICACAO_WATCH_RE = re.compile(r"^/api/os/\d+/\d+/notificacao-watch$")
_PUSH_API_PREFIX = "/api/push/"
_PAINEL_TABLET_API_PREFIX = "/api/painel-tablet/"
_PAINEL_GRAVACAO_API_PREFIX = "/api/painel/gravacao"
_API_MUTATION_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_API_ADMIN_PREFIXES = ("/api/admin/", "/api/sync/")


def is_mobile_session_friendly_api_route(path: str, method: str) -> bool:
    """Push, inscrição por OS e demais gravações — celular/PWA muda IP (Wi‑Fi ↔ 4G)."""
    norm = _normalize_painel_api_path(path)
    if norm.startswith(_PUSH_API_PREFIX):
        return True
    if norm.startswith(_PAINEL_TABLET_API_PREFIX):
        return True
    if norm == _PAINEL_GRAVACAO_API_PREFIX or norm.startswith(
        f"{_PAINEL_GRAVACAO_API_PREFIX}/"
    ):
        return True
    if _OS_NOTIFICACAO_WATCH_RE.match(norm):
        return True
    verb = (method or "GET").upper()
    if verb not in _API_MUTATION_METHODS:
        return False
    if any(norm.startswith(prefix) for prefix in _API_ADMIN_PREFIXES):
        return False
    return norm.startswith("/api/")


def should_skip_session_ip_binding(path: str, method: str) -> bool:
    """Painel via túnel/proxy: não invalidar sessão se o IP observado mudar."""
    if is_mobile_session_friendly_api_route(path, method):
        return True
    return is_painel_skip_ip_check_enabled() and is_painel_api_route(path, method)
