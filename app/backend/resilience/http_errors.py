"""Respostas HTTP amigáveis — stack trace só no log interno."""
from __future__ import annotations

import logging
from typing import NoReturn

from fastapi import HTTPException

logger = logging.getLogger(__name__)

GENERIC_INTERNAL = "Erro interno do servidor. Tente novamente."
GENERIC_BUSY = "Servidor ocupado. Tente novamente em instantes."
GENERIC_DB = "Falha temporária no banco de dados. Tente novamente."


def log_internal_error(context: str, exc: BaseException, **extra) -> None:
    """Registra erro completo para diagnóstico (sem expor ao cliente)."""
    parts = " ".join(f"{k}={v}" for k, v in extra.items() if v is not None)
    logger.exception("Erro interno [%s]%s", context, f" ({parts})" if parts else "")


def internal_server_error(context: str, exc: BaseException, **extra) -> NoReturn:
    log_internal_error(context, exc, **extra)
    raise HTTPException(status_code=500, detail=GENERIC_INTERNAL) from exc


def service_unavailable(context: str, exc: BaseException | None = None, **extra) -> NoReturn:
    if exc is not None:
        log_internal_error(context, exc, **extra)
    else:
        logger.warning("Serviço indisponível [%s]%s", context, extra or "")
    raise HTTPException(
        status_code=503,
        detail=GENERIC_BUSY,
        headers={"Retry-After": "5"},
    )


def ews_http_exception(exc: Exception) -> HTTPException:
    """Mapeia falhas EWS para resposta segura ao cliente."""
    from services.ews_service import EWSUnavailableError

    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, EWSUnavailableError):
        return HTTPException(status_code=503, detail=str(exc))
    log_internal_error("ews", exc)
    msg = str(exc)
    if "401" in msg or "Unauthorized" in msg:
        return HTTPException(
            status_code=401,
            detail="Falha ao autenticar no Exchange com a credencial do servidor.",
        )
    return HTTPException(
        status_code=503,
        detail="Exchange indisponível. Tente novamente em instantes.",
    )
