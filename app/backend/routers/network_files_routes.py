"""Rotas de navegação de arquivos na rede."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request

from services.network_files_service import browse_network_folder

router = APIRouter()


def _has_gravacao_access(request: Request) -> bool:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    return bool(perms.get("sb_gravacao_externa") or perms.get("sb_gravacao_pendente"))


@router.get("/files/network-browse")
def get_network_browse(
    request: Request,
    relative: Optional[str] = Query(None),
):
    if not _has_gravacao_access(request):
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Permissão necessária.")
    return browse_network_folder(relative or "")
