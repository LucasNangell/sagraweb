"""Admin — reconciliação e diagnóstico da materializada da lista home."""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from routers.admin_system_routes import require_admin_config_access
from security.session_auth import SessionData
from services.os_materialized_reconcile_service import (
    diagnostics,
    find_materialized_gaps,
    reconcile_gaps,
    reconcile_os,
    run_reconcile_cycle,
)
from services.os_ultimo_andamento_service import rebuild_os_ultimo_andamento_operacional

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-os-materialized"])


class ReconcileRequest(BaseModel):
    lookback_minutes: Optional[int] = Field(None, ge=5, le=1440)
    max_rows: Optional[int] = Field(None, ge=1, le=5000)
    setor: Optional[str] = None


class ReconcileOsResponse(BaseModel):
    nro: int
    ano: int
    reconciled: bool
    situacao: Optional[str] = None
    setor: Optional[str] = None
    error: Optional[str] = None


@router.get("/admin/os/materialized/diagnostics")
def get_materialized_diagnostics(
    _session: SessionData = Depends(require_admin_config_access),
    setor: Optional[str] = Query(None),
    sample: int = Query(20, ge=1, le=200),
):
    return diagnostics(setor=setor, sample=sample)


@router.post("/admin/os/materialized/reconcile")
def post_materialized_reconcile(
    body: ReconcileRequest,
    _session: SessionData = Depends(require_admin_config_access),
):
    return run_reconcile_cycle(
        lookback_minutes=body.lookback_minutes,
        max_rows=body.max_rows,
        setor=body.setor,
    )


@router.post("/admin/os/materialized/reconcile/{ano}/{nro}")
def post_materialized_reconcile_one(
    ano: int,
    nro: int,
    _session: SessionData = Depends(require_admin_config_access),
):
    if nro <= 0 or ano <= 0:
        raise HTTPException(status_code=400, detail="nro/ano inválidos")
    result = reconcile_os(nro, ano, source="admin_manual", notify=True)
    return ReconcileOsResponse(
        nro=nro,
        ano=ano,
        reconciled=bool(result.get("reconciled")),
        situacao=result.get("situacao"),
        setor=result.get("setor"),
        error=result.get("error"),
    )


@router.post("/admin/os/materialized/rebuild")
def post_materialized_rebuild(
    _session: SessionData = Depends(require_admin_config_access),
):
    """Backfill completo (emergência) — pode demorar em bases grandes."""
    logger.warning("Admin solicitou rebuild completo da materializada")
    return rebuild_os_ultimo_andamento_operacional()


@router.get("/admin/os/materialized/gaps")
def get_materialized_gaps(
    _session: SessionData = Depends(require_admin_config_access),
    setor: Optional[str] = Query(None),
    lookback_minutes: int = Query(30, ge=5, le=1440),
    max_rows: int = Query(100, ge=1, le=500),
) -> List[dict]:
    return find_materialized_gaps(
        lookback_minutes=lookback_minutes,
        max_rows=max_rows,
        setor=setor,
    )


@router.post("/admin/os/materialized/gaps/fix")
def post_fix_materialized_gaps(
    _session: SessionData = Depends(require_admin_config_access),
    setor: Optional[str] = Query(None),
    lookback_minutes: int = Query(30, ge=5, le=1440),
    max_rows: int = Query(100, ge=1, le=500),
):
    gaps = find_materialized_gaps(
        lookback_minutes=lookback_minutes,
        max_rows=max_rows,
        setor=setor,
    )
    return reconcile_gaps(gaps, source="admin_gap_fix")
