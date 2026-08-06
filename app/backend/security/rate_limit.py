"""Rate limiting em memória (sem Redis) para rotas sensíveis."""
from __future__ import annotations

import logging
import os
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque, Dict, Tuple

from starlette.requests import Request
from starlette.responses import JSONResponse

from security.api_auth import resolve_client_ip

logger = logging.getLogger(__name__)

# (method, path) -> (max_requests, window_seconds)
_RATE_RULES: dict[tuple[str, str], tuple[int, int]] = {
    ("POST", "/api/auth/login"): (10, 900),
    ("POST", "/api/auth/session"): (20, 900),
    ("POST", "/api/auth/forgot-password"): (5, 3600),
    ("POST", "/api/auth/reset-password"): (10, 3600),
    ("POST", "/api/auth/activate"): (10, 3600),
    ("GET", "/api/auth/activate/check"): (30, 900),
    ("GET", "/api/auth/reset-password/check"): (30, 900),
    ("POST", "/api/auth/cliente/login"): (10, 900),
    ("POST", "/api/auth/cliente/activate"): (10, 3600),
    ("GET", "/api/auth/cliente/activate/check"): (30, 900),
    ("POST", "/api/users/identify"): (20, 900),
}

_store: Dict[str, Deque[float]] = defaultdict(deque)
_lock = Lock()


def is_rate_limit_enabled() -> bool:
    raw = os.getenv("SAGRA_RATE_LIMIT_ENABLED", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _normalize_path(path: str) -> str:
    return path.rstrip("/") or "/"


def _rate_key(request: Request, method: str, path: str) -> str:
    ip = resolve_client_ip(request)
    return f"{method}:{path}:{ip}"


def check_rate_limit(request: Request) -> JSONResponse | None:
    """Retorna 429 se exceder limite; None se permitido."""
    if not is_rate_limit_enabled():
        return None

    method = request.method.upper()
    path = _normalize_path(request.url.path)
    rule = _RATE_RULES.get((method, path))
    if rule is None:
        return None

    max_requests, window_seconds = rule
    key = _rate_key(request, method, path)
    now = time.monotonic()
    cutoff = now - window_seconds

    with _lock:
        bucket = _store[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= max_requests:
            logger.warning("Rate limit: %s %s ip=%s", method, path, resolve_client_ip(request))
            return JSONResponse(
                status_code=429,
                content={"detail": "Muitas tentativas. Tente novamente mais tarde."},
                headers={"Retry-After": str(window_seconds)},
            )
        bucket.append(now)

    return None
