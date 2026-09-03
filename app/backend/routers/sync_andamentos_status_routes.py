"""Status do serviço Windows SAGRA-SyncAndamentos (SCM)."""
from __future__ import annotations

from fastapi import APIRouter

from services.windows_service_status import build_sync_andamentos_service_status

router = APIRouter(tags=["sync-andamentos"])


@router.get("/sync-andamentos/service-status")
def get_sync_andamentos_service_status():
    from config_manager import config_manager

    return build_sync_andamentos_service_status(
        is_development=config_manager.is_development(),
    )
