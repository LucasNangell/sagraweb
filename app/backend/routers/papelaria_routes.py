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
    # Corel já na pasta da SP: True = manter os textos dele (não aplicar campos).
    manter_dados_corel: bool = False
    # Exceção: gerar o arquivo CorelDRAW pelo worker (em vez da Prova PDF).
    gerar_corel: bool = False


class PapelariaCompararCorelPayload(BaseModel):
    modelo_id: int = Field(..., ge=1)
    dados: Dict[str, Any] = Field(default_factory=dict)


class PapelariaIniciarComparacaoPayload(BaseModel):
    modelo_id: Optional[int] = Field(None, ge=1)


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


class PapelariaImposicaoJuntadaOs(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    nro: int = Field(..., ge=1)


class PapelariaImposicaoPayload(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    nro: int = Field(..., ge=1)
    arquivo_cdr: Optional[str] = Field(None, max_length=255)
    modelo_id: Optional[int] = Field(None, ge=1)
    variante: Optional[str] = Field(None, max_length=16)
    imposicao_config: Optional[Any] = None
    juntada_os: Optional[list[PapelariaImposicaoJuntadaOs]] = None


class PapelariaProdutoImposicaoPayload(BaseModel):
    produto: str = Field(..., min_length=1, max_length=120)
    variante: str = Field(..., min_length=1, max_length=16)
    imposicao_config_json: Optional[Any] = None
    pasta_imposicao: Optional[str] = Field(None, max_length=512)


class PapelariaOsActionPayload(BaseModel):
    lancar_andamento: bool = False


class PapelariaSpStatusItem(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    nro: int = Field(..., ge=1)


class PapelariaSpStatusResumoPayload(BaseModel):
    items: list[PapelariaSpStatusItem] = Field(default_factory=list)


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


class PapelariaPastaImposicaoPayload(BaseModel):
    pasta_imposicao: Optional[str] = Field(None, max_length=512)


class PapelariaImposicaoConfigPayload(BaseModel):
    imposicao_config_json: Optional[Any] = None


class PapelariaImposicaoConfigValidatePayload(BaseModel):
    imposicao_config_json: Optional[Any] = None


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
        from services.papelaria_prova_modo import filtrar_modelos_para_modo

        modelos = models_svc.list_modelos(
            produto=produto,
            cores=cores,
            frente_verso=frente_verso,
        )
        visiveis, _avisos = filtrar_modelos_para_modo(modelos)
        return visiveis
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

        from services import papelaria_prova_pdf_service as prova_pdf_svc

        modelos = models_svc.list_modelos_admin()
        for m in modelos:
            m["tem_prova_pdf"] = prova_pdf_svc.tem_modelo_pdf(m.get("id"))
        return modelos
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


@router.put("/admin/modelos/{modelo_id}/pasta-imposicao")
def salvar_pasta_imposicao_modelo(
    modelo_id: int,
    payload: PapelariaPastaImposicaoPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.update_modelo_pasta_imposicao(
            modelo_id,
            payload.pasta_imposicao,
        )
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.exception("Erro ao salvar pasta imposição modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao salvar pasta de imposição.")


@router.post("/admin/modelos/{modelo_id}/prova-email-template")
async def upload_prova_email_template(
    modelo_id: int,
    file: UploadFile = File(...),
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        content = await file.read()
        return models_svc.save_prova_email_template_upload(
            modelo_id,
            filename=file.filename or "template.pdf",
            content=content,
        )
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.exception(
            "Erro upload template prova e-mail modelo %s: %s", modelo_id, e
        )
        raise HTTPException(500, "Erro ao salvar PDF padrão de prova.")


class PapelariaProvaPdfCamposPayload(BaseModel):
    campos: list[Dict[str, Any]] = Field(default_factory=list)
    limpar: bool = False


class PapelariaProvaPdfPreviaPayload(BaseModel):
    dados: Dict[str, Any] = Field(default_factory=dict)
    # Frente e verso independentes: {"frente": {"modelo_id", "pagina"}, "verso": {...}}
    composicao: Optional[Dict[str, Any]] = None


class PapelariaModeloPadraoPayload(BaseModel):
    face: str
    padrao: bool = True


def _modelo_existe(modelo_id: int) -> None:
    from services import papelaria_models_service as models_svc

    if not models_svc.get_modelo_by_id(int(modelo_id)):
        raise HTTPException(404, "Modelo não encontrado.")


@router.get("/admin/modelos/{modelo_id}/prova-pdf")
def obter_prova_pdf_modelo(
    modelo_id: int,
    _session: SessionData = Depends(_require_import_access),
):
    """Modo Prova PDF: PDF do modelo, textos encontrados e campos ligados."""
    _modelo_existe(modelo_id)
    from services import papelaria_prova_pdf_service as svc

    try:
        return svc.obter_modelo_pdf(modelo_id)
    except Exception as e:
        logger.exception("Erro ao ler Prova PDF do modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao ler o PDF do modelo.")


@router.post("/admin/modelos/{modelo_id}/prova-pdf")
async def enviar_prova_pdf_modelo(
    modelo_id: int,
    file: UploadFile = File(...),
    _session: SessionData = Depends(_require_import_access),
):
    _modelo_existe(modelo_id)
    from services import papelaria_prova_pdf_service as svc

    try:
        content = await file.read()
        return svc.salvar_pdf_modelo(
            modelo_id, filename=file.filename or "modelo.pdf", content=content
        )
    except svc.ProvaPdfError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao salvar Prova PDF do modelo %s: %s", modelo_id, e)
        raise HTTPException(400, f"Não foi possível ler o PDF: {e}")


@router.put("/admin/modelos/{modelo_id}/prova-pdf/campos")
def salvar_campos_prova_pdf_modelo(
    modelo_id: int,
    payload: PapelariaProvaPdfCamposPayload,
    _session: SessionData = Depends(_require_import_access),
):
    _modelo_existe(modelo_id)
    from services import papelaria_prova_pdf_service as svc

    try:
        return svc.salvar_campos(
            modelo_id, payload.campos, limpar=bool(payload.limpar)
        )
    except svc.ProvaPdfError as e:
        raise HTTPException(400, str(e))


@router.post("/admin/modelos/{modelo_id}/prova-pdf/previa")
def previa_prova_pdf_modelo(
    modelo_id: int,
    payload: PapelariaProvaPdfPreviaPayload,
    _session: SessionData = Depends(_require_import_access),
):
    _modelo_existe(modelo_id)
    from services import papelaria_prova_pdf_service as svc

    try:
        return svc.previa_png(modelo_id, payload.dados)
    except svc.ProvaPdfError as e:
        raise HTTPException(400, str(e))


@router.delete("/admin/modelos/{modelo_id}/prova-pdf")
def remover_prova_pdf_modelo(
    modelo_id: int,
    _session: SessionData = Depends(_require_import_access),
):
    _modelo_existe(modelo_id)
    from services import papelaria_prova_pdf_service as svc

    return svc.remover_modelo_pdf(modelo_id)


@router.delete("/admin/modelos/{modelo_id}/prova-email-template")
def remover_prova_email_template(
    modelo_id: int,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.clear_prova_email_template(modelo_id)
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.exception(
            "Erro ao remover template prova e-mail modelo %s: %s", modelo_id, e
        )
        raise HTTPException(500, "Erro ao remover PDF padrão de prova.")


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


class PapelariaProdutoMockupPayload(BaseModel):
    produto: str
    variante: str
    mockup_config_json: Optional[Any] = None


@router.get("/admin/produtos/mockup")
def obter_mockup_produto(
    produto: str = Query(...),
    _session: SessionData = Depends(_require_import_access),
):
    """Mockup 3D do produto: variações «frente» e «frente_verso»."""
    from services import papelaria_produto_mockup_service as svc

    return svc.obter(produto)


@router.put("/admin/produtos/mockup")
def salvar_mockup_produto(
    payload: PapelariaProdutoMockupPayload,
    _session: SessionData = Depends(_require_import_access),
):
    """Grava o mockup da variação do produto (vazio remove e volta ao automático)."""
    from services import papelaria_produto_mockup_service as svc

    try:
        return svc.salvar(payload.produto, payload.variante, payload.mockup_config_json)
    except ValueError as e:
        raise HTTPException(400, str(e))


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


@router.put("/admin/modelos/{modelo_id}/imposicao-config")
def salvar_imposicao_config_modelo(
    modelo_id: int,
    payload: PapelariaImposicaoConfigPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.update_modelo_imposicao_config(
            modelo_id,
            payload.imposicao_config_json,
        )
    except LookupError:
        raise HTTPException(404, "Modelo não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception as e:
        logger.exception("Erro ao salvar imposicao config modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao salvar configuração de imposição.")


@router.post("/admin/modelos/imposicao-config/validate")
def validar_imposicao_config_modelo(
    payload: PapelariaImposicaoConfigValidatePayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_models_service as models_svc

        return models_svc.validate_modelo_imposicao_config(payload.imposicao_config_json)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao validar imposicao config: %s", e)
        raise HTTPException(500, "Erro ao validar configuração de imposição.")


@router.get("/admin/produtos/{produto}/imposicao-configs")
def listar_imposicao_configs_produto(
    produto: str,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from urllib.parse import unquote

        from services import papelaria_produto_imposicao_service as prod_imp_svc

        nome = unquote(produto)
        return {
            "produto": nome,
            "configs": prod_imp_svc.list_produto_imposicao_configs(nome),
            "mapa": prod_imp_svc.get_produto_imposicao_map(nome),
        }
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao listar imposicao produto: %s", e)
        raise HTTPException(500, "Erro ao listar configurações de imposição do produto.")


@router.put("/admin/produtos/imposicao-config")
def salvar_imposicao_config_produto(
    payload: PapelariaProdutoImposicaoPayload,
    _session: SessionData = Depends(_require_import_access),
):
    try:
        from services import papelaria_produto_imposicao_service as prod_imp_svc

        if payload.imposicao_config_json is None:
            return prod_imp_svc.delete_produto_imposicao_config(
                produto=payload.produto,
                variante=payload.variante,
            )
        return prod_imp_svc.upsert_produto_imposicao_config(
            produto=payload.produto,
            variante=payload.variante,
            imposicao_config_json=payload.imposicao_config_json,
            pasta_imposicao=payload.pasta_imposicao,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao salvar imposicao produto: %s", e)
        raise HTTPException(500, "Erro ao salvar configuração de imposição do produto.")


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


@router.post("/admin/modelos/criar-de-pdf")
async def criar_modelo_de_pdf(
    produto: str = Form(...),
    frente_verso: str = Form("Frente"),
    cores: str = Form(""),
    nome_exibicao: str = Form(""),
    file: UploadFile = File(...),
    _session: SessionData = Depends(_require_import_access),
):
    """Nova frente ou novo verso só com o PDF (sem .cdr)."""
    from services import papelaria_modelo_admin_service as admin_svc
    from services import papelaria_prova_pdf_service as pdf_svc

    try:
        content = await file.read()
        if len(content) > pdf_svc.MAX_PDF_BYTES:
            raise ValueError("PDF maior que 30 MB.")
        return admin_svc.create_modelo_from_pdf(
            produto=produto,
            frente_verso=frente_verso,
            cores=cores,
            nome_exibicao=nome_exibicao.strip() or None,
            filename=file.filename or "modelo.pdf",
            content=content,
        )
    except (ValueError, pdf_svc.ProvaPdfError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao criar modelo via PDF: %s", e)
        raise HTTPException(500, "Erro ao criar o modelo a partir do PDF.")


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
        from services import papelaria_prova_pdf_service as prova_pdf_svc

        # Com PDF do modelo configurado, a prévia ao vivo usa o próprio PDF.
        modelo["tem_prova_pdf"] = prova_pdf_svc.tem_modelo_pdf(modelo_id)
        return modelo
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao obter modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao carregar modelo.")


@router.get("/modelos/{modelo_id}/faces")
def faces_do_modelo(
    modelo_id: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Frentes e versos que podem ser combinados no recorte (produto + cores) do modelo."""
    from services import papelaria_faces_service as faces_svc

    try:
        return faces_svc.fontes_para_modelo(modelo_id)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Erro ao listar faces do modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao listar frentes e versos.")


@router.put("/admin/modelos/{modelo_id}/padrao")
def definir_modelo_padrao(
    modelo_id: int,
    payload: PapelariaModeloPadraoPayload,
    _session: SessionData = Depends(_require_import_access),
):
    """Marca o modelo como frente/verso padrão do produto + cores (desmarca os demais)."""
    from services import papelaria_faces_service as faces_svc

    try:
        return faces_svc.definir_padrao(modelo_id, payload.face, bool(payload.padrao))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except faces_svc.ComposicaoError as e:
        raise HTTPException(400, str(e))


@router.delete("/admin/modelos/{modelo_id}/faces/{face}")
def remover_face_modelo(
    modelo_id: int,
    face: str,
    _session: SessionData = Depends(_require_import_access),
):
    """Remove a frente ou o verso (exclui o modelo quando não sobra outra face)."""
    from services import papelaria_faces_service as faces_svc

    try:
        return faces_svc.remover_face(modelo_id, face)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except faces_svc.ComposicaoError as e:
        raise HTTPException(400, str(e))


@router.post("/modelos/{modelo_id}/previa-pdf")
def previa_pdf_ao_vivo(
    modelo_id: int,
    payload: PapelariaProvaPdfPreviaPayload,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """
    Prévia ao vivo da página Papelaria: o PDF do modelo com os valores do
    formulário, renderizado exatamente como a prova final (sem salvar nada).
    """
    from services import papelaria_models_service as models_svc
    from services import papelaria_prova_pdf_service as svc

    modelo = models_svc.get_modelo_by_id(int(modelo_id))
    if not modelo:
        raise HTTPException(404, "Modelo não encontrado.")
    from services.papelaria_faces_service import ComposicaoError, validar_composicao

    dados = {
        k: v for k, v in (payload.dados or {}).items() if not str(k).startswith("__")
    }
    try:
        composicao = validar_composicao(payload.composicao, modelo) if payload.composicao else None
        return svc.previa_png(modelo_id, dados, dpi=110, modelo=modelo, composicao=composicao)
    except (svc.ProvaPdfError, ComposicaoError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro na prévia PDF do modelo %s: %s", modelo_id, e)
        raise HTTPException(500, "Erro ao gerar a prévia do modelo.")


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


def _sp_activity(targets, lane: str, label: str, session: SessionData):
    """Marca SP(s) como «processando» para todos os usuários (lista de SPs)."""
    from services.papelaria_sp_activity import sp_activity

    return sp_activity(targets, lane, label, str(getattr(session, "ponto", "") or ""))


@router.post("/jobs")
def criar_job_papelaria(
    payload: PapelariaCreateJobPayload,
    session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        with _sp_activity([(payload.ano, payload.nro)], "prova", "Enviando prova para geração", session):
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
                manter_dados_corel=payload.manter_dados_corel,
                gerar_corel=payload.gerar_corel,
            )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao criar job papelaria: %s", e)
        raise HTTPException(500, "Erro ao criar solicitação de geração.")


@router.post("/os/{ano}/{nro}/comparar-corel")
def iniciar_comparacao_corel_os(
    ano: int,
    nro: int,
    payload: Optional[PapelariaIniciarComparacaoPayload] = None,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Lê (via worker) os textos do Corel da pasta para comparar com o formulário."""
    try:
        from services import papelaria_corel_dados_service as dados_svc

        return dados_svc.iniciar_comparacao(
            ano, nro, payload.modelo_id if payload else None
        )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except (OSError, ValueError) as e:
        raise HTTPException(400, f"Não foi possível ler o Corel da pasta: {e}")
    except Exception as e:
        logger.exception("Erro ao iniciar comparação Corel OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao ler o Corel da pasta.")


@router.post("/os/{ano}/{nro}/comparar-corel/{inspect_id}")
def resultado_comparacao_corel_os(
    ano: int,
    nro: int,
    inspect_id: str,
    payload: PapelariaCompararCorelPayload,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Estado da leitura; concluída, traz as diferenças Corel × formulário."""
    try:
        from services import papelaria_corel_dados_service as dados_svc

        return dados_svc.resultado_comparacao(
            inspect_id,
            modelo_id=payload.modelo_id,
            dados=payload.dados,
        )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Erro na comparação Corel OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao comparar os dados do Corel.")


@router.post("/jobs/timbrado-a4-digital")
def criar_job_timbrado_a4_digital(
    payload: PapelariaCreateJobPayload,
    session: SessionData = Depends(_require_papelaria_access),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        with _sp_activity([(payload.ano, payload.nro)], "prova", "Enviando Timbrado Digital para geração", session):
            if payload.lancar_andamento:
                jobs_svc.register_preparando_prova_andamento(
                    payload.ano, payload.nro, str(session.ponto)
                )

            return jobs_svc.create_timbrado_a4_digital_job(
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
        logger.exception("Erro ao criar job Timbrado A4 Digital: %s", e)
        raise HTTPException(500, "Erro ao criar solicitação Timbrado A4 Digital.")


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


@router.post("/sp-status-resumo")
def sp_status_resumo(
    payload: PapelariaSpStatusResumoPayload,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Resumo Prova/Imposição para a lista de SPs (lote)."""
    try:
        from services.papelaria_sp_status_service import build_sp_status_resumo

        return build_sp_status_resumo(
            [item.model_dump() for item in payload.items]
        )
    except Exception as e:
        logger.exception("Erro no resumo de status das SPs: %s", e)
        raise HTTPException(500, "Erro ao montar resumo de status das SPs.")


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

        with _sp_activity([(payload.ano, payload.nro)], "prova", "Finalizando edição no Corel", session):
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

        with _sp_activity([(payload.ano, payload.nro)], "prova", "Enviando prova para geração", session):
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


@router.get("/os/{ano}/{nro}/imposicao-opcoes")
def listar_imposicao_opcoes_os(
    ano: int,
    nro: int,
    modelo_id: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Opções Digital/Offset resolvidas (override do modelo > padrão do produto)."""
    try:
        from services import papelaria_models_service as models_svc
        from services import papelaria_produto_imposicao_service as prod_imp_svc
        from services import papelaria_imposicao_juntada_service as juntada_svc

        modelo = models_svc.get_modelo_by_id(int(modelo_id))
        if not modelo:
            raise LookupError("Modelo não encontrado ou inativo.")
        produto = (modelo.get("produto") or "").strip()
        opcoes = prod_imp_svc.resolve_imposicao_opcoes(
            produto=produto,
            modelo_imposicao_config_json=modelo.get("imposicao_config_json"),
        )
        try:
            juntada = juntada_svc.list_imposicao_candidatas(
                ano=ano, nro=nro, produto=produto
            )
        except Exception:
            juntada = {
                "ancora": {"ano": ano, "nro": nro, "produto": produto},
                "situacao": "",
                "max_slots": juntada_svc.max_slots(produto),
                "candidatas": [],
            }
        opcoes["juntada"] = juntada
        return opcoes
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro opções imposição OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao obter opções de imposição.")


@router.post("/os/{ano}/{nro}/imposicao")
def gerar_imposicao_os(
    ano: int,
    nro: int,
    payload: PapelariaImposicaoPayload,
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

        juntada_os = None
        if payload.juntada_os:
            juntada_os = [
                {"ano": int(j.ano), "nro": int(j.nro)} for j in payload.juntada_os
            ]
        alvos = [(payload.ano, payload.nro)] + [
            (int(j["ano"]), int(j["nro"])) for j in (juntada_os or [])
        ]
        with _sp_activity(alvos, "imposicao", "Gerando imposição (JDF)", session):
            return jobs_svc.create_imposicao_job(
                ano=payload.ano,
                nro=payload.nro,
                solicitado_por=str(session.ponto),
                arquivo_cdr=payload.arquivo_cdr,
                modelo_id=payload.modelo_id,
                variante=payload.variante,
                imposicao_config=(
                    payload.imposicao_config
                    if isinstance(payload.imposicao_config, dict)
                    else None
                ),
                juntada_os=juntada_os,
            )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro imposição OS %s/%s: %s", nro, ano, e)
        raise HTTPException(500, "Erro ao solicitar imposição.")


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


@router.post("/jobs/{job_id}/reenviar-jdf")
def reenviar_jdf_imposicao(
    job_id: int,
    session: SessionData = Depends(_require_papelaria_access),
):
    """Reenvia o JDF ao hotfolder do Apogee para job ainda aguardando PDF."""
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.resend_imposicao_jdf(
            job_id,
            solicitado_por=str(session.ponto),
        )
    except LookupError as e:
        raise HTTPException(404, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao reenviar JDF do job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao reenviar JDF ao Apogee.")


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

        job = jobs_svc.get_job(job_id)
        alvos = (
            [(int(job["ano_protocolo"]), int(job["nro_protocolo"]))] if job else []
        )
        with _sp_activity(alvos, "prova", "Aprovando prova (gerando envio)", session):
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


@router.get("/jobs/{job_id}/imposicao-resultado")
def poll_imposicao_resultado_job(
    job_id: int,
    _session: SessionData = Depends(_require_papelaria_access),
):
    """Polling: aguarda PDF do Apogee e move para a pasta de saída configurada."""
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.poll_imposicao_apogee_result(job_id)
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        logger.exception("Erro poll imposição job %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao verificar resultado da imposição no Apogee.")


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
