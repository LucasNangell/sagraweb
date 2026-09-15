"""API Manipular Imagem — analisa e remove máscaras de PNG/JPG com limiar/intensidade."""
from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
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


def _read_upload(file: UploadFile, content: bytes) -> str:
    filename = file.filename or "imagem.png"
    if len(content) > svc.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Arquivo muito grande (máx. {svc.MAX_UPLOAD_BYTES // (1024 * 1024)} MB).",
        )
    return filename


def _bool_form(value: bool | str | None) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _preview_generation(request: Request) -> int:
    raw = (request.headers.get("X-Sagra-Preview-Gen") or "").strip()
    if not raw:
        return 0
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return 0


@router.post("/analisar")
async def analisar_imagem(
    request: Request,
    file: UploadFile = File(...),
):
    _require_access(request)
    content = await file.read()
    filename = _read_upload(file, content)
    try:
        return await asyncio.to_thread(svc.analisar_mascaras, content, filename)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception:
        logger.exception("Falha ao analisar imagem (%s)", filename)
        raise HTTPException(
            status_code=500,
            detail="Falha ao analisar a imagem.",
        ) from None


@router.post("/processar")
async def processar_imagem(
    request: Request,
    file: UploadFile | None = File(None),
    job_id: str | None = Form(None),
    mascara_idx: int = Form(0),
    intensidade: float = Form(100),
    limiar: float = Form(50),
    preview: str = Form("false"),
):
    _require_access(request)
    is_preview = _bool_form(preview)
    job = (job_id or "").strip() or None
    preview_gen = _preview_generation(request)

    try:
        if job:
            png_bytes, out_name = await asyncio.to_thread(
                svc.aplicar_mascara_job,
                job,
                mascara_idx=mascara_idx,
                intensidade=intensidade,
                limiar=limiar,
                preview=is_preview,
                preview_generation=preview_gen,
            )
        else:
            if file is None:
                raise HTTPException(
                    status_code=400,
                    detail="Informe job_id ou envie o arquivo.",
                )
            content = await file.read()
            filename = _read_upload(file, content)
            png_bytes, out_name = await asyncio.to_thread(
                svc.aplicar_mascara,
                content,
                filename,
                mascara_idx=mascara_idx,
                intensidade=intensidade,
                limiar=limiar,
                preview=is_preview,
            )
    except HTTPException:
        raise
    except svc.PreviewStaleError:
        return Response(status_code=409)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except IndexError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception:
        logger.exception("Falha ao processar imagem (job=%s)", job)
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
