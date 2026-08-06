"""Autorização para endpoints do worker Papelaria Corel."""
from __future__ import annotations

import hmac
import logging
import os
import re

from starlette.requests import Request

logger = logging.getLogger(__name__)

_WORKER_HEADER = "x-sagra-worker-secret"

_WORKER_PATHS_EXACT = frozenset(
    {
        "/api/papelaria/worker/heartbeat",
        "/api/papelaria/jobs/claim",
        "/api/papelaria/worker/inspect/claim",
    }
)

_WORKER_PATH_RE = re.compile(
    r"^/api/papelaria/(?:jobs/\d+/(complete|fail|log)|worker/inspect/[a-f0-9]+/(complete|fail))$"
)
_WORKER_GET_PATH_RE = re.compile(
    r"^/api/papelaria/worker/inspect/[a-f0-9]+/cdr$"
)


def _normalize_worker_api_path(path: str) -> str:
    """Alinha com APIAccessMiddleware — Nginx expõe /sagra/api/..."""
    norm = (path or "").rstrip("/") or "/"
    if norm == "/sagra/api":
        return "/api"
    if norm.startswith("/sagra/api/"):
        return norm[len("/sagra") :]
    return norm


def worker_secret_configured() -> str:
    return (os.getenv("SAGRA_PAPELARIA_WORKER_SECRET") or "").strip()


def is_papelaria_worker_path(path: str, method: str) -> bool:
    normalized = _normalize_worker_api_path(path)
    if method == "GET" and _WORKER_GET_PATH_RE.match(normalized):
        return True
    if method != "POST":
        return False
    if normalized in _WORKER_PATHS_EXACT:
        return True
    return bool(_WORKER_PATH_RE.match(normalized))


def worker_secret_valid(request: Request) -> bool:
    configured = worker_secret_configured()
    if not configured:
        logger.warning("SAGRA_PAPELARIA_WORKER_SECRET não configurado.")
        return False
    provided = (request.headers.get(_WORKER_HEADER) or "").strip()
    if not provided:
        return False
    return hmac.compare_digest(configured, provided)


def is_papelaria_worker_authorized(request: Request) -> bool:
    path = _normalize_worker_api_path(request.url.path)
    method = request.method.upper()
    if not is_papelaria_worker_path(path, method):
        return False
    return worker_secret_valid(request)


def worker_request_headers() -> dict[str, str]:
    secret = worker_secret_configured()
    if not secret:
        return {}
    return {_WORKER_HEADER: secret}
