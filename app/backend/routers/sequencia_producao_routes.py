from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from services.sequencia_producao_models import (
    SequenciaDocxRequest,
    SequenciaDocxResponse,
    SequenciaResponse,
    SequenciaSaveRequest,
)
from services.sequencia_producao_service import (
    DOCX_MEDIA_TYPE,
    create_sequencia_docx,
    get_sequencia_docx_path,
    get_sequencia_producao,
    save_sequencia_producao,
)

router = APIRouter(tags=["Sequência de Produção"])


def _request_ponto(request: Request) -> str | None:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        for key in ("ponto", "Ponto", "nr_ponto", "id"):
            value = user.get(key)
            if value:
                return str(value)
    return None


@router.get("/os/{ano}/{id}/sequencia-producao", response_model=SequenciaResponse)
def get_os_sequencia_producao(ano: int, id: int, regenerate: bool = False):
    try:
        return get_sequencia_producao(ano, id, regenerate=regenerate)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put("/os/{ano}/{id}/sequencia-producao", response_model=SequenciaResponse)
def put_os_sequencia_producao(ano: int, id: int, payload: SequenciaSaveRequest, request: Request):
    try:
        return save_sequencia_producao(ano, id, payload.draft, ponto=_request_ponto(request))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/os/{ano}/{id}/sequencia-producao/docx", response_model=SequenciaDocxResponse)
def post_os_sequencia_producao_docx(ano: int, id: int, payload: SequenciaDocxRequest, request: Request):
    try:
        path, _ = create_sequencia_docx(
            ano,
            id,
            payload.draft,
            ponto=_request_ponto(request),
            overwrite=payload.overwrite,
        )
        return SequenciaDocxResponse(
            filename=path.name,
            path=str(path),
            download_url=f"/os/{ano}/{id}/sequencia-producao/docx",
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/os/{ano}/{id}/sequencia-producao/docx")
def download_os_sequencia_producao_docx(ano: int, id: int):
    try:
        path = get_sequencia_docx_path(ano, id)
        return FileResponse(
            path,
            media_type=DOCX_MEDIA_TYPE,
            filename=path.name,
            content_disposition_type="attachment",
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
