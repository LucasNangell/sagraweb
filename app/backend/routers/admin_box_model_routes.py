"""Admin — modelos de caixa (Prova WEB) pré-cadastrados."""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from routers.admin_system_routes import require_admin_config_access
from security.session_auth import SessionData
from services import prova_web_box_model_service as box_models

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-box-models"])


class BoxModelMetaUpdate(BaseModel):
    nome: Optional[str] = Field(None, max_length=120)
    hint: Optional[str] = Field(None, max_length=240)
    ativo: Optional[bool] = None
    ordem: Optional[int] = None
    config: Optional[dict[str, Any]] = None


@router.get("/api/admin/system/prova-web/box-models")
def admin_list_box_models(
    ativo: Optional[bool] = Query(None),
    _session: SessionData = Depends(require_admin_config_access),
):
    ativo_only = bool(ativo) if ativo is not None else False
    return {"models": box_models.list_box_models(ativo_only=ativo_only)}


@router.get("/api/admin/system/prova-web/box-models/{model_id}")
def admin_get_box_model(
    model_id: int,
    _session: SessionData = Depends(require_admin_config_access),
):
    model = box_models.get_box_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    return {"model": model}


@router.get("/api/admin/system/prova-web/box-models/{model_id}/faca.pdf")
def admin_get_box_model_faca(
    model_id: int,
    _session: SessionData = Depends(require_admin_config_access),
):
    model = box_models.get_box_model(model_id, include_pdf=True)
    if not model or not model.get("facaPdf"):
        raise HTTPException(status_code=404, detail="PDF da faca não encontrado.")
    filename = model.get("facaFileName") or f"caixa-modelo-{model_id}.pdf"
    return Response(
        content=model["facaPdf"],
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.post("/api/admin/system/prova-web/box-models/parse-faca")
async def admin_parse_faca(
    arquivo: UploadFile = File(...),
    page: int = Form(0),
    _session: SessionData = Depends(require_admin_config_access),
):
    data = await arquivo.read()
    try:
        config = box_models.parse_faca_to_box_config(data, page_index=page)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("parse-faca falhou")
        raise HTTPException(status_code=500, detail="Falha ao ler a faca.") from exc
    return {
        "config": config,
        "fileName": arquivo.filename or "faca.pdf",
        "panelCount": len(config.get("panels") or []),
        "hingeCount": len(config.get("hinges") or []),
    }


@router.post("/api/admin/system/prova-web/box-models")
async def admin_create_box_model(
    nome: str = Form(...),
    hint: str = Form(""),
    ordem: int = Form(0),
    config_json: str = Form(...),
    arquivo: Optional[UploadFile] = File(None),
    session: SessionData = Depends(require_admin_config_access),
):
    try:
        raw_cfg = json.loads(config_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="config_json inválido.") from exc
    faca_bytes = await arquivo.read() if arquivo else None
    try:
        model = box_models.create_box_model(
            nome=nome,
            hint=hint,
            config=raw_cfg,
            ordem=ordem,
            faca_pdf=faca_bytes or None,
            faca_file_name=(arquivo.filename if arquivo else None),
            updated_by_ponto=session.ponto,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"model": model}


@router.put("/api/admin/system/prova-web/box-models/{model_id}")
async def admin_update_box_model(
    model_id: int,
    body: BoxModelMetaUpdate,
    session: SessionData = Depends(require_admin_config_access),
):
    try:
        model = box_models.update_box_model(
            model_id,
            nome=body.nome,
            hint=body.hint,
            config=body.config,
            ativo=body.ativo,
            ordem=body.ordem,
            updated_by_ponto=session.ponto,
        )
    except ValueError as exc:
        detail = str(exc)
        code = 404 if "não encontrado" in detail.lower() else 400
        raise HTTPException(status_code=code, detail=detail) from exc
    return {"model": model}


@router.post("/api/admin/system/prova-web/box-models/{model_id}/faca")
async def admin_replace_box_model_faca(
    model_id: int,
    arquivo: UploadFile = File(...),
    reparse: bool = Form(True),
    page: int = Form(0),
    session: SessionData = Depends(require_admin_config_access),
):
    data = await arquivo.read()
    config = None
    if reparse:
        try:
            config = box_models.parse_faca_to_box_config(data, page_index=page)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    try:
        model = box_models.update_box_model(
            model_id,
            config=config,
            faca_pdf=data,
            faca_file_name=arquivo.filename,
            updated_by_ponto=session.ponto,
        )
    except ValueError as exc:
        detail = str(exc)
        code = 404 if "não encontrado" in detail.lower() else 400
        raise HTTPException(status_code=code, detail=detail) from exc
    return {"model": model}


@router.delete("/api/admin/system/prova-web/box-models/{model_id}")
def admin_delete_box_model(
    model_id: int,
    _session: SessionData = Depends(require_admin_config_access),
):
    if not box_models.get_box_model(model_id):
        raise HTTPException(status_code=404, detail="Modelo não encontrado.")
    box_models.delete_box_model(model_id)
    return {"ok": True}
