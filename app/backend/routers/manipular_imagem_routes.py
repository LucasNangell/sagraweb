"""API Manipular Imagem — remove máscara 0 de PNG/JPG enviados pelo usuário."""
from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import Response

from services import manipular_imagem_service as svc

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/manipular-imagem", tags=["manipular-imagem"])


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _require_access(request: Request) -> None:
    if not _perms(request).get("sb_manipular_imagem"):
        raise HTTPException(
            status_code=403,
            detail="Sem permissão para Manipular Imagem",
        )


@router.post("/processar")
async def processar_imagem(
    request: Request,
    file: UploadFile = File(...),
):
    _require_access(request)

    filename = file.filename or "imagem.png"
    content = await file.read()
    if len(content) > svc.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Arquivo muito grande (máx. {svc.MAX_UPLOAD_BYTES // (1024 * 1024)} MB).",
        )

    try:
        png_bytes, out_name = svc.remover_mascara_0(content, filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except IndexError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception:
        logger.exception("Falha ao processar imagem (%s)", filename)
        raise HTTPException(
            status_code=500,
            detail="Falha ao processar a imagem.",
        ) from None

    disposition = f"attachment; filename*=UTF-8''{quote(out_name)}"
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": disposition},
    )
