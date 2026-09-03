"""Configurações globais do sistema (pré-análise e modelos de e-mail)."""
from __future__ import annotations

import logging
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, EmailStr, Field

from security.api_auth import is_master_client
from security.session_auth import SessionData, require_session
from security.user_permissions import resolve_effective_permissions
from services import email_template_service as email_tpl
from services.pre_analise.check_settings import set_disabled_check_ids
from services.pre_analise.registry import list_checks_config

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-system"])


def require_admin_config_access(
    request: Request,
    session: SessionData = Depends(require_session),
) -> SessionData:
    """MASTER_IP ou usuário autenticado com sb_admin_ips (mesma regra da página)."""
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
    if perms and bool(perms.get("sb_admin_ips")):
        return session
    logger.warning(
        "Config sistema negado ponto=%s ip=%s path=%s",
        session.ponto,
        session.ip,
        request.url.path,
    )
    raise HTTPException(
        status_code=403,
        detail="Sem permissão para alterar configurações do sistema.",
    )


class PreAnaliseChecksSaveRequest(BaseModel):
    disabled: List[str] = Field(default_factory=list)


class GerenciaSettingsSaveRequest(BaseModel):
    os_arquivos_client_email_enabled: bool


class IniciarNovoSemestreRequest(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    numero_semestre: int = Field(..., ge=1, le=2)
    data_inicio: date
    data_fim: date
    limite_os_deputado: int = Field(..., ge=0)
    limite_sp_deputado: int = Field(..., ge=0)


class PapelariaQueueMoveRequest(BaseModel):
    direction: Literal["up", "down"]


class EmailTemplateSaveRequest(BaseModel):
    subject: str = ""
    html: str = ""
    use_custom: bool = True
    content_mode: Literal["preset", "custom"] = "custom"
    preset_id: str = ""


class EmailSendMailboxesSaveRequest(BaseModel):
    os_lt_5000: str = Field(..., min_length=3)
    os_gte_5000: str = Field(..., min_length=3)
    activation: str = ""


class GravacaoNotificationEventRequest(BaseModel):
    enabled: bool = True
    mode: Literal["usuario", "personalizado"] = "usuario"
    recipients: List[EmailStr] = Field(default_factory=list)


class GravacaoNotificationSettingsRequest(BaseModel):
    encaminhada: GravacaoNotificationEventRequest = Field(
        default_factory=GravacaoNotificationEventRequest
    )
    iniciada: GravacaoNotificationEventRequest
    concluida: GravacaoNotificationEventRequest


class EmailTemplatePreviewRequest(BaseModel):
    subject: str = ""
    html: str = ""
    use_custom: bool = True
    content_mode: Literal["preset", "custom"] = "custom"
    preset_id: str = ""


class EmailTemplateSendTestRequest(EmailTemplatePreviewRequest):
    to: EmailStr


@router.get(
    "/api/admin/system/pre-analise-checks",
    dependencies=[Depends(require_admin_config_access)],
)
def get_pre_analise_checks_config():
    return {"checks": list_checks_config()}


@router.put(
    "/api/admin/system/pre-analise-checks",
    dependencies=[Depends(require_admin_config_access)],
)
def save_pre_analise_checks_config(body: PreAnaliseChecksSaveRequest):
    disabled = {str(item).strip() for item in body.disabled if str(item).strip()}
    set_disabled_check_ids(disabled)
    return {"checks": list_checks_config()}


@router.get(
    "/api/admin/system/gerencia-settings",
    dependencies=[Depends(require_admin_config_access)],
)
def get_gerencia_settings_config():
    from services.gerencia_settings import get_public_settings

    return get_public_settings()


@router.put(
    "/api/admin/system/gerencia-settings",
    dependencies=[Depends(require_admin_config_access)],
)
def save_gerencia_settings_config(body: GerenciaSettingsSaveRequest):
    from services.gerencia_settings import (
        get_public_settings,
        set_os_arquivos_client_email_enabled,
    )

    set_os_arquivos_client_email_enabled(body.os_arquivos_client_email_enabled)
    return get_public_settings()


def _serialize_semestre_cotas(info: dict) -> dict:
    semestre = dict(info)
    for key in ("data_inicio", "data_fim", "resetado_em"):
        val = semestre.get(key)
        if val is not None and hasattr(val, "isoformat"):
            semestre[key] = val.isoformat()
        elif val is not None:
            semestre[key] = str(val)
    return semestre


@router.get(
    "/api/admin/system/cotas-graf-semestre",
    dependencies=[Depends(require_admin_config_access)],
)
def get_cotas_graf_semestre_config():
    from services.cliente_cota_service import (
        obter_semestre_aberto_info,
        proximo_semestre_sugerido,
    )

    info = obter_semestre_aberto_info()
    if not info:
        return {"semestre": None, "proximo_semestre": None}
    sugerido = proximo_semestre_sugerido(
        int(info["ano"]),
        int(info["numero_semestre"]),
        limite_os=int(info["limite_os_deputado"]),
        limite_sp=int(info["limite_sp_deputado"]),
    )
    return {
        "semestre": _serialize_semestre_cotas(info),
        "proximo_semestre": _serialize_semestre_cotas(sugerido),
    }


@router.post(
    "/api/admin/system/cotas-graf/iniciar-novo-semestre",
    dependencies=[Depends(require_admin_config_access)],
)
def iniciar_novo_semestre_cotas_graf(
    body: IniciarNovoSemestreRequest,
    session: SessionData = Depends(require_session),
):
    from services.cliente_cota_service import (
        iniciar_novo_semestre_cotas,
        obter_semestre_aberto_info,
    )

    info = obter_semestre_aberto_info()
    if not info:
        raise HTTPException(status_code=400, detail="Nenhum semestre aberto encontrado.")
    try:
        ponto = int(session.ponto) if session.ponto else None
    except (TypeError, ValueError):
        ponto = None
    try:
        iniciar_novo_semestre_cotas(
            int(info["semestre_id"]),
            ano=body.ano,
            numero_semestre=body.numero_semestre,
            data_inicio=body.data_inicio,
            data_fim=body.data_fim,
            limite_os=body.limite_os_deputado,
            limite_sp=body.limite_sp_deputado,
            ponto=ponto,
        )
        novo = obter_semestre_aberto_info()
        if not novo:
            raise HTTPException(
                status_code=500,
                detail="Novo semestre iniciado mas não foi possível ler o registro.",
            )
        return {
            "ok": True,
            "semestre_anterior_id": info["semestre_id"],
            "semestre": _serialize_semestre_cotas(novo),
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erro ao iniciar novo semestre de cotas: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Erro ao iniciar novo semestre de cotas.",
        ) from exc


@router.post(
    "/api/admin/system/cotas-graf/importar-grafica-rapida",
    dependencies=[Depends(require_admin_config_access)],
)
async def importar_cotas_grafica_rapida(
    arquivo: UploadFile = File(...),
    force: bool = Form(False),
    session: SessionData = Depends(require_session),
):
    from services.cota_grafica_rapida_import_service import importar_consumo_grafica_rapida

    nome = (arquivo.filename or "").strip()
    if not nome.lower().endswith((".xls", ".xlsx")):
        raise HTTPException(
            status_code=400,
            detail="Envie um arquivo Excel (.xls ou .xlsx).",
        )
    try:
        content = await arquivo.read()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Não foi possível ler o arquivo.") from exc
    if not content:
        raise HTTPException(status_code=400, detail="Arquivo vazio.")

    try:
        ponto = int(session.ponto) if session.ponto else None
    except (TypeError, ValueError):
        ponto = None

    try:
        result = importar_consumo_grafica_rapida(
            content=content,
            arquivo_nome=nome,
            ponto=ponto,
            force=bool(force),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao importar consumo Gráfica Rápida: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Erro ao importar consumo da Gráfica Rápida.",
        ) from exc

    if result.arquivo_ja_importado:
        raise HTTPException(
            status_code=409,
            detail=(
                "Este arquivo já foi importado anteriormente. "
                "Marque 'Forçar reimportação' apenas se souber que há novos registros."
            ),
        )

    return {
        "ok": True,
        "arquivo_nome": result.arquivo_nome,
        "linhas_lidas": result.pa_unicos,
        "inseridos": result.inseridos,
        "duplicados": result.duplicados,
        "rejeitados": result.rejeitados,
        "semestres_atualizados": result.semestres_atualizados,
        "rejeicoes": result.rejeicoes,
    }


@router.post(
    "/api/admin/system/cotas-graf/recalcular",
    dependencies=[Depends(require_admin_config_access)],
)
def recalcular_cotas_graf_semestre(
    session: SessionData = Depends(require_session),
):
    from services.cliente_cota_service import obter_semestre_aberto_info, recalcular_cotas_semestre

    info = obter_semestre_aberto_info()
    if not info:
        raise HTTPException(status_code=400, detail="Nenhum semestre aberto encontrado.")
    try:
        result = recalcular_cotas_semestre(semestre_id=int(info["semestre_id"]))
        return {
            "ok": True,
            "semestre_id": result.semestre_id,
            "movimentos_inseridos": result.movimentos_inseridos,
            "clientes_atualizados": result.clientes_atualizados,
            "protocolos_lidos": result.protocolos_lidos,
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao recalcular cotas: %s", exc)
        raise HTTPException(status_code=500, detail="Erro ao recalcular cotas do semestre.") from exc


@router.get(
    "/api/admin/system/papelaria-worker-queue",
    dependencies=[Depends(require_admin_config_access)],
)
def get_papelaria_worker_queue_admin():
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.get_admin_worker_queue_snapshot()
    except Exception as e:
        logger.exception("Erro ao carregar fila Papelaria: %s", e)
        raise HTTPException(500, "Erro ao carregar fila do worker Papelaria.")


@router.post(
    "/api/admin/system/papelaria-jobs/{job_id}/cancel",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_cancel_papelaria_job(
    job_id: int,
    session: SessionData = Depends(require_session),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.cancel_job(job_id, f"admin:{session.ponto}")
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao cancelar job Papelaria %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao cancelar job.")


@router.post(
    "/api/admin/system/papelaria-jobs/{job_id}/move",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_move_papelaria_job(
    job_id: int,
    body: PapelariaQueueMoveRequest,
    session: SessionData = Depends(require_session),
):
    try:
        from services import papelaria_jobs_service as jobs_svc

        return jobs_svc.move_pending_job(
            job_id,
            body.direction,
            f"admin:{session.ponto}",
        )
    except LookupError:
        raise HTTPException(404, "Job não encontrado.")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("Erro ao reordenar job Papelaria %s: %s", job_id, e)
        raise HTTPException(500, "Erro ao reordenar job na fila.")


@router.get(
    "/api/admin/system/email-templates",
    dependencies=[Depends(require_admin_config_access)],
)
def get_email_templates_config():
    from services.email_template_store import get_file_path

    return {
        "templates": email_tpl.list_templates_public(),
        "send_mailboxes": email_tpl.get_global_send_mailboxes(),
        "gravacao_notifications": email_tpl.get_gravacao_notification_settings(),
        "variable_hints": email_tpl.VARIABLE_HINTS,
        "sample_variables": email_tpl.SAMPLE_PREVIEW_VARS,
        "storage": "mysql",
        "backup_file": str(get_file_path()),
    }


@router.put(
    "/api/admin/system/email-templates/{template_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def save_email_template(template_id: str, body: EmailTemplateSaveRequest):
    try:
        saved = email_tpl.save_template(
            template_id,
            subject=body.subject,
            html=body.html,
            use_custom=body.use_custom,
            content_mode=body.content_mode,
            preset_id=body.preset_id,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo de e-mail não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Não foi possível gravar a configuração: {exc}",
        ) from exc
    except Exception as exc:
        logger.exception("Erro ao salvar modelo de e-mail %s", template_id)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao persistir modelo de e-mail: {exc}",
        ) from exc
    return {"template": saved, "storage": "mysql"}


@router.post(
    "/api/admin/system/email-templates/{template_id}/presets/upload",
    dependencies=[Depends(require_admin_config_access)],
)
async def upload_email_template_preset(
    template_id: str,
    file: UploadFile = File(...),
    label: str = Form(""),
    apply: bool = Form(True),
    subject: str = Form(""),
):
    try:
        content = await file.read()
        result = email_tpl.upload_email_preset_file(
            template_id,
            filename=file.filename or "modelo.html",
            content=content,
            label=label,
            apply_to_template=apply,
            subject=subject,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo de e-mail não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Não foi possível gravar o arquivo: {exc}",
        ) from exc
    except Exception as exc:
        logger.exception("Erro ao cadastrar preset de e-mail %s", template_id)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao cadastrar modelo: {exc}",
        ) from exc
    return {**result, "storage": "mysql"}


@router.delete(
    "/api/admin/system/email-templates/{template_id}/presets/{preset_id}",
    dependencies=[Depends(require_admin_config_access)],
)
@router.post(
    "/api/admin/system/email-templates/{template_id}/presets/{preset_id}/delete",
    dependencies=[Depends(require_admin_config_access)],
)
def delete_email_template_preset(template_id: str, preset_id: str):
    try:
        result = email_tpl.delete_uploaded_email_preset(template_id, preset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo de e-mail não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Não foi possível remover o arquivo: {exc}",
        ) from exc
    return {**result, "storage": "mysql"}


@router.post(
    "/api/admin/system/email-templates/{template_id}/reset",
    dependencies=[Depends(require_admin_config_access)],
)
def reset_email_template(template_id: str):
    try:
        restored = email_tpl.reset_template(template_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo de e-mail não encontrado.") from None
    return {"template": restored}


@router.put(
    "/api/admin/system/email-send-mailboxes",
    dependencies=[Depends(require_admin_config_access)],
)
def save_email_send_mailboxes(body: EmailSendMailboxesSaveRequest):
    try:
        saved = email_tpl.save_global_send_mailboxes(
            os_lt_5000=body.os_lt_5000,
            os_gte_5000=body.os_gte_5000,
            activation=body.activation,
        )
    except Exception as exc:
        logger.exception("Erro ao salvar contas de envio de e-mail")
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao persistir contas de envio: {exc}",
        ) from exc
    return {"send_mailboxes": saved, "storage": "mysql"}


@router.put(
    "/api/admin/system/email-gravacao-notifications",
    dependencies=[Depends(require_admin_config_access)],
)
def save_email_gravacao_notifications(body: GravacaoNotificationSettingsRequest):
    try:
        saved = email_tpl.save_gravacao_notification_settings(
            {
                "encaminhada": {
                    "enabled": body.encaminhada.enabled,
                    "mode": body.encaminhada.mode,
                    "recipients": [str(value) for value in body.encaminhada.recipients],
                },
                "iniciada": {
                    "enabled": body.iniciada.enabled,
                    "mode": body.iniciada.mode,
                    "recipients": [str(value) for value in body.iniciada.recipients],
                },
                "concluida": {
                    "enabled": body.concluida.enabled,
                    "mode": body.concluida.mode,
                    "recipients": [str(value) for value in body.concluida.recipients],
                },
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao salvar notificações de gravação por e-mail")
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao persistir notificações de gravação: {exc}",
        ) from exc
    return {"gravacao_notifications": saved, "storage": "mysql"}


@router.post(
    "/api/admin/system/email-templates/{template_id}/preview",
    dependencies=[Depends(require_admin_config_access)],
)
def preview_email_template(template_id: str, body: Optional[EmailTemplatePreviewRequest] = None):
    try:
        rendered = email_tpl.render_template_for_preview(
            template_id,
            subject=body.subject if body else "",
            html=body.html if body else "",
            use_custom=body.use_custom if body else False,
            content_mode=body.content_mode if body else "custom",
            preset_id=body.preset_id if body else "",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo de e-mail não encontrado.") from None
    return {
        "subject": rendered["subject"],
        "html": rendered["html"],
        "label": rendered["label"],
    }


@router.post(
    "/api/admin/system/email-templates/{template_id}/send-test",
    dependencies=[Depends(require_admin_config_access)],
)
def send_test_email_template(template_id: str, body: EmailTemplateSendTestRequest):
    try:
        result = email_tpl.send_template_test_email(
            template_id,
            to_email=str(body.to),
            subject=body.subject,
            html=body.html,
            use_custom=body.use_custom,
            content_mode=body.content_mode,
            preset_id=body.preset_id,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo de e-mail não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao enviar e-mail de teste do modelo %s", template_id)
        raise HTTPException(
            status_code=500,
            detail=f"Falha ao enviar e-mail de teste: {exc}",
        ) from exc
    return {"success": True, **result}


# --- Modelos de e-mail múltiplos (tabEmailTemplateModel) ---


class EmailTemplateModelCreateRequest(BaseModel):
    grupo: Literal["prova_os", "prova_sp", "problema_tecnico", "timbrado_a4_digital"]
    variante: Literal["portal", "sem_portal"]
    nome: str = Field(..., min_length=1, max_length=120)
    assunto: str = ""
    html: str = ""
    anexar_pdf: bool = False
    preferir_prova_web: bool = False
    content_mode: Literal["custom", "preset"] = "custom"
    preset_id: str = ""
    ordem: int = 50


class EmailTemplateModelUpdateRequest(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=120)
    assunto: Optional[str] = None
    html: Optional[str] = None
    anexar_pdf: Optional[bool] = None
    preferir_prova_web: Optional[bool] = None
    content_mode: Optional[Literal["custom", "preset"]] = None
    preset_id: Optional[str] = None
    ordem: Optional[int] = None


class EmailTemplateModelSendTestRequest(BaseModel):
    to: EmailStr


@router.get(
    "/api/admin/system/email-template-models",
    dependencies=[Depends(require_admin_config_access)],
)
def list_email_template_models_endpoint(
    grupo: Optional[str] = None,
    variante: Optional[str] = None,
):
    from services import email_template_model_service as model_svc

    try:
        models = model_svc.list_email_template_models(grupo=grupo, variante=variante)
    except Exception as exc:
        logger.exception("Erro ao listar modelos de e-mail")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"models": models, "storage": "mysql"}


@router.post(
    "/api/admin/system/email-template-models",
    dependencies=[Depends(require_admin_config_access)],
)
def create_email_template_model_endpoint(
    body: EmailTemplateModelCreateRequest,
    session: SessionData = Depends(require_session),
):
    from services import email_template_model_service as model_svc

    try:
        created = model_svc.create_email_template_model(
            grupo=body.grupo,
            variante=body.variante,
            nome=body.nome,
            assunto=body.assunto,
            html=body.html,
            anexar_pdf=body.anexar_pdf,
            preferir_prova_web=body.preferir_prova_web,
            content_mode=body.content_mode,
            preset_id=body.preset_id or None,
            ordem=body.ordem,
            updated_by_ponto=str(session.ponto),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao criar modelo de e-mail")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"model": created, "storage": "mysql"}


@router.put(
    "/api/admin/system/email-template-models/{model_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def update_email_template_model_endpoint(
    model_id: int,
    body: EmailTemplateModelUpdateRequest,
    session: SessionData = Depends(require_session),
):
    from services import email_template_model_service as model_svc

    try:
        updated = model_svc.update_email_template_model(
            model_id,
            nome=body.nome,
            assunto=body.assunto,
            html=body.html,
            anexar_pdf=body.anexar_pdf,
            preferir_prova_web=body.preferir_prova_web,
            content_mode=body.content_mode,
            preset_id=body.preset_id,
            ordem=body.ordem,
            updated_by_ponto=str(session.ponto),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao atualizar modelo de e-mail %s", model_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"model": updated, "storage": "mysql"}


@router.post(
    "/api/admin/system/email-template-models/{model_id}/activate",
    dependencies=[Depends(require_admin_config_access)],
)
def activate_email_template_model_endpoint(
    model_id: int,
    session: SessionData = Depends(require_session),
):
    from services import email_template_model_service as model_svc

    try:
        activated = model_svc.activate_email_template_model(
            model_id, updated_by_ponto=str(session.ponto)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.") from None
    except Exception as exc:
        logger.exception("Erro ao ativar modelo %s", model_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"model": activated, "storage": "mysql"}


@router.post(
    "/api/admin/system/email-template-models/{model_id}/deactivate",
    dependencies=[Depends(require_admin_config_access)],
)
def deactivate_email_template_model_endpoint(
    model_id: int,
    session: SessionData = Depends(require_session),
):
    from services import email_template_model_service as model_svc

    try:
        deactivated = model_svc.deactivate_email_template_model(
            model_id, updated_by_ponto=str(session.ponto)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.") from None
    except Exception as exc:
        logger.exception("Erro ao desativar modelo %s", model_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"model": deactivated, "storage": "mysql"}


@router.delete(
    "/api/admin/system/email-template-models/{model_id}",
    dependencies=[Depends(require_admin_config_access)],
)
@router.post(
    "/api/admin/system/email-template-models/{model_id}/delete",
    dependencies=[Depends(require_admin_config_access)],
)
def delete_email_template_model_endpoint(model_id: int):
    from services import email_template_model_service as model_svc

    try:
        model_svc.delete_email_template_model(model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao excluir modelo %s", model_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"success": True}


@router.post(
    "/api/admin/system/email-template-models/{model_id}/preview",
    dependencies=[Depends(require_admin_config_access)],
)
def preview_email_template_model_endpoint(model_id: int):
    from services import email_template_model_service as model_svc

    try:
        rendered = model_svc.render_model_preview(model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return rendered


@router.post(
    "/api/admin/system/email-template-models/{model_id}/send-test",
    dependencies=[Depends(require_admin_config_access)],
)
def send_test_email_template_model_endpoint(
    model_id: int,
    body: EmailTemplateModelSendTestRequest,
):
    from services import email_template_model_service as model_svc

    try:
        result = model_svc.send_model_test_email(model_id, str(body.to))
    except KeyError:
        raise HTTPException(status_code=404, detail="Modelo não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao enviar teste do modelo %s", model_id)
        raise HTTPException(status_code=500, detail=f"Falha no envio de teste: {exc}") from exc
    return {"success": True, **result}


# --- Catálogo do sistema (setores, produtos, papel, etc.) ---


class SystemCatalogCreateRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)
    ordem: int = Field(50, ge=0, le=9999)


class SystemCatalogUpdateRequest(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=255)
    ordem: Optional[int] = Field(None, ge=0, le=9999)


class SystemCatalogLabelActionRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)


class MachineGroupCreateRequest(BaseModel):
    nome: str = Field(..., min_length=1, max_length=120)
    tipo: Literal["geral", "impressora"] = "geral"
    ordem: int = Field(50, ge=0, le=9999)


class MachineConfigUpdateRequest(BaseModel):
    grupo_id: Optional[int] = None
    tecnologia: Optional[Literal["digital", "offset"]] = None
    papel_max_altura_mm: Optional[float] = Field(None, ge=0)
    papel_max_largura_mm: Optional[float] = Field(None, ge=0)
    papel_padrao_altura_mm: Optional[float] = Field(None, ge=0)
    papel_padrao_largura_mm: Optional[float] = Field(None, ge=0)
    margem_superior_mm: Optional[float] = Field(None, ge=0)
    margem_direita_mm: Optional[float] = Field(None, ge=0)
    margem_inferior_mm: Optional[float] = Field(None, ge=0)
    margem_esquerda_mm: Optional[float] = Field(None, ge=0)


@router.get(
    "/api/admin/system/catalog/categories",
    dependencies=[Depends(require_admin_config_access)],
)
def list_system_catalog_categories():
    from services import system_catalog_service as catalog_svc

    return {"categories": catalog_svc.list_categories_meta()}


@router.get(
    "/api/admin/system/maquinas/configuracao",
    dependencies=[Depends(require_admin_config_access)],
)
def list_machine_catalog_config():
    from services import machine_catalog_service as machine_svc

    try:
        return machine_svc.list_machine_admin_view()
    except Exception as exc:
        logger.exception("Erro ao listar configurações de máquinas")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/api/admin/system/maquinas/grupos",
    dependencies=[Depends(require_admin_config_access)],
)
def create_machine_group(
    body: MachineGroupCreateRequest,
    session: SessionData = Depends(require_session),
):
    from services import machine_catalog_service as machine_svc

    try:
        group = machine_svc.create_group(
            nome=body.nome,
            tipo=body.tipo,
            ordem=body.ordem,
            updated_by_ponto=str(session.ponto),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao criar grupo de máquinas")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"group": group}


@router.put(
    "/api/admin/system/maquinas/configuracao/{maquina_rotulo:path}",
    dependencies=[Depends(require_admin_config_access)],
)
def update_machine_catalog_config(
    maquina_rotulo: str,
    body: MachineConfigUpdateRequest,
    session: SessionData = Depends(require_session),
):
    from services import machine_catalog_service as machine_svc

    try:
        config = machine_svc.update_machine_config(
            maquina_rotulo,
            grupo_id=body.grupo_id,
            tecnologia=body.tecnologia,
            papel_max_altura_mm=body.papel_max_altura_mm,
            papel_max_largura_mm=body.papel_max_largura_mm,
            papel_padrao_altura_mm=body.papel_padrao_altura_mm,
            papel_padrao_largura_mm=body.papel_padrao_largura_mm,
            margem_superior_mm=body.margem_superior_mm,
            margem_direita_mm=body.margem_direita_mm,
            margem_inferior_mm=body.margem_inferior_mm,
            margem_esquerda_mm=body.margem_esquerda_mm,
            updated_by_ponto=str(session.ponto),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Máquina não encontrada.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao salvar configuração da máquina %s", maquina_rotulo)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"config": config}


@router.get(
    "/api/admin/system/catalog/{category}",
    dependencies=[Depends(require_admin_config_access)],
)
def list_system_catalog_items(category: str):
    from services import system_catalog_service as catalog_svc

    try:
        items = catalog_svc.list_admin_items(category)
        meta = catalog_svc.get_category_meta(category)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao listar catálogo %s", category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"category": category, "meta": meta, "items": items}


@router.post(
    "/api/admin/system/catalog/{category}",
    dependencies=[Depends(require_admin_config_access)],
)
def create_system_catalog_item(
    category: str,
    body: SystemCatalogCreateRequest,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        item = catalog_svc.create_catalog_item(
            category,
            label=body.label,
            ordem=body.ordem,
            updated_by_ponto=str(session.ponto),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao criar item do catálogo %s", category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.put(
    "/api/admin/system/catalog/{category}/{item_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def update_system_catalog_item(
    category: str,
    item_id: int,
    body: SystemCatalogUpdateRequest,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        item = catalog_svc.update_catalog_item(
            category,
            item_id,
            label=body.label,
            ordem=body.ordem,
            updated_by_ponto=str(session.ponto),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Item não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao atualizar item %s do catálogo %s", item_id, category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.post(
    "/api/admin/system/catalog/{category}/{item_id}/activate",
    dependencies=[Depends(require_admin_config_access)],
)
def activate_system_catalog_item(
    category: str,
    item_id: int,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        item = catalog_svc.set_catalog_item_active(
            category,
            item_id,
            active=True,
            updated_by_ponto=str(session.ponto),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Item não encontrado.") from None
    except Exception as exc:
        logger.exception("Erro ao ativar item %s do catálogo %s", item_id, category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.post(
    "/api/admin/system/catalog/{category}/{item_id}/deactivate",
    dependencies=[Depends(require_admin_config_access)],
)
def deactivate_system_catalog_item(
    category: str,
    item_id: int,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        item = catalog_svc.set_catalog_item_active(
            category,
            item_id,
            active=False,
            updated_by_ponto=str(session.ponto),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Item não encontrado.") from None
    except Exception as exc:
        logger.exception("Erro ao desativar item %s do catálogo %s", item_id, category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.post(
    "/api/admin/system/catalog/{category}/activate-by-label",
    dependencies=[Depends(require_admin_config_access)],
)
def activate_system_catalog_by_label(
    category: str,
    body: SystemCatalogLabelActionRequest,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        item = catalog_svc.activate_by_label(
            category,
            body.label,
            updated_by_ponto=str(session.ponto),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao ativar por rótulo no catálogo %s", category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.post(
    "/api/admin/system/catalog/{category}/deactivate-by-label",
    dependencies=[Depends(require_admin_config_access)],
)
def deactivate_system_catalog_by_label(
    category: str,
    body: SystemCatalogLabelActionRequest,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        item = catalog_svc.deactivate_by_label(
            category,
            body.label,
            updated_by_ponto=str(session.ponto),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao desativar por rótulo no catálogo %s", category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.delete(
    "/api/admin/system/catalog/{category}/{item_id}",
    dependencies=[Depends(require_admin_config_access)],
)
@router.post(
    "/api/admin/system/catalog/{category}/{item_id}/delete",
    dependencies=[Depends(require_admin_config_access)],
)
def delete_system_catalog_item(category: str, item_id: int):
    from services import system_catalog_service as catalog_svc

    try:
        catalog_svc.delete_catalog_item(category, item_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Item não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao excluir item %s do catálogo %s", item_id, category)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"success": True}


# --- Variações de acabamento ---


class VariacaoCreateRequest(BaseModel):
    label: str = Field(..., min_length=1, max_length=255)
    ordem: int = Field(50, ge=0, le=9999)


@router.get(
    "/api/admin/system/catalog/acabamento/{item_id}/variacoes",
    dependencies=[Depends(require_admin_config_access)],
)
def list_acabamento_variacoes(item_id: int):
    from services import system_catalog_service as catalog_svc

    try:
        variacoes = catalog_svc.list_variacoes(item_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Item não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao listar variações do item %s", item_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"variacoes": variacoes}


@router.post(
    "/api/admin/system/catalog/acabamento/{item_id}/variacoes",
    dependencies=[Depends(require_admin_config_access)],
)
def create_acabamento_variacao(
    item_id: int,
    body: VariacaoCreateRequest,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        variacao = catalog_svc.create_variacao(
            item_id,
            label=body.label,
            ordem=body.ordem,
            updated_by_ponto=str(session.ponto),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Item não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao criar variação no item %s", item_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"variacao": variacao}


@router.post(
    "/api/admin/system/catalog/acabamento/{item_id}/variacoes/{variacao_id}/activate",
    dependencies=[Depends(require_admin_config_access)],
)
def activate_acabamento_variacao(
    item_id: int,
    variacao_id: int,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        variacao = catalog_svc.set_variacao_active(
            item_id, variacao_id, active=True, updated_by_ponto=str(session.ponto)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Variação não encontrada.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao ativar variação %s", variacao_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"variacao": variacao}


@router.post(
    "/api/admin/system/catalog/acabamento/{item_id}/variacoes/{variacao_id}/deactivate",
    dependencies=[Depends(require_admin_config_access)],
)
def deactivate_acabamento_variacao(
    item_id: int,
    variacao_id: int,
    session: SessionData = Depends(require_session),
):
    from services import system_catalog_service as catalog_svc

    try:
        variacao = catalog_svc.set_variacao_active(
            item_id, variacao_id, active=False, updated_by_ponto=str(session.ponto)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Variação não encontrada.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao desativar variação %s", variacao_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"variacao": variacao}


@router.delete(
    "/api/admin/system/catalog/acabamento/{item_id}/variacoes/{variacao_id}",
    dependencies=[Depends(require_admin_config_access)],
)
@router.post(
    "/api/admin/system/catalog/acabamento/{item_id}/variacoes/{variacao_id}/delete",
    dependencies=[Depends(require_admin_config_access)],
)
def delete_acabamento_variacao(item_id: int, variacao_id: int):
    from services import system_catalog_service as catalog_svc

    try:
        catalog_svc.delete_variacao(item_id, variacao_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Variação não encontrada.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao excluir variação %s", variacao_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"success": True}


# --- Custos: funções (mão de obra) ---


class CustoFuncaoCreateRequest(BaseModel):
    nome: str = Field(..., min_length=1, max_length=120)
    custo_mensal: float = Field(..., ge=0)
    codigo: Optional[str] = Field(None, max_length=64)
    descricao: Optional[str] = None
    quantidade: int = Field(1, ge=1)
    alocacao: Optional[str] = Field("etapa", max_length=16)


class CustoFuncaoUpdateRequest(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=120)
    custo_mensal: Optional[float] = Field(None, ge=0)
    codigo: Optional[str] = Field(None, max_length=64)
    clear_codigo: bool = False
    descricao: Optional[str] = None
    quantidade: Optional[int] = Field(None, ge=1)
    alocacao: Optional[str] = Field(None, max_length=16)


@router.get(
    "/api/admin/system/custos/funcoes",
    dependencies=[Depends(require_admin_config_access)],
)
def list_custo_funcoes(include_inactive: bool = True):
    from services import custo_funcao_service as custo_svc

    try:
        items = custo_svc.list_funcoes(include_inactive=include_inactive)
    except Exception as exc:
        logger.exception("Erro ao listar funções de custo")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"items": items, "horas_mes_padrao": float(custo_svc.HORAS_MES_PADRAO)}


@router.post(
    "/api/admin/system/custos/funcoes",
    dependencies=[Depends(require_admin_config_access)],
)
def create_custo_funcao(
    body: CustoFuncaoCreateRequest,
    session: SessionData = Depends(require_session),
):
    from services import custo_funcao_service as custo_svc

    try:
        item = custo_svc.create_funcao(
            nome=body.nome,
            custo_mensal=body.custo_mensal,
            codigo=body.codigo,
            descricao=body.descricao,
            quantidade=body.quantidade,
            alocacao=body.alocacao,
            ponto=str(session.ponto),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao criar função de custo")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.put(
    "/api/admin/system/custos/funcoes/{funcao_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def update_custo_funcao(
    funcao_id: int,
    body: CustoFuncaoUpdateRequest,
    session: SessionData = Depends(require_session),
):
    from services import custo_funcao_service as custo_svc

    try:
        item = custo_svc.update_funcao(
            funcao_id,
            nome=body.nome,
            custo_mensal=body.custo_mensal,
            codigo=body.codigo,
            clear_codigo=body.clear_codigo,
            descricao=body.descricao,
            quantidade=body.quantidade,
            alocacao=body.alocacao,
            ponto=str(session.ponto),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Função não encontrada.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao atualizar função de custo %s", funcao_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.post(
    "/api/admin/system/custos/funcoes/{funcao_id}/ativar",
    dependencies=[Depends(require_admin_config_access)],
)
def activate_custo_funcao(
    funcao_id: int,
    session: SessionData = Depends(require_session),
):
    from services import custo_funcao_service as custo_svc

    try:
        item = custo_svc.set_funcao_active(
            funcao_id, active=True, ponto=str(session.ponto)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Função não encontrada.") from None
    except Exception as exc:
        logger.exception("Erro ao ativar função de custo %s", funcao_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


@router.post(
    "/api/admin/system/custos/funcoes/{funcao_id}/desativar",
    dependencies=[Depends(require_admin_config_access)],
)
def deactivate_custo_funcao(
    funcao_id: int,
    session: SessionData = Depends(require_session),
):
    from services import custo_funcao_service as custo_svc

    try:
        item = custo_svc.set_funcao_active(
            funcao_id, active=False, ponto=str(session.ponto)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Função não encontrada.") from None
    except Exception as exc:
        logger.exception("Erro ao desativar função de custo %s", funcao_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"item": item}


# --- Orçamento gráfico: cadastro de variáveis ---


class OrcamentoInsumoRequest(BaseModel):
    codigo: str = Field(..., min_length=1, max_length=32)
    categoria: str = Field(..., min_length=1, max_length=32)
    especificacao: str = Field(..., min_length=1, max_length=255)
    unidade: Optional[str] = Field(None, max_length=16)
    qtd_embalagem: float = Field(1, ge=0)
    preco_bruto: float = Field(0, ge=0)
    preco_bruto_digital: Optional[float] = Field(None, ge=0)
    rendimento_a4: Optional[float] = Field(None, ge=0)
    formato_folha: Optional[str] = None
    aliases: Optional[list[str]] = None
    atualizado_em: Optional[str] = None
    ativo: bool = True


class OrcamentoParametrosRequest(BaseModel):
    valores: dict[str, str]


class OrcamentoFormatoUpdate(BaseModel):
    codigo: Optional[str] = None
    menor_mm: Optional[float] = None
    maior_mm: Optional[float] = None
    fator_a4: Optional[float] = None
    ordem: Optional[int] = None
    ativo: Optional[bool] = None


class OrcamentoFaixaUpdate(BaseModel):
    limite_inf: Optional[int] = None
    limite_sup: Optional[int] = None
    percentual: Optional[float] = None
    ordem: Optional[int] = None
    ativo: Optional[bool] = None


@router.get(
    "/api/admin/system/orcamento/insumos",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_list_orcamento_insumos(include_inactive: bool = True):
    from services import orcamento_admin_service as orc_adm

    return {"items": orc_adm.list_insumos(include_inactive=include_inactive)}


@router.post(
    "/api/admin/system/orcamento/insumos",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_create_orcamento_insumo(
    body: OrcamentoInsumoRequest,
    session: SessionData = Depends(require_session),
):
    from services import orcamento_admin_service as orc_adm

    try:
        item = orc_adm.upsert_insumo(**body.model_dump(), ponto=str(session.ponto))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": item}


@router.put(
    "/api/admin/system/orcamento/insumos/{insumo_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_update_orcamento_insumo(
    insumo_id: int,
    body: OrcamentoInsumoRequest,
    session: SessionData = Depends(require_session),
):
    from services import orcamento_admin_service as orc_adm

    try:
        item = orc_adm.upsert_insumo(
            insumo_id=insumo_id, **body.model_dump(), ponto=str(session.ponto)
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": item}


@router.post(
    "/api/admin/system/orcamento/insumos/{insumo_id}/ativar",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_ativar_orcamento_insumo(
    insumo_id: int,
    session: SessionData = Depends(require_session),
):
    from services import orcamento_admin_service as orc_adm

    try:
        item = orc_adm.set_insumo_ativo(insumo_id, True, ponto=str(session.ponto))
    except KeyError:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.") from None
    return {"item": item}


@router.post(
    "/api/admin/system/orcamento/insumos/{insumo_id}/desativar",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_desativar_orcamento_insumo(
    insumo_id: int,
    session: SessionData = Depends(require_session),
):
    from services import orcamento_admin_service as orc_adm

    try:
        item = orc_adm.set_insumo_ativo(insumo_id, False, ponto=str(session.ponto))
    except KeyError:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.") from None
    return {"item": item}


@router.get(
    "/api/admin/system/orcamento/parametros",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_list_orcamento_parametros():
    from services import orcamento_admin_service as orc_adm

    return {"items": orc_adm.list_parametros()}


@router.put(
    "/api/admin/system/orcamento/parametros",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_update_orcamento_parametros(
    body: OrcamentoParametrosRequest,
    session: SessionData = Depends(require_session),
):
    from services import orcamento_admin_service as orc_adm

    return {"items": orc_adm.update_parametros(body.valores, ponto=str(session.ponto))}


@router.get(
    "/api/admin/system/orcamento/formatos",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_list_orcamento_formatos():
    from services import orcamento_admin_service as orc_adm

    return {"items": orc_adm.list_formatos(include_inactive=True)}


@router.put(
    "/api/admin/system/orcamento/formatos/{formato_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_update_orcamento_formato(formato_id: int, body: OrcamentoFormatoUpdate):
    from services import orcamento_admin_service as orc_adm

    try:
        items = orc_adm.update_formato(formato_id, body.model_dump(exclude_none=True))
    except KeyError:
        raise HTTPException(status_code=404, detail="Formato não encontrado.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"items": items}


@router.get(
    "/api/admin/system/orcamento/faixas",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_list_orcamento_faixas():
    from services import orcamento_admin_service as orc_adm

    return {"items": orc_adm.list_faixas(include_inactive=True)}


@router.put(
    "/api/admin/system/orcamento/faixas/{faixa_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_update_orcamento_faixa(faixa_id: int, body: OrcamentoFaixaUpdate):
    from services import orcamento_admin_service as orc_adm

    try:
        items = orc_adm.update_faixa(faixa_id, body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"items": items}


class ProdutoPassoCrew(BaseModel):
    funcao_id: int
    quantidade: float = 1


class ProdutoPassoIn(BaseModel):
    ordem: Optional[int] = None
    nome: str = ""
    setor_link: str
    tipo: str = "produtiva"
    cobra_pessoal: bool = True
    tecnologia: str = "qualquer"
    setup_min: float = 0
    min_por_un: float = 0
    min_por_pag: float = 0
    min_por_folha: float = 0
    funcoes: list[ProdutoPassoCrew] = Field(default_factory=list)


class ProdutoPassosReplace(BaseModel):
    rotulo: str = ""
    passos: list[ProdutoPassoIn] = Field(default_factory=list)


class ProdutoPassosCopiar(BaseModel):
    origem_catalog_id: int
    rotulo: str = ""


class ProdutoEnsure(BaseModel):
    label: str


@router.post(
    "/api/admin/system/catalog/produto/ensure",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_ensure_produto(
    body: ProdutoEnsure,
    session: SessionData = Depends(require_session),
):
    from services import orcamento_produto_passos_service as passos_svc

    try:
        item = passos_svc.ensure_produto_catalog_id(body.label, ponto=str(session.ponto))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"item": item}


@router.get(
    "/api/admin/system/catalog/produto/{catalog_id}/passos",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_list_produto_passos(catalog_id: int):
    from services import custo_funcao_service as custo_svc
    from services import orcamento_produto_passos_service as passos_svc
    from services import system_catalog_service as cat_svc

    passos = passos_svc.list_passos(catalog_id)
    funcoes = custo_svc.list_funcoes(include_inactive=False)
    setores = [it["label"] for it in cat_svc.list_admin_items("setor") if it.get("active")]
    produtos = [
        {"id": it["id"], "label": it["label"]}
        for it in cat_svc.list_admin_items("produto")
        if it.get("id") and it.get("active")
    ]
    return {"passos": passos, "funcoes": funcoes, "setores": setores, "produtos": produtos}


@router.put(
    "/api/admin/system/catalog/produto/{catalog_id}/passos",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_replace_produto_passos(catalog_id: int, body: ProdutoPassosReplace):
    from services import orcamento_produto_passos_service as passos_svc
    from services import system_catalog_service as cat_svc

    rotulo = (body.rotulo or "").strip()
    if not rotulo:
        try:
            row = cat_svc.get_catalog_item("produto", catalog_id)
            rotulo = (row or {}).get("label") or ""
        except KeyError:
            raise HTTPException(status_code=404, detail="Produto não encontrado.") from None
    try:
        passos = passos_svc.replace_passos(
            catalog_id,
            [p.model_dump() for p in body.passos],
            rotulo=rotulo,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao gravar etapas do produto %s", catalog_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"passos": passos}


@router.post(
    "/api/admin/system/catalog/produto/{catalog_id}/passos/copiar",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_copiar_produto_passos(catalog_id: int, body: ProdutoPassosCopiar):
    from services import orcamento_produto_passos_service as passos_svc
    from services import system_catalog_service as cat_svc

    rotulo = (body.rotulo or "").strip()
    if not rotulo:
        try:
            row = cat_svc.get_catalog_item("produto", catalog_id)
            rotulo = (row or {}).get("label") or ""
        except KeyError:
            raise HTTPException(status_code=404, detail="Produto não encontrado.") from None
    try:
        passos = passos_svc.copiar_passos(
            catalog_id, body.origem_catalog_id, rotulo=rotulo
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"passos": passos}


def _acabamento_passos_context(catalog_id: int):
    from services import custo_funcao_service as custo_svc
    from services import orcamento_produto_passos_service as passos_svc
    from services import system_catalog_service as cat_svc

    try:
        item = passos_svc.require_catalog_category(catalog_id, "acabamento")
    except ValueError:
        raise HTTPException(status_code=404, detail="Acabamento não encontrado.") from None
    passos = passos_svc.list_passos(catalog_id)
    funcoes = custo_svc.list_funcoes(include_inactive=False)
    setores = [it["label"] for it in cat_svc.list_admin_items("setor") if it.get("active")]
    acabamentos = [
        {"id": it["id"], "label": it["label"]}
        for it in cat_svc.list_admin_items("acabamento")
        if it.get("id") and it.get("active")
    ]
    return item, passos, funcoes, setores, acabamentos


@router.get(
    "/api/admin/system/catalog/acabamento/{catalog_id}/passos",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_list_acabamento_passos(catalog_id: int):
    item, passos, funcoes, setores, acabamentos = _acabamento_passos_context(catalog_id)
    return {
        "passos": passos,
        "funcoes": funcoes,
        "setores": setores,
        "produtos": [],
        "acabamentos": acabamentos,
        "rotulo": item.get("label") or "",
    }


@router.put(
    "/api/admin/system/catalog/acabamento/{catalog_id}/passos",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_replace_acabamento_passos(catalog_id: int, body: ProdutoPassosReplace):
    from services import orcamento_produto_passos_service as passos_svc

    try:
        item = passos_svc.require_catalog_category(catalog_id, "acabamento")
    except ValueError:
        raise HTTPException(status_code=404, detail="Acabamento não encontrado.") from None
    rotulo = (body.rotulo or "").strip() or (item.get("label") or "")
    try:
        passos = [
            {**p.model_dump(), "tipo": "produtiva", "cobra_pessoal": True}
            for p in body.passos
        ]
        saved = passos_svc.replace_passos(catalog_id, passos, rotulo=rotulo)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao gravar etapas do acabamento %s", catalog_id)
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"passos": saved}


@router.post(
    "/api/admin/system/catalog/acabamento/{catalog_id}/passos/copiar",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_copiar_acabamento_passos(catalog_id: int, body: ProdutoPassosCopiar):
    from services import orcamento_produto_passos_service as passos_svc

    try:
        item = passos_svc.require_catalog_category(catalog_id, "acabamento")
        passos_svc.require_catalog_category(body.origem_catalog_id, "acabamento")
    except ValueError:
        raise HTTPException(status_code=404, detail="Acabamento não encontrado.") from None
    rotulo = (body.rotulo or "").strip() or (item.get("label") or "")
    try:
        passos = passos_svc.copiar_passos(
            catalog_id, body.origem_catalog_id, rotulo=rotulo
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"passos": passos}


class PassosPriorsSeedIn(BaseModel):
    force: bool = True


@router.post(
    "/api/admin/system/orcamento/passos/priors",
    dependencies=[Depends(require_admin_config_access)],
)
def admin_seed_orcamento_passos_priors(
    body: PassosPriorsSeedIn | None = None,
    session: SessionData = Depends(require_session),
):
    from services.orcamento_passo_priors_seed import seed_orcamento_passos_priors

    payload = body or PassosPriorsSeedIn()
    try:
        result = seed_orcamento_passos_priors(
            force=payload.force,
            ponto=str(session.ponto),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Erro ao aplicar priors de etapas de orçamento")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return result
