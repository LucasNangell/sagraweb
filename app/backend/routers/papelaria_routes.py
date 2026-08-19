from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import logging
import os
import json

from database import db
from security.api_auth import is_master_client
from security.session_auth import SessionData, require_session
from security.user_permissions import resolve_effective_permissions

router = APIRouter(prefix="/papelaria")
logger = logging.getLogger(__name__)


class PapelariaPayload(BaseModel):
    id_produto: str
    dados: Dict[str, Any]


class PapelariaSvgRenderPayload(BaseModel):
    codigo_modelo: str = Field(..., min_length=1)
    dados: Dict[str, Any] = Field(default_factory=dict)
    ano: Optional[int] = None
    nro: Optional[int] = None


class PapelariaCreateJobPayload(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    nro: int = Field(..., ge=1)
    modelo_id: int = Field(..., ge=1)
    dados: Dict[str, Any] = Field(default_factory=dict)
    lancar_andamento: bool = False


class PapelariaFinalizeCorelPayload(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    nro: int = Field(..., ge=1)
    modelo_id: int = Field(..., ge=1)
    dados: Dict[str, Any] = Field(default_factory=dict)


class PapelariaExportExistingCdrPayload(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    nro: int = Field(..., ge=1)
    modelo_id: int = Field(..., ge=1)
    dados: Dict[str, Any] = Field(default_factory=dict)
    lancar_andamento: bool = False
    arquivo_cdr: Optional[str] = Field(None, max_length=255)


class PapelariaOsActionPayload(BaseModel):
    lancar_andamento: bool = False


class PapelariaMockupConfigPayload(BaseModel):
    mockup_config_json: Optional[Any] = None


class PapelariaMockupValidatePayload(BaseModel):
    mockup_config_json: Optional[Any] = None


class PapelariaPreviewConfigPayload(BaseModel):
    preview_config_json: Optional[Any] = None


class PapelariaPreviewValidatePayload(BaseModel):
    preview_config_json: Optional[Any] = None


class PapelariaNomeExibicaoPayload(BaseModel):
    nome_exibicao: Optional[str] = Field(None, max_length=255)


def _require_papelaria_access(
    request: Request,
    session: SessionData = Depends(require_session),
) -> SessionData:
    if is_master_client(request):
        return session
    from routers.ip_admin_routes import get_client_permissions

    perms = resolve_effective_permissions(
        request,
        session,
        path="/papelaria",
        method="GET",
        get_client_permissions=get_client_permissions,
    )
    if perms and bool(perms.get("sb_papelaria")):
        return session
    raise HTTPException(status_code=403, detail="Sem permissão para acessar Papelaria.")


def _require_import_access(
    request: Request,
    session: SessionData = Depends(require_session),
) -> SessionData:
    if is_master_client(request):
        return session
    from routers.ip_admin_routes import get_client_permissions

    perms = resolve_effective_permissions(
        request,
        session,
        path="/admin/configuracoes",
        method="GET",
        get_client_permissions=get_client_permissions,
    )
    if perms and (bool(perms.get("sb_configuracoes")) or bool(perms.get("sb_admin_ips"))):
        return session
    raise HTTPException(
        status_code=403,
        detail="Sem permissão para importar modelos de papelaria.",
    )


# --- Modelos Corel (sem COM no servidor) ---


@router.get("/modelos")
def listar_modelos_corel(
    produto: Optional[str] = Query(None),
    cores: Optional[str] = Query(None),
    frente_verso: Optional[str] = Query(None),
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.list_modelos(
            produto=produto,
            cores=cores,
            frente_verso=frente_verso,
        )
    except Exception as e:
        logger.exception("Erro ao listar modelos Corel: %s", e)
        raise HTTPException(500, "Erro ao listar modelos de papelaria.")


@router.post("/modelos/importar-planilha")
def importar_modelos_planilha(
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.importar_planilha()
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Erro importação planilha papelaria: %s", e)
        raise HTTPException(500, "Erro ao importar planilha de modelos.")


@router.get("/os/{ano}/{nro}/contexto")
def obter_contexto_os(
    ano: int,
    nro: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.build_os_context(ano, nro)
    except LookupError:
        raise HTTPException(404, "OS não encontrada.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro contexto papelaria OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao carregar contexto da OS.")


@router.get("/admin/modelos")
def listar_modelos_admin(
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.list_modelos_admin()
    except Exception as e:
        logger.exception("Erro ao listar modelos admin papelaria: %s", e)
        raise HTTPException(500, "Erro ao listar modelos de papelaria.")


@router.get("/admin/modelos/{modelo_id}")
def obter_modelo_admin(
    modelo_id: int,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_admin_by_id(modelo_id)
        if not modelo:
            raise HTTPException(404, "Modelo não encontrado.")
        return modelo
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao obter modelo admin %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao carregar modelo.")


@router.put("/admin/modelos/{modelo_id}/nome-exibicao")
def salvar_nome_exibicao_modelo(
    modelo_id: int,
    payload: PapelariaNomeExibicaoPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.update_modelo_nome_exibicao(
            modelo_id,
            payload.nome_exibicao,
        )
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.exception("Erro ao salvar nome exibição modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao salvar nome de exibição.")


@router.delete("/admin/modelos/{modelo_id}")
@router.post("/admin/modelos/{modelo_id}/delete")
def excluir_modelo_admin(
    modelo_id: int,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        models_svc.delete_modelo_admin(modelo_id)
        return {"success": True}
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except Exception as e:
        logger.exception("Erro ao excluir modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao excluir modelo.")


@router.put("/admin/modelos/{modelo_id}/mockup-config")
def salvar_mockup_config_modelo(
    modelo_id: int,
    payload: PapelariaMockupConfigPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.update_modelo_mockup_config(
            modelo_id,
            payload.mockup_config_json,
        )
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.exception("Erro ao salvar mockup config modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao salvar configuração de mockup.")


@router.post("/admin/modelos/mockup-config/validate")
def validar_mockup_config_modelo(
    payload: PapelariaMockupValidatePayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.validate_modelo_mockup_config(payload.mockup_config_json)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao validar mockup config: %s", e)
        raise HTTPException(500, "Erro ao validar configuração de mockup.")


@router.put("/admin/modelos/{modelo_id}/preview-config")
def salvar_preview_config_modelo(
    modelo_id: int,
    payload: PapelariaPreviewConfigPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.update_modelo_preview_config(
            modelo_id,
            payload.preview_config_json,
        )
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.exception("Erro ao salvar preview config modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao salvar configuração de prévia.")


@router.post("/admin/modelos/preview-config/validate")
def validar_preview_config_modelo(
    payload: PapelariaPreviewValidatePayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.validate_modelo_preview_config(payload.preview_config_json)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao validar preview config: %s", e)
        raise HTTPException(500, "Erro ao validar configuração de prévia.")


@router.get("/admin/modelos/preview-config/example")
def exemplo_preview_config_modelo(
    _session: SessionData = Depends(_require_import_access),
):
    from services import papelaria_live_preview_service as preview_svc

    return preview_svc.example_preview_config()


@router.get("/admin/produtos")
def listar_produtos_admin_papelaria(
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_modelo_admin_service as admin_svc

        return {"produtos": admin_svc.list_produtos_distintos()}
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except Exception as e:
        logger.exception("Erro ao listar produtos admin papelaria: %s", e)
        raise HTTPException(500, "Erro ao listar produtos.")


@router.post("/admin/modelos/inspecionar-cdr")
async def inspecionar_cdr_admin(
    file: UploadFile = File(...),
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_cdr_inspect_service as inspect_svc

        content = await file.read()
        filename = file.filename or "modelo.cdr"
        return inspect_svc.create_inspect_request(content, filename)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao enfileirar inspeção de .cdr: %s", e)
        raise HTTPException(500, "Erro ao analisar arquivo .cdr.")


@router.get("/admin/modelos/inspecionar-cdr/{inspect_id}")
def obter_inspecao_cdr_admin(
    inspect_id: str,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_cdr_inspect_service as inspect_svc

        inspect = inspect_svc.get_inspect_request(inspect_id)
        if not inspect:
            raise HTTPException(404, "Inspeção não encontrada.")
        return inspect
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao consultar inspeção %s: %s", inspect_id, e)
        raise HTTPException(500, "Erro ao consultar inspeção de .cdr.")


@router.post("/admin/modelos/criar-de-cdr")
async def criar_modelo_de_cdr(
    produto: str = Form(...),
    frente_verso: str = Form(""),
    cores: str = Form(""),
    nome_exibicao: str = Form(""),
    inspect_id: str = Form(""),
    mockup_config_json: str = Form(""),
    preview_config_json: str = Form(""),
    file: UploadFile = File(...),
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_modelo_admin_service as admin_svc

        content = await file.read()
        filename = file.filename or "modelo.cdr"
        mockup_raw = mockup_config_json.strip() or None
        preview_raw = preview_config_json.strip() or None
        mockup_parsed = json.loads(mockup_raw) if mockup_raw else None
        preview_parsed = json.loads(preview_raw) if preview_raw else None

        return admin_svc.create_modelo_from_cdr(
            produto=produto,
            frente_verso=frente_verso,
            cores=cores,
            nome_exibicao=nome_exibicao.strip() or None,
            inspect_id=inspect_id.strip() or None,
            filename=filename,
            content=content,
            mockup_config_json=mockup_parsed,
            preview_config_json=preview_parsed,
        )
    except PermissionError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except json.JSONDecodeError:
        raise HTTPException(400, "JSON de mockup ou prévia inválido.")
    except OSError as e:
        logger.exception("Erro de I/O ao criar modelo via CDR: %s", e)
        raise HTTPException(503, f"Não foi possível gravar o arquivo .cdr: {e}")
    except Exception as e:
        logger.exception("Erro ao criar modelo via CDR: %s", e)
        raise HTTPException(500, "Erro ao criar modelo a partir do .cdr.")


@router.post("/admin/modelos/{modelo_id}/preview-base/{face_id}")
async def upload_preview_base_face(
    modelo_id: int,
    face_id: str,
    file: UploadFile = File(...),
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_live_preview_service as preview_svc
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_admin_by_id(modelo_id)
        if not modelo:
            raise HTTPException(404, "Modelo não encontrado.")

        content = await file.read()
        filename = file.filename or f"{face_id}_base.png"
        result = preview_svc.save_preview_base_upload(
            modelo_id,
            face_id,
            filename=filename,
            content=content,
        )
        return {"ok": True, **result}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(
            "Erro upload preview-base modelo %s face %s: %s", modelo_id, face_id, e
        )
        raise HTTPException(500, "Erro ao enviar imagem base.")


@router.get("/modelos/{modelo_id}/preview-base/{face_id}")
def servir_preview_base_face(
    modelo_id: int,
    face_id: str,
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_live_preview_service as preview_svc
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_by_id(modelo_id)
        if not modelo:
            raise HTTPException(404, "Modelo não encontrado.")

        preview_config = None
        raw = modelo.get("preview_config_json")
        if raw:
            preview_config = preview_svc.parse_preview_config_json(raw)

        path = preview_svc.resolve_face_base_image_path(
            modelo_id,
            face_id,
            preview_config=preview_config,
        )
        ext = path.lower().rsplit(".", 1)[-1]
        media = "image/png" if ext == "png" else "image/jpeg"
        return FileResponse(path=path, media_type=media)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro preview-base modelo %s face %s: %s", modelo_id, face_id, e)
        raise HTTPException(500, "Erro ao servir imagem base.")


@router.get("/modelos/{modelo_id}")
def obter_modelo_corel(
    modelo_id: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_models_service as models_svc

        modelo = models_svc.get_modelo_with_preview(modelo_id)
        if not modelo:
            raise HTTPException(404, "Modelo não encontrado.")
        return modelo
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao obter modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao carregar modelo.")


@router.post("/preview")
def generate_preview_disabled(
    payload: PapelariaPayload,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Preview via Corel no servidor desativado — geração na fase do worker Windows."""
    raise HTTPException(
        status_code=503,
        detail=(
            "Pré-visualização PDF via CorelDRAW não está disponível no servidor. "
            "A geração será feita pelo worker Windows em fase posterior."
        ),
    )


# --- Fila de jobs Corel (sem geração no servidor) ---


@router.post("/jobs")
def criar_job_papelaria(
    payload: PapelariaCreateJobPayload,
    session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        if payload.lancar_andamento:
            jobs_svc.register_preparando_prova_andamento(
                payload.ano, payload.nro, str(session.ponto)
            )

        return jobs_svc.create_job(
            ano=payload.ano,
            nro=payload.nro,
            modelo_id=payload.modelo_id,
            dados=payload.dados,
            solicitado_por=str(session.ponto),
        )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao criar job papelaria: %s", e)
        raise HTTPException(500, "Erro ao criar solicitação de geração.")


@router.get("/os/{ano}/{nro}/jobs")
def listar_jobs_os(
    ano: int,
    nro: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    if nro < 5000:
        from services import papelaria_models_service as models_svc
        if not models_svc.is_papelaria_os_by_product(ano, nro):
            raise HTTPException(
                status_code=400,
                detail="Histórico de jobs disponível apenas para OS >= 5000 ou com produto de papelaria configurado.",
            )
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.list_jobs_for_os(ano, nro)
    except Exception as e:
        logger.exception("Erro listar jobs OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao listar jobs da OS.")


@router.get("/os/{ano}/{nro}/cdr-path")
def obter_caminho_cdr_os(
    ano: int,
    nro: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    if nro < 5000:
        from services import papelaria_models_service as models_svc
        if not models_svc.is_papelaria_os_by_product(ano, nro):
            raise HTTPException(status_code=400, detail="Disponível apenas para OS >= 5000 ou com produto de papelaria configurado.")
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.list_os_cdr_path_payload(ano, nro)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Erro ao resolver CDR OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao localizar arquivo Corel.")


@router.post("/os/{ano}/{nro}/abrir-corel")
def abrir_corel_os(
    ano: int,
    nro: int,
    payload: PapelariaOsActionPayload,
    session: SessionData = Depends(_require_papelaria_access),
):
    if nro < 5000:
        from services import papelaria_models_service as models_svc
        if not models_svc.is_papelaria_os_by_product(ano, nro):
            raise HTTPException(status_code=400, detail="Disponível apenas para OS >= 5000 ou com produto de papelaria configurado.")
    try:
        from services import papelaria_jobs_service as jobs_svc

        if payload.lancar_andamento:
            jobs_svc.register_preparando_prova_andamento(ano, nro, str(session.ponto))
        path = jobs_svc.resolve_os_cdr_absolute_path(ano, nro)
        return {"path": path, "filename": os.path.basename(path)}
    except LookupError as e:
        raise HTTPException(404, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro abrir Corel OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao preparar abertura do Corel.")


@router.post("/os/{ano}/{nro}/finalizar-corel")
def finalizar_corel_os(
    ano: int,
    nro: int,
    payload: PapelariaFinalizeCorelPayload,
    session: SessionData = Depends(_require_papelaria_access),
):
    if nro < 5000:
        from services import papelaria_models_service as models_svc
        if not models_svc.is_papelaria_os_by_product(ano, nro):
            raise HTTPException(status_code=400, detail="Disponível apenas para OS >= 5000 ou com produto de papelaria configurado.")
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.finalize_manual_corel_job(
            ano=payload.ano,
            nro=payload.nro,
            modelo_id=payload.modelo_id,
            dados=payload.dados,
            solicitado_por=str(session.ponto),
        )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro finalizar Corel OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao finalizar edição no Corel.")


@router.post("/os/{ano}/{nro}/gerar-prova-cdr-existente")
def gerar_prova_cdr_existente_os(
    ano: int,
    nro: int,
    payload: PapelariaExportExistingCdrPayload,
    session: SessionData = Depends(_require_papelaria_access),
):
    if nro < 5000:
        from services import papelaria_models_service as models_svc
        if not models_svc.is_papelaria_os_by_product(ano, nro):
            raise HTTPException(
                status_code=400,
                detail="Disponível apenas para OS >= 5000 ou com produto de papelaria configurado.",
            )
    try:
        from services import papelaria_jobs_service as jobs_svc

        if payload.lancar_andamento:
            jobs_svc.register_preparando_prova_andamento(ano, nro, str(session.ponto))

        return jobs_svc.create_export_existing_cdr_job(
            ano=payload.ano,
            nro=payload.nro,
            modelo_id=payload.modelo_id,
            dados=payload.dados,
            solicitado_por=str(session.ponto),
            arquivo_cdr=payload.arquivo_cdr,
        )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro gerar prova CDR existente OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao solicitar exportação de prova do Corel existente.")


@router.get("/jobs/{job_id}")
def obter_job_papelaria(
    job_id: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        job = jobs_svc.get_job(job_id, include_logs=True)
        if not job:
            raise HTTPException(404, "Job não encontrado.")
        return job
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao obter job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao consultar job.")


@router.post("/jobs/{job_id}/cancel")
def cancelar_job_papelaria(
    job_id: int,
    session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.cancel_job(job_id, str(session.ponto))
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao cancelar job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao cancelar job.")


@router.post("/jobs/{job_id}/aprovar-prova")
def aprovar_prova_job_papelaria(
    job_id: int,
    session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.approve_job_prova(job_id, str(session.ponto))
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao aprovar prova job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao aprovar prova gerada.")


@router.post("/jobs/{job_id}/descartar-prova")
def descartar_prova_job_papelaria(
    job_id: int,
    session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.discard_job_prova(job_id, str(session.ponto))
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao descartar prova job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao descartar prova gerada.")


@router.get("/jobs/{job_id}/preview-pages")
def listar_preview_pages_job(
    job_id: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_preview_service as preview_svc

        from config_manager import config_manager

        api_prefix = f"{config_manager.get_api_path_prefix()}/papelaria"
        return preview_svc.build_preview_pages_payload(job_id, api_prefix=api_prefix)
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro preview-pages job %s: %s", job_id, e)
        raise HTTPException(
            500,
            "Não foi possível gerar a prévia 3D a partir do PDF.",
        )


@router.get("/jobs/{job_id}/preview-pages/{page}.png")
def servir_preview_page_job(
    job_id: int,
    page: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    if page < 1:
        raise HTTPException(400, "Página inválida.")
    try:
        from services import papelaria_preview_service as preview_svc

        path = preview_svc.resolve_preview_page_path(job_id, page)
        return FileResponse(path=path, media_type="image/png")
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro PNG preview job %s p%s: %s", job_id, page, e)
        raise HTTPException(500, "Erro ao obter imagem de prévia.")


@router.get("/jobs/{job_id}/arquivo/{tipo}")
def baixar_arquivo_job(
    job_id: int,
    tipo: str,
    _session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        path, filename = jobs_svc.resolve_job_file_path(job_id, tipo)
        tipo_l = tipo.lower()
        if tipo_l == "pdf":
            return FileResponse(
                path=path,
                media_type="application/pdf",
                filename=filename,
                content_disposition_type="inline",
            )
        return FileResponse(
            path=path,
            media_type="application/octet-stream",
            filename=filename,
            content_disposition_type="attachment",
        )
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Erro download job %s tipo %s: %s", job_id, tipo, e)
        raise HTTPException(500, "Erro ao obter arquivo do job.")


# --- Cartão de visita (modelos SVG em Modelos/) ---


@router.get("/svg/modelos")
def get_svg_modelos():
    try:
        from services import papelaria_svg_service as svg_svc

        return svg_svc.list_svg_models()
    except Exception as e:
        logger.exception("Erro ao listar modelos SVG: %s", e)
        raise HTTPException(500, "Erro ao listar modelos SVG.")


@router.get("/svg/modelos/{codigo}/campos")
def get_svg_modelo_campos(codigo: str):
    try:
        from services import papelaria_svg_service as svg_svc

        return svg_svc.get_model_fields(codigo)
    except Exception as e:
        logger.exception("Erro campos modelo SVG %s: %s", codigo, e)
        raise HTTPException(500, "Erro ao carregar campos do modelo.")


@router.get("/svg/icones")
def get_svg_icones():
    try:
        from services import papelaria_svg_service as svg_svc

        return svg_svc.list_icons()
    except Exception as e:
        logger.exception("Erro ao listar ícones SVG: %s", e)
        raise HTTPException(500, "Erro ao listar ícones.")


@router.get("/svg/prefill")
def get_svg_prefill(
    ano: int = Query(..., ge=2000, le=2100),
    nro: int = Query(..., ge=1),
):
    try:
        from services import papelaria_svg_service as svg_svc

        return svg_svc.build_prefill_from_os(ano, nro)
    except Exception as e:
        logger.exception("Erro prefill SVG OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao carregar dados da OS.")


@router.post("/svg/render")
def render_svg_modelo(payload: PapelariaSvgRenderPayload):
    try:
        from services import papelaria_svg_service as svg_svc

        return svg_svc.render_svg(payload.codigo_modelo, payload.dados)
    except FileNotFoundError:
        raise HTTPException(404, f"Modelo SVG '{payload.codigo_modelo}' não encontrado.")
    except Exception as e:
        logger.exception("Erro render SVG %s: %s", payload.codigo_modelo, e)
        raise HTTPException(500, "Erro ao gerar arte SVG.")


@router.post("/svg/export")
def export_svg_modelo(payload: PapelariaSvgRenderPayload):
    try:
        from services import papelaria_svg_service as svg_svc

        rendered = svg_svc.render_svg(payload.codigo_modelo, payload.dados)
        filename = f"{payload.codigo_modelo}.svg"
        return Response(
            content=rendered["svg"],
            media_type="image/svg+xml",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except FileNotFoundError:
        raise HTTPException(404, f"Modelo SVG '{payload.codigo_modelo}' não encontrado.")
    except Exception as e:
        logger.exception("Erro export SVG %s: %s", payload.codigo_modelo, e)
        raise HTTPException(500, "Erro ao exportar SVG.")
