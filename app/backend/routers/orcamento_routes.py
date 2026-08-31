"""
Orçamento gráfico — cálculo a partir da OS, recálculo e PDF do ofício.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

from security.session_auth import SessionData, require_session
from services import orcamento_os_service as os_svc
from services.orcamento_pdf_service import build_orcamento_pdf

logger = logging.getLogger(__name__)

router = APIRouter(tags=["orcamento"])


def _perms(request: Request) -> dict:
    return getattr(request.state, "sagra_permissions", None) or {}


def _require_orcamento(request: Request) -> None:
    if not _perms(request).get("ctx_orcamento"):
        raise HTTPException(status_code=403, detail="Permissão de Orçamento necessária.")


def _ponto(request: Request) -> Optional[str]:
    session = getattr(request.state, "sagra_session", None)
    ponto = getattr(session, "ponto", None)
    return str(ponto) if ponto is not None else None


class ComponenteOrcamento(BaseModel):
    nome: str = "Componente"
    tipo: str = "UNICO"
    menor_mm: float = 0
    maior_mm: float = 0
    paginas: int = 1
    cor: bool = True
    frente_verso: bool = True
    verso_cor: bool = False
    impressao: Optional[str] = None
    papel_codigo: Optional[str] = None
    papel_nome_os: Optional[str] = None
    laminacao: bool = False
    laminacao_fv: bool = False
    espiral: bool = False
    grampo: bool = False
    cola: bool = False
    capa_pvc: bool = False
    espiral_codigo: Optional[str] = None
    verniz: float = 0
    faca_cliche: float = 0


class OsMeta(BaseModel):
    nro_protocolo: Optional[int] = None
    ano_protocolo: Optional[int] = None
    titulo: str = ""
    solicitante: str = ""
    processo: str = ""
    data_entrada: str = ""
    produto: str = ""
    formato_os: str = ""
    maquina: str = ""
    papel_os: str = ""
    cores_os: str = ""
    acabamento_os: str = ""
    formato_sugerido: Optional[str] = None


class CalcularOrcamentoRequest(BaseModel):
    os: OsMeta = Field(default_factory=OsMeta)
    tiragem: int = Field(..., ge=1)
    tecnologia: str = "auto"
    componentes: list[ComponenteOrcamento] = Field(default_factory=list)
    observacoes: str = ""


@router.get("/orcamento/os/{ano}/{os_id}")
def get_orcamento_os(
    ano: int,
    os_id: int,
    request: Request,
    _session: SessionData = Depends(require_session),
):
    _require_orcamento(request)
    try:
        return os_svc.orcamento_da_os(ano, os_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="OS não encontrada.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao montar orçamento da OS %s/%s", os_id, ano)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/orcamento/calcular")
def post_orcamento_calcular(
    body: CalcularOrcamentoRequest,
    request: Request,
    _session: SessionData = Depends(require_session),
):
    _require_orcamento(request)
    try:
        return os_svc.calcular_payload(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao recalcular orçamento")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/orcamento/pdf")
def post_orcamento_pdf(
    body: CalcularOrcamentoRequest,
    request: Request,
    _session: SessionData = Depends(require_session),
):
    _require_orcamento(request)
    try:
        saved = os_svc.persistir_orcamento(body.model_dump(), ponto=_ponto(request))
        record = os_svc.get_orcamento(saved["id"])
        pdf_bytes = build_orcamento_pdf(record)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao gerar PDF de orçamento")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    filename = f"Orcamento_{saved['numero']}_{saved['ano']}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/reports/orcamento/{orcamento_id}.pdf")
def get_orcamento_pdf(
    orcamento_id: int,
    request: Request,
    _session: SessionData = Depends(require_session),
):
    _require_orcamento(request)
    try:
        record = os_svc.get_orcamento(orcamento_id)
        pdf_bytes = build_orcamento_pdf(record)
    except KeyError:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.") from None
    except Exception as exc:
        logger.exception("Erro ao baixar PDF de orçamento %s", orcamento_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    filename = f"Orcamento_{record['numero']}_{record['ano']}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
