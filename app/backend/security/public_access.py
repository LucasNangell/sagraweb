"""
Detecção de acesso via internet pública (cgraf.online) vs rede local.
Login por e-mail/senha só é exigido no host público.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from security.cloudflare_access import is_trusted_public_host
from security.session_auth import SessionData, get_session_from_request

if TYPE_CHECKING:
    from starlette.requests import Request

AUTH_MODE_LOCAL = "local"
AUTH_MODE_PASSWORD = "password"


def is_public_internet_request(request: "Request") -> bool:
    """True quando o host indica domínio público HTTPS (não LAN)."""
    return is_trusted_public_host(request)


def is_password_session(session: Optional[SessionData]) -> bool:
    return session is not None and session.auth_mode == AUTH_MODE_PASSWORD


def get_password_session(request: "Request") -> Optional[SessionData]:
    session = get_session_from_request(request)
    if is_password_session(session):
        return session
    return None


def should_use_user_permissions(request: "Request", session: SessionData) -> bool:
    """Permissões por ponto (user_permissions) em vez de IP."""
    return is_password_session(session) and is_public_internet_request(request)
