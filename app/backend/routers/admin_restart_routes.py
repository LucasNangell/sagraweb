"""Reinício dos serviços Windows SAGRA (produção) via UI."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from security.api_auth import is_master_client
from security.session_auth import SessionData, require_session
from security.user_permissions import resolve_effective_permissions
from services.system_restart_service import SystemRestartError, read_restart_status, request_system_restart

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-restart"])


def require_system_restart_access(
    request: Request,
    session: SessionData = Depends(require_session),
) -> SessionData:
    """MASTER_IP ou usuário/terminal com sb_reiniciar_sistema."""
    if is_master_client(request):
        return session
    from routers.ip_admin_routes import get_client_permissions

    perms = resolve_effective_permissions(
        request,
        session,
        path="/",
        method="GET",
        get_client_permissions=get_client_permissions,
    )
    if perms and bool(perms.get("sb_reiniciar_sistema")):
        return session
    logger.warning(
        "Reinício sistema negado ponto=%s ip=%s",
        session.ponto,
        session.ip,
    )
    raise HTTPException(
        status_code=403,
        detail="Sem permissão para reiniciar o sistema.",
    )


class SystemRestartRequest(BaseModel):
    reason: str = Field(default="reinicio via UI", max_length=200)


@router.get(
    "/api/admin/system/restart/status",
    dependencies=[Depends(require_system_restart_access)],
)
def get_system_restart_status():
    return read_restart_status()


@router.post(
    "/api/admin/system/restart",
    status_code=202,
)
def post_system_restart(
    request: Request,
    body: SystemRestartRequest | None = None,
    session: SessionData = Depends(require_system_restart_access),
):
    from config_manager import config_manager

    if config_manager.is_development():
        raise HTTPException(
            status_code=501,
            detail="Reinício dos serviços só está disponível no servidor de produção.",
        )

    payload = body or SystemRestartRequest()
    try:
        result = request_system_restart(
            reason=payload.reason or "reinicio via UI",
            requested_by=str(getattr(session, "ponto", "") or ""),
        )
    except SystemRestartError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Falha ao solicitar reinício do sistema")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    logger.warning(
        "POST /api/admin/system/restart aceito id=%s ponto=%s ip=%s",
        result.get("request_id"),
        session.ponto,
        getattr(session, "ip", None),
    )
    return result
