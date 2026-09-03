"""Endpoint do Gantt de Fluxo de Produção."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from services.os_fluxo_producao_service import build_fluxo_producao

router = APIRouter(tags=["Fluxo de Produção"])


@router.get("/os/{ano}/{id}/fluxo-producao")
def get_os_fluxo_producao(ano: int, id: int, response: Response):
    try:
        payload = build_fluxo_producao(ano, id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    response.headers["Cache-Control"] = "private, max-age=8"
    response.headers["X-Sagra-Cache"] = "miss"
    return payload
