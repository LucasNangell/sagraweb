"""PDF do separador de cadernos (102 x 297 mm)."""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from security.session_auth import SessionData, require_session
from services.separador_cadernos_service import lookup_gravacao_caderno_until
from services.separador_pdf_service import CAD_MAX, CAD_MIN, build_separador_pdf

logger = logging.getLogger(__name__)

router = APIRouter(tags=["separador"])

_OS_LABEL_RE = re.compile(r"^\d{1,6}/\d{2,4}$")


class SeparadorPdfRequest(BaseModel):
    os_label: str = Field(..., min_length=3, max_length=16)
    until: int = Field(..., ge=CAD_MIN, le=CAD_MAX)
    titulo: str = Field("", max_length=240)
    solicitante: str = Field("", max_length=240)
    produto: str = Field("", max_length=120)


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


@router.get("/reports/separador-cadernos/{ano}/{nr_os}")
def get_separador_cadernos(
    ano: int,
    nr_os: int,
    request: Request,
    _session: SessionData = Depends(require_session),
):
    if not _perms(request).get("ctx_imprimir_separador"):
        raise HTTPException(status_code=403, detail="Permissao de impressao de separador necessaria.")
    if ano < 1 or nr_os < 1:
        raise HTTPException(status_code=400, detail="OS invalida.")
    try:
        until = lookup_gravacao_caderno_until(ano, nr_os)
    except Exception:
        logger.exception("Erro ao consultar cadernos da gravacao")
        until = None
    return {"until": until}


@router.post("/reports/separador.pdf")
def create_separador_pdf(
    body: SeparadorPdfRequest,
    request: Request,
    _session: SessionData = Depends(require_session),
):
    if not _perms(request).get("ctx_imprimir_separador"):
        raise HTTPException(status_code=403, detail="Permissao de impressao de separador necessaria.")
    os_label = body.os_label.strip()
    if not _OS_LABEL_RE.match(os_label):
        raise HTTPException(status_code=400, detail="OS invalida.")
    try:
        pdf_bytes = build_separador_pdf(
            os_label=os_label,
            until=body.until,
            titulo=body.titulo,
            solicitante=body.solicitante,
            produto=body.produto,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao gerar PDF do separador")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    filename = f"separador-{os_label.replace('/', '-')}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
