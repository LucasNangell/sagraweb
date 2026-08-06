"""Rotas autenticadas e portal público — arquivos na abertura de OS (< 5000)."""
from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, EmailStr

from security.session_auth import SessionData, require_session
from services import os_arquivos_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["os-arquivos"])

_OS_ARQUIVOS_COMPONENT = "Arquivos"


class EnviarEmailArquivosRequest(BaseModel):
    email: EmailStr
    ponto: Optional[str] = None


class ClientUploadSessionRequest(BaseModel):
    os_id: int
    ano: int
    ponto: str
    token: str
    componente: str = _OS_ARQUIVOS_COMPONENT
    files: List[dict]


class ClientUploadCompleteRequest(BaseModel):
    os_id: int
    ano: int
    ponto: str
    token: str
    componente: str = _OS_ARQUIVOS_COMPONENT
    files: List[dict]


@router.post("/os/{ano}/{os_id}/arquivos/enviar-email")
def enviar_email_arquivos_cliente(
    ano: int,
    os_id: int,
    body: EnviarEmailArquivosRequest,
    session: SessionData = Depends(require_session),
):
    if os_id >= 5000:
        raise HTTPException(status_code=400, detail="Fluxo disponível apenas para OS normais (< 5000).")
    from services.gerencia_settings import is_os_arquivos_client_email_enabled

    if not is_os_arquivos_client_email_enabled():
        raise HTTPException(
            status_code=403,
            detail="Envio de e-mail ao cliente está desabilitado nas configurações do sistema.",
        )
    try:
        token = svc.create_or_reuse_token(
            os_id=os_id,
            ano=ano,
            email_cliente=str(body.email),
        )
        svc.send_client_arquivos_email(
            to_email=str(body.email),
            os_id=os_id,
            ano=ano,
            token=token,
        )
        url = svc.build_portal_url(os_id, ano, token)
        return {"status": "ok", "url": url, "message": "E-mail enviado ao cliente."}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Falha ao enviar e-mail de arquivos OS %s/%s", os_id, ano)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/os/{ano}/{os_id}/arquivos/finalizar-interno")
async def finalizar_arquivos_interno(
    ano: int,
    os_id: int,
    session: SessionData = Depends(require_session),
    ponto: str = Form(""),
    files: List[UploadFile] = File(...),
):
    if os_id >= 5000:
        raise HTTPException(status_code=400, detail="Fluxo disponível apenas para OS normais (< 5000).")
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")
    ponto_eff = (ponto or "").strip() or str(session.ponto)
    try:
        result = svc.upload_files_to_original(
            os_id=os_id,
            ano=ano,
            ponto=ponto_eff,
            files=files,
            origem="operador SAGRA",
            register_movement=False,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Falha upload interno arquivos OS %s/%s", os_id, ano)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/gerencia/settings")
def get_gerencia_settings(session: SessionData = Depends(require_session)):
    from services.gerencia_settings import get_public_settings

    return get_public_settings()


@router.get("/client/os-arquivos/{ano}/{os_id}")
def client_os_arquivos_info(
    ano: int,
    os_id: int,
    token: str = Query(...),
):
    try:
        return svc.get_client_portal_payload(os_id, ano, token)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/client/os-arquivos/upload-files")
async def client_os_arquivos_upload_files(
    os_id: int = Form(...),
    ano: int = Form(...),
    ponto: str = Form(...),
    token: str = Form(...),
    files: List[UploadFile] = File(...),
):
    if not files:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")
    try:
        svc.validate_os_arquivos_token(os_id, ano, token)
        return svc.upload_files_to_original(
            os_id=os_id,
            ano=ano,
            ponto=ponto,
            files=files,
            origem="cliente",
            token=token,
        )
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Upload cliente arquivos OS %s/%s", os_id, ano)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/client/os-arquivos/upload-session")
def client_os_arquivos_upload_session(req: ClientUploadSessionRequest):
    try:
        from services.gdrive_portal_upload import (
            create_upload_sessions,
            gdrive_config_ready,
            is_portal_gdrive_upload_enabled,
        )

        if not is_portal_gdrive_upload_enabled() or not gdrive_config_ready():
            raise HTTPException(
                status_code=503,
                detail="Upload via Google Drive não está habilitado neste servidor.",
            )
        svc.validate_os_arquivos_token(req.os_id, req.ano, req.token)
        if not req.files:
            raise HTTPException(status_code=400, detail="Nenhum arquivo informado.")
        uploads = create_upload_sessions(
            req.ano,
            req.os_id,
            req.componente or _OS_ARQUIVOS_COMPONENT,
            req.token,
            req.files,
        )
        return {"status": "success", "uploads": uploads}
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("os-arquivos upload-session: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/client/os-arquivos/upload-complete")
def client_os_arquivos_upload_complete(req: ClientUploadCompleteRequest):
    try:
        from services.gdrive_portal_upload import (
            fetch_and_consume_staging_file,
            gdrive_config_ready,
            get_drive_service,
            get_staging_folder_id,
            is_portal_gdrive_upload_enabled,
        )

        if not is_portal_gdrive_upload_enabled() or not gdrive_config_ready():
            raise HTTPException(
                status_code=503,
                detail="Upload via Google Drive não está habilitado neste servidor.",
            )
        if not req.files:
            raise HTTPException(status_code=400, detail="Nenhum arquivo informado.")

        svc.validate_os_arquivos_token(req.os_id, req.ano, req.token)
        final_dir, folder_name = svc.prepare_original_dir(req.os_id, req.ano)

        service = get_drive_service()
        staging_id = get_staging_folder_id(service)
        saved_files: List[str] = []

        for entry in req.files:
            file_id = str(entry.get("drive_file_id") or entry.get("id") or "").strip()
            original_name = str(entry.get("name") or "arquivo").strip()
            if not file_id:
                raise HTTPException(status_code=400, detail="drive_file_id ausente.")
            safe_name = os.path.basename(original_name)
            dest_path = os.path.join(final_dir, safe_name)
            tmp_path = dest_path + ".uploading"
            try:
                saved_name = fetch_and_consume_staging_file(
                    service,
                    file_id,
                    staging_id,
                    tmp_path,
                    ano=req.ano,
                    os_id=req.os_id,
                    token=req.token,
                    expected_original_name=original_name,
                )
                if os.path.getsize(tmp_path) <= 0:
                    raise ValueError(f"Arquivo vazio: {saved_name}")
                os.replace(tmp_path, dest_path)
                saved_files.append(saved_name)
            except Exception:
                if os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except OSError:
                        pass
                raise

        return svc.finalize_drive_upload(
            os_id=req.os_id,
            ano=req.ano,
            ponto=req.ponto,
            token=req.token,
            saved_files=saved_files,
            folder_name=folder_name,
        )
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("os-arquivos upload-complete: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
