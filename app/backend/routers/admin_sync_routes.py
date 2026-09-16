"""API admin: status, política e controle do sync."""
from __future__ import annotations

import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from routers.admin_system_routes import require_admin_config_access
from security.session_auth import SessionData
from services import sync_admin_service
from services.windows_service_control import (
    ALLOWED_SERVICES,
    ServiceControlError,
    control_windows_service,
)
from services.windows_service_status import build_admin_sync_status

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-sync"])


class PolicyItemUpdate(BaseModel):
    table_name: Literal["tabProtocolos", "tabDetalhesServico", "tabAndamento"]
    enabled: Optional[bool] = None
    mode: Optional[Literal["uni", "bi"]] = None
    delete_policy: Optional[Literal["off", "dryrun", "on"]] = None


class PolicySaveRequest(BaseModel):
    policies: List[PolicyItemUpdate] = Field(default_factory=list)


@router.get(
    "/api/admin/system/sync/status",
    dependencies=[Depends(require_admin_config_access)],
)
def get_sync_admin_status():
    from config_manager import config_manager

    try:
        payload = build_admin_sync_status(
            is_development=config_manager.is_development()
        )
        payload["policies"] = sync_admin_service.get_policies(apply_env=True)
        payload["pending_counts"] = sync_admin_service.pending_counts()
        return payload
    except Exception as e:
        logger.exception("sync status failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/api/admin/system/sync/policy",
    dependencies=[Depends(require_admin_config_access)],
)
def get_sync_policy():
    return {"policies": sync_admin_service.get_policies(apply_env=True)}


@router.put(
    "/api/admin/system/sync/policy",
    dependencies=[Depends(require_admin_config_access)],
)
def put_sync_policy(
    body: PolicySaveRequest,
    session: SessionData = Depends(require_admin_config_access),
):
    updated_by = getattr(session, "ponto", None) or "admin"
    updated = []
    try:
        for item in body.policies:
            row = sync_admin_service.update_policy(
                item.table_name,
                enabled=item.enabled,
                mode=item.mode,
                delete_policy=item.delete_policy,
                updated_by=str(updated_by),
            )
            updated.append(row)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"policies": sync_admin_service.get_policies(apply_env=True), "updated": updated}


@router.get(
    "/api/admin/system/sync/pending-deletes",
    dependencies=[Depends(require_admin_config_access)],
)
def get_pending_deletes(status: Optional[str] = None, limit: int = 100):
    return {
        "items": sync_admin_service.list_pending_deletes(status=status, limit=limit),
        "counts": sync_admin_service.pending_counts(),
    }


@router.post(
    "/api/admin/system/sync/pending-deletes/{nro}/{ano}/approve",
    dependencies=[Depends(require_admin_config_access)],
)
def approve_pending_delete(
    nro: int,
    ano: int,
    session: SessionData = Depends(require_admin_config_access),
):
    try:
        return sync_admin_service.decide_pending_delete(
            nro,
            ano,
            approve=True,
            decided_by=str(getattr(session, "ponto", None) or "admin"),
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post(
    "/api/admin/system/sync/pending-deletes/{nro}/{ano}/reject",
    dependencies=[Depends(require_admin_config_access)],
)
def reject_pending_delete(
    nro: int,
    ano: int,
    session: SessionData = Depends(require_admin_config_access),
):
    try:
        return sync_admin_service.decide_pending_delete(
            nro,
            ano,
            approve=False,
            decided_by=str(getattr(session, "ponto", None) or "admin"),
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post(
    "/api/admin/system/sync/service/{name}/{action}",
    dependencies=[Depends(require_admin_config_access)],
)
def control_sync_service(name: str, action: str):
    if name not in ALLOWED_SERVICES:
        raise HTTPException(status_code=400, detail=f"Serviço não permitido: {name}")
    try:
        return control_windows_service(name, action)
    except ServiceControlError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e)) from e
