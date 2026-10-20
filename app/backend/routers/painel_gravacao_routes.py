"""API do painel /painel/gravacao."""
from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from security.session_auth import require_session
from security.user_permissions import get_user_permissions_raw, resolve_effective_permissions
from services.os_protocolo_guard import OsProtocoloGuardError, require_protocolo_mysql
from services.painel_gravacao_service import get_painel_gravacao_board, lancar_painel_gravacao

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/painel", tags=["painel-gravacao"])


class PainelGravacaoChapaIn(BaseModel):
    gravacao_externa_id: Optional[int] = None
    maquina: str
    quantidade: int = 0


class PainelGravacaoLancarIn(BaseModel):
    situacao: str
    setor: str
    obs: str = ""
    usuario: str
    column_id: str
    gravacao_externa_ids: List[int] = Field(default_factory=list)
    chapas: List[PainelGravacaoChapaIn] = Field(default_factory=list)


def _effective_has_tablet(request: Request) -> bool:
    session = require_session(request)
    try:
        from routers.ip_admin_routes import get_client_permissions

        perms = resolve_effective_permissions(
            request,
            session,
            get_client_permissions=get_client_permissions,
        )
        if perms and bool(perms.get("sb_dashboard_tablet")):
            return True
    except Exception as exc:
        logger.debug("resolve_effective_permissions falhou: %s", exc)
    raw = get_user_permissions_raw(session.ponto) or {}
    return bool(raw.get("sb_dashboard_tablet"))


def _require_tablet(request: Request) -> None:
    require_session(request)
    if not _effective_has_tablet(request):
        raise HTTPException(
            status_code=403,
            detail="Permissão sb_dashboard_tablet necessária.",
        )


@router.get("/gravacao")
def get_painel_gravacao(request: Request) -> dict[str, Any]:
    _require_tablet(request)
    return get_painel_gravacao_board()


@router.post("/gravacao/{ano}/{id}/lancar")
def post_painel_gravacao_lancar(
    ano: int,
    id: int,
    payload: PainelGravacaoLancarIn,
    request: Request,
) -> dict[str, Any]:
    _require_tablet(request)
    try:
        ano = require_protocolo_mysql(id, ano)
    except OsProtocoloGuardError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return lancar_painel_gravacao(
        ano=ano,
        nr_os=id,
        situacao=payload.situacao,
        setor=payload.setor,
        obs=payload.obs,
        usuario=payload.usuario,
        column_id=payload.column_id,
        gravacao_externa_ids=payload.gravacao_externa_ids,
        chapas=[item.model_dump() for item in payload.chapas],
    )
