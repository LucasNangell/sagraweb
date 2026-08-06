"""Autorização para POST /api/realtime/notify."""
from __future__ import annotations

import hmac
import logging
import os

from starlette.requests import Request

from security.api_auth import is_master_client, is_privileged_request
from security.session_auth import get_session_from_request

logger = logging.getLogger(__name__)

_NOTIFY_HEADER = "x-sagra-notify-secret"


def _notify_secret_configured() -> str:
    return (os.getenv("SAGRA_NOTIFY_SECRET") or "").strip()


def _notify_secret_valid(request: Request) -> bool:
    configured = _notify_secret_configured()
    if not configured:
        return False
    provided = (request.headers.get(_NOTIFY_HEADER) or "").strip()
    if not provided:
        return False
    return hmac.compare_digest(configured, provided)


def is_notify_authorized(request: Request) -> bool:
    """
    Autoriza notify por:
    1) Header X-Sagra-Notify-Secret (preferencial para scripts locais)
    2) IP privilegiado — somente se SAGRA_NOTIFY_SECRET não estiver definido (legado)
    3) Sessão válida + MASTER_IP (UI administrativa)
    """
    if _notify_secret_valid(request):
        return True

    configured = _notify_secret_configured()
    if not configured and is_privileged_request(request):
        return True

    session = get_session_from_request(request)
    if session is not None and is_master_client(request):
        return True

    return False


def notify_request_headers() -> dict[str, str]:
    """Headers para scripts locais (sync/monitor) enviarem notify."""
    secret = _notify_secret_configured()
    if not secret:
        return {}
    return {_NOTIFY_HEADER: secret}
