"""Usuários com acesso equivalente ao IP Master via internet."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from starlette.requests import Request

REMOTE_MASTER_PONTOS: frozenset[int] = frozenset({918713})


def is_remote_master_ponto(ponto: int | None) -> bool:
    if ponto is None:
        return False
    try:
        return int(ponto) in REMOTE_MASTER_PONTOS
    except (TypeError, ValueError):
        return False


def is_remote_master_request(request: "Request") -> bool:
    """Sessão password + host público + ponto autorizado."""
    from security.public_access import is_password_session, is_public_internet_request
    from security.session_auth import get_session_from_request

    session = get_session_from_request(request)
    if not is_password_session(session):
        return False
    if not is_public_internet_request(request):
        return False
    return is_remote_master_ponto(session.ponto)
