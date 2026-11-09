"""
Comparador de versões PDF da pasta da OS.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from services import pdf_version_compare_service as compare_svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["pdf-compare"])


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _require_abrir_pasta(request: Request) -> None:
    if not _perms(request).get("ctx_abrir_pasta"):
        raise HTTPException(
            status_code=403, detail="Permissão Abrir pasta necessária."
        )


class PdfCompareStartRequest(BaseModel):
    previous_relative: str = Field(..., min_length=1)
    current_relative: str = Field(..., min_length=1)
    dpi: int = 150
    threshold: int = 16
    include_unchanged: bool = False


class PdfCompareStartResponse(BaseModel):
    session_id: str
    message: str = "Comparação iniciada."


def _resolve_pdf(ano: int, os_id: int, relative: str) -> tuple[str, str]:
    from routers.os_routes import (
        _normalize_os_relative_path,
        _resolve_os_relative_path,
        _resolve_os_root_path,
    )

    rel = _normalize_os_relative_path(relative)
    if not rel:
        raise HTTPException(status_code=400, detail="Caminho inválido.")
    if not rel.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Somente arquivos PDF.")

    os_root = _resolve_os_root_path(ano, os_id)
    if not os_root:
        raise HTTPException(
            status_code=404, detail="Pasta da OS não encontrada na rede."
        )
    target = _resolve_os_relative_path(os_root, rel)
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="PDF não encontrado.")
    return rel, target


def _get_owned_job(ano: int, os_id: int, session_id: str) -> compare_svc.SessionJob:
    job = compare_svc.get_job(session_id)
    if not job or job.ano != ano or job.os_id != os_id:
        raise HTTPException(status_code=404, detail="Sessão não encontrada.")
    return job


@router.post(
    "/os/{ano}/{id}/pdf-compare/start",
    response_model=PdfCompareStartResponse,
)
def start_pdf_compare(
    ano: int,
    id: int,
    body: PdfCompareStartRequest,
    request: Request,
):
    _require_abrir_pasta(request)
    prev_rel, prev_path = _resolve_pdf(ano, id, body.previous_relative)
    curr_rel, curr_path = _resolve_pdf(ano, id, body.current_relative)
    if os.path.normcase(os.path.abspath(prev_path)) == os.path.normcase(
        os.path.abspath(curr_path)
    ):
        raise HTTPException(
            status_code=400, detail="Selecione dois PDFs diferentes."
        )

    options = compare_svc.PdfCompareOptions(
        dpi=body.dpi,
        threshold=body.threshold,
        include_unchanged_in_report=body.include_unchanged,
    )
    options.sanitize()
    job = compare_svc.start_compare_job(
        ano=ano,
        os_id=id,
        previous_pdf=prev_path,
        current_pdf=curr_path,
        previous_relative=prev_rel,
        current_relative=curr_rel,
        options=options,
    )
    return PdfCompareStartResponse(session_id=job.session_id)


@router.get("/os/{ano}/{id}/pdf-compare/{session_id}/progress")
def pdf_compare_progress(ano: int, id: int, session_id: str, request: Request):
    _require_abrir_pasta(request)
    job = _get_owned_job(ano, id, session_id)
    with job.lock:
        return {
            "sessionId": job.session_id,
            "stage": job.stage,
            "current": job.current,
            "total": job.total,
            "message": job.message,
            "pct": job.pct,
            "done": job.done,
            "cancelled": job.cancelled,
            "error": job.error,
        }


@router.get("/os/{ano}/{id}/pdf-compare/{session_id}")
def pdf_compare_session(ano: int, id: int, session_id: str, request: Request):
    _require_abrir_pasta(request)
    job = _get_owned_job(ano, id, session_id)
    with job.lock:
        if not job.done:
            return {
                "sessionId": job.session_id,
                "hasResult": False,
                "busy": True,
                "stage": job.stage,
                "pct": job.pct,
                "message": job.message,
            }
        if job.cancelled:
            raise HTTPException(status_code=409, detail="Comparação cancelada.")
        if job.error:
            raise HTTPException(status_code=500, detail=job.error)
        if not job.result:
            raise HTTPException(status_code=404, detail="Resultado indisponível.")
        asset_base = f"/api/os/{ano}/{id}/pdf-compare/{session_id}/asset"
        payload = compare_svc.result_to_api_dict(
            job.result, asset_base=asset_base
        )
        payload["busy"] = False
        return payload


@router.get("/os/{ano}/{id}/pdf-compare/{session_id}/asset/{name}")
def pdf_compare_asset(
    ano: int, id: int, session_id: str, name: str, request: Request
):
    _require_abrir_pasta(request)
    job = _get_owned_job(ano, id, session_id)
    try:
        path = compare_svc.resolve_asset_path(job, name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Asset não encontrado.") from exc
    media = "image/jpeg" if name.lower().endswith((".jpg", ".jpeg")) else "application/octet-stream"
    return FileResponse(str(path), media_type=media, content_disposition_type="inline")


@router.post("/os/{ano}/{id}/pdf-compare/{session_id}/cancel")
def pdf_compare_cancel(ano: int, id: int, session_id: str, request: Request):
    _require_abrir_pasta(request)
    _get_owned_job(ano, id, session_id)
    compare_svc.cancel_job(session_id)
    return {"ok": True}


class PdfCompareReportRequest(BaseModel):
    include_unchanged: Optional[bool] = None


@router.post("/os/{ano}/{id}/pdf-compare/{session_id}/report")
def pdf_compare_report(
    ano: int,
    id: int,
    session_id: str,
    request: Request,
    body: Optional[PdfCompareReportRequest] = None,
):
    _require_abrir_pasta(request)
    job = _get_owned_job(ano, id, session_id)
    with job.lock:
        if not job.done or not job.result:
            raise HTTPException(
                status_code=409, detail="Comparação ainda não concluída."
            )
        result = job.result

    include = (
        body.include_unchanged
        if body and body.include_unchanged is not None
        else result.include_unchanged_in_report
    )
    dest = job.session_dir / "report.pdf"
    try:
        compare_svc.build_report_pdf(
            result,
            dest,
            include_unchanged=bool(include),
            should_cancel=job.cancel_event.is_set,
            job=job,
        )
    except compare_svc.OperationCanceledError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Falha ao gerar relatório %s", session_id)
        raise HTTPException(
            status_code=500, detail=f"Falha ao gerar relatório: {exc}"
        ) from exc

    return FileResponse(
        str(dest),
        media_type="application/pdf",
        filename=f"comparacao-{ano}-{id}-{session_id[:8]}.pdf",
        content_disposition_type="attachment",
    )
