"""
Autenticação Fase B — cookie de sessão HttpOnly assinado (HMAC).
Sem fail-open: ausência ou token inválido → HTTP 403.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException, Request, Response

logger = logging.getLogger(__name__)

SESSION_COOKIE_NAME = "sagra_session"
CLIENTE_SESSION_COOKIE_NAME = "sagra_cliente_session"
SESSION_MAX_AGE_SECONDS = 7 * 24 * 3600


AUTH_MODE_CLIENTE = "cliente"

_DEV_FALLBACK_SECRET = "sagra-dev-session-secret-change-in-production"
_MIN_PRODUCTION_SECRET_LEN = 32


@dataclass(frozen=True)
class SessionData:
    ponto: int
    nome: str
    ip: str
    iat: int
    auth_mode: str = "local"
    cliente_id: int | None = None
    gabinete: str | None = None
    cliente_tipo: str | None = None


def _session_secret() -> bytes:
    from config_manager import config_manager

    raw = (os.getenv("SAGRA_SESSION_SECRET") or "").strip()
    if not raw and config_manager.is_development():
        config_fallback = str(config_manager.get("session_secret") or "").strip()
        if config_fallback:
            raw = config_fallback
            logger.warning(
                "SAGRA_SESSION_SECRET ausente — usando session_secret do config (somente dev)."
            )
        else:
            raw = _DEV_FALLBACK_SECRET
            logger.warning(
                "SAGRA_SESSION_SECRET não definido — usando segredo de desenvolvimento."
            )
    if not raw:
        raise RuntimeError(
            "SAGRA_SESSION_SECRET obrigatório em produção. Defina em config/.env"
        )
    if not config_manager.is_development():
        if raw == _DEV_FALLBACK_SECRET:
            raise RuntimeError(
                "SAGRA_SESSION_SECRET de desenvolvimento não permitido em produção."
            )
        if len(raw) < _MIN_PRODUCTION_SECRET_LEN:
            raise RuntimeError(
                f"SAGRA_SESSION_SECRET deve ter pelo menos {_MIN_PRODUCTION_SECRET_LEN} "
                "caracteres em produção."
            )
    return raw.encode("utf-8")


def _session_cookie_secure() -> bool:
    """Intranet HTTP (:80): SAGRA_SESSION_SECURE=false. HTTPS/produção: true por padrão."""
    flag = os.getenv("SAGRA_SESSION_SECURE", "").strip().lower()
    if flag in ("1", "true", "yes", "on", "sim"):
        return True
    if flag in ("0", "false", "no", "off"):
        return False
    from config_manager import config_manager

    if config_manager.is_development():
        return False
    public_base = str(config_manager.get("public_web_base") or "")
    if public_base.startswith("https://"):
        return True
    return False


def _parse_cookie_value(cookie_header: str | None, name: str) -> Optional[str]:
    if not cookie_header:
        return None
    prefix = f"{name}="
    for part in cookie_header.split(";"):
        part = part.strip()
        if part.startswith(prefix):
            return part[len(prefix) :].strip() or None
    return None


def get_session_from_websocket(websocket) -> Optional[SessionData]:
    """Lê sessão interna a partir do cookie no handshake WebSocket."""
    token = None
    try:
        token = websocket.cookies.get(SESSION_COOKIE_NAME)
    except Exception:
        token = None
    if not token:
        token = _parse_cookie_value(websocket.headers.get("cookie"), SESSION_COOKIE_NAME)
    return load_session_token(token)


def get_websocket_session(websocket) -> Optional[SessionData]:
    """Sessão interna ou portal cliente (cookie sagra_cliente_session)."""
    session = get_session_from_websocket(websocket)
    if session is not None:
        return session
    token = None
    try:
        token = websocket.cookies.get(CLIENTE_SESSION_COOKIE_NAME)
    except Exception:
        token = None
    if not token:
        token = _parse_cookie_value(
            websocket.headers.get("cookie"),
            CLIENTE_SESSION_COOKIE_NAME,
        )
    return load_session_token(token)


def _sign(payload_b64: str) -> str:
    return hmac.new(_session_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()


def create_session_token(data: SessionData) -> str:
    payload = {
        "ponto": data.ponto,
        "nome": data.nome,
        "ip": data.ip,
        "iat": data.iat,
        "auth_mode": data.auth_mode,
    }
    if data.cliente_id is not None:
        payload["cliente_id"] = data.cliente_id
    if data.gabinete:
        payload["gabinete"] = data.gabinete
    if data.cliente_tipo:
        payload["cliente_tipo"] = data.cliente_tipo
    payload_b64 = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    signature = _sign(payload_b64)
    return f"{payload_b64}.{signature}"


def load_session_token(token: Optional[str]) -> Optional[SessionData]:
    if not token or "." not in token:
        return None
    payload_b64, _, signature = token.partition(".")
    if not payload_b64 or not signature:
        return None
    if not hmac.compare_digest(_sign(payload_b64), signature):
        return None
    try:
        raw: dict[str, Any] = json.loads(
            base64.urlsafe_b64decode(payload_b64.encode("ascii"))
        )
        iat = int(raw.get("iat", 0))
        if iat <= 0 or (time.time() - iat) > SESSION_MAX_AGE_SECONDS:
            return None
        cliente_raw = raw.get("cliente_id")
        cliente_id = int(cliente_raw) if cliente_raw is not None else None
        gabinete_raw = raw.get("gabinete")
        gabinete = str(gabinete_raw).strip() if gabinete_raw else None
        tipo_raw = raw.get("cliente_tipo")
        cliente_tipo = str(tipo_raw).strip() if tipo_raw else None
        return SessionData(
            ponto=int(raw.get("ponto") or 0),
            nome=str(raw.get("nome") or ""),
            ip=str(raw.get("ip") or ""),
            iat=iat,
            auth_mode=str(raw.get("auth_mode") or "local"),
            cliente_id=cliente_id,
            gabinete=gabinete,
            cliente_tipo=cliente_tipo,
        )
    except Exception:
        return None


def get_session_from_request(request: Request) -> Optional[SessionData]:
    return load_session_token(request.cookies.get(SESSION_COOKIE_NAME))


def get_cliente_session_from_request(request: Request) -> Optional[SessionData]:
    return load_session_token(request.cookies.get(CLIENTE_SESSION_COOKIE_NAME))


def require_session(request: Request) -> SessionData:
    """Dependência FastAPI — 403 se sessão ausente ou inválida."""
    session = get_session_from_request(request)
    if session is None:
        raise HTTPException(
            status_code=403,
            detail="Sessão ausente ou inválida. Autentique-se em POST /api/auth/session.",
        )
    return session


def is_cliente_session(session: Optional[SessionData]) -> bool:
    return (
        session is not None
        and session.auth_mode == AUTH_MODE_CLIENTE
        and session.cliente_id is not None
    )


def require_cliente_session(request: Request) -> SessionData:
    session = get_cliente_session_from_request(request)
    if not is_cliente_session(session):
        raise HTTPException(
            status_code=403,
            detail="Sessão de cliente ausente ou inválida.",
        )
    return session


def set_cliente_session_cookie(response: Response, session: SessionData) -> None:
    token = create_session_token(session)
    secure = _session_cookie_secure()
    response.set_cookie(
        key=CLIENTE_SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_cliente_session_cookie(response: Response) -> None:
    response.delete_cookie(key=CLIENTE_SESSION_COOKIE_NAME, path="/")


def set_session_cookie(response: Response, session: SessionData) -> None:
    from config_manager import config_manager

    token = create_session_token(session)
    secure = _session_cookie_secure()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")
