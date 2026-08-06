"""
Configuração pública para bootstrap do frontend React.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from config_manager import config_manager
from schemas.config import PublicConfigResponse
from security.cloudflare_access import is_trusted_public_host

router = APIRouter(tags=["config"])


@router.get(
    "/api/config/public",
    response_model=PublicConfigResponse,
    summary="Flags de runtime para o frontend",
)
async def get_public_config(request: Request) -> PublicConfigResponse:
    auth_mode = "password" if is_trusted_public_host(request) else "ponto"
    return PublicConfigResponse(
        apiBase=config_manager.get_api_base(),
        wsPath=config_manager.get_api_ws_path(),
        mysqlOnly=config_manager.is_mysql_only(),
        syncEnabled=config_manager.is_sync_andamentos_enabled(),
        env=str(config_manager.get("env", "production")),
        authMode=auth_mode,
    )
