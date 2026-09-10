"""Rotas de navegação, preview e inspeção de arquivos na rede."""
from __future__ import annotations

from typing import Any, Optional
from urllib.parse import quote

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from security.file_access import resolve_network_file_path
from security.session_auth import require_session
from services.gravacao_externa_service import get_or_build_preview_png
from services.network_file_preview_service import (
    inspect_network_file,
    is_pdf_file,
    is_tif_file,
    validate_network_file_batch,
)
from services.network_files_service import browse_network_folder
from services.tif_graphics_learning_service import public_inspection, save_feedback
from services.network_file_preview_service import inspection_token

router = APIRouter()


class GraphicsFeedbackBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    absolute_path: str = Field(min_length=1, max_length=2048)
    maquina: str = Field(min_length=1, max_length=128)
    blank_graphics: StrictBool
    inspection_token: str = Field(pattern=r"^[a-f0-9]{64}$")
    feedback_revision: int = Field(ge=0, strict=True)


def _has_gravacao_access(request: Request) -> bool:
    perms = getattr(request.state, "sagra_permissions", None) or {}
    return bool(perms.get("sb_gravacao_externa") or perms.get("sb_gravacao_pendente"))


def _inline_content_disposition(filename: str) -> str:
    safe = filename.replace("\r", "").replace("\n", "").replace('"', "'")
    encoded = quote(safe)
    return f'inline; filename="{safe}"; filename*=UTF-8\'\'{encoded}'


def _basename_from_any_path(value: str) -> str:
    return value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]


@router.get("/files/network-browse")
def get_network_browse(
    request: Request,
    relative: Optional[str] = Query(None),
):
    if not _has_gravacao_access(request):
        raise HTTPException(status_code=403, detail="Permissão necessária.")
    return browse_network_folder(relative or "")


@router.post("/files/network-inspect")
def inspect_network_files(
    request: Request,
    payload: dict[str, Any] = Body(...),
):
    if not _has_gravacao_access(request):
        raise HTTPException(status_code=403, detail="Permissão necessária.")

    files = validate_network_file_batch(payload.get("files") or [])
    result: list[dict[str, Any]] = []
    for file in files:
        try:
            resolved = resolve_network_file_path(file.absolute_path)
            inspected = inspect_network_file(resolved, file.nome, file.maquina)
        except (HTTPException, OSError):
            # Um arquivo removido/inacessível não interrompe os demais do lote.
            inspected = {
                "nome": file.nome, "maquina": file.maquina.strip().upper(),
                "type": "tif" if is_tif_file(file.nome) else "other",
                "status": "error", "graphics_status": "error", "blank_graphics": None,
                "preview_mime": None, "reason": "Arquivo indisponível, alterado ou acesso não permitido.",
            }
        inspected["absolute_path"] = file.absolute_path
        result.append(public_inspection(inspected))
    return {"files": result}


@router.post("/files/network-graphics-feedback")
def correct_network_graphics(request: Request, payload: GraphicsFeedbackBody):
    if not _has_gravacao_access(request):
        raise HTTPException(403, "Permissão necessária.")
    session = require_session(request)
    resolved = resolve_network_file_path(payload.absolute_path)
    nome = _basename_from_any_path(resolved)
    if not is_tif_file(nome):
        raise HTTPException(415, "A correção de grafismo é exclusiva para TIFFs.")
    if inspection_token(resolved) != payload.inspection_token:
        raise HTTPException(409, "Arquivo alterado após a inspeção. Atualize a lista.")
    analysis = inspect_network_file(resolved, nome, payload.maquina)
    if analysis.get("inspection_token") != payload.inspection_token:
        raise HTTPException(409, "Arquivo alterado durante a inspeção. Atualize a lista.")
    result = save_feedback(analysis, resolved, payload.maquina, payload.blank_graphics,
                           str(session.ponto), payload.feedback_revision)
    result["absolute_path"] = payload.absolute_path
    return public_inspection(result)


@router.post("/files/network-preview")
def preview_network_file(
    request: Request,
    payload: dict[str, Any] = Body(...),
):
    if not _has_gravacao_access(request):
        raise HTTPException(status_code=403, detail="Permissão necessária.")

    absolute_path = str(payload.get("absolute_path") or "").strip()
    nome = str(payload.get("nome") or "").strip()
    if not absolute_path:
        raise HTTPException(status_code=400, detail="Arquivo inválido.")

    resolved = resolve_network_file_path(absolute_path)
    display_name = _basename_from_any_path(nome or resolved)

    if is_pdf_file(display_name, resolved):
        return FileResponse(
            resolved,
            media_type="application/pdf",
            filename=display_name,
            headers={"Content-Disposition": _inline_content_disposition(display_name)},
        )
    if is_tif_file(display_name, resolved):
        png = get_or_build_preview_png(resolved, filename=display_name)
        return Response(content=png, media_type="image/png")

    raise HTTPException(status_code=415, detail="Tipo de arquivo não suportado para preview.")
