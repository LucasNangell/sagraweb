from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import Any, Optional, List
import logging
import os
import tempfile
import mimetypes
from database import db
from .andamento_helpers import format_andamento_obs, format_ponto
from .os_audit_service import log_andamento_added
from datetime import datetime
import glob
from security.session_auth import SessionData, require_session
from security.api_auth import is_master_client
from security.user_permissions import resolve_effective_permissions
from services.email_config_service import (
    DEFAULT_EWS_URL,
    DEFAULT_MAILBOX_CANDIDATES,
    DEFAULT_VERIFY_SSL,
    get_default_runtime_config,
    get_public_config,
    get_runtime_config,
    save_config,
)

logger = logging.getLogger(__name__)

try:
    from services.ews_service import EWSService, EWSUnavailableError, MailboxFolderTarget
    EWS_AVAILABLE = True
except ImportError as e:
    logger.error("Failed to import EWSService: %s", e)
    EWS_AVAILABLE = False

    class EWSUnavailableError(RuntimeError):
        pass

    class EWSService:
        def __init__(self, *args, **kwargs):
            pass

    class MailboxFolderTarget:
        def __init__(self, *args, **kwargs):
            pass

router = APIRouter(prefix="/email")

# --- CONFIG ---
EWS_URL = DEFAULT_EWS_URL
EWS_VERIFY_SSL = DEFAULT_VERIFY_SSL

# --- HELPERS ---

def _get_ews_service(
    *,
    ews_url: Optional[str] = None,
    verify_ssl: Optional[bool] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
):
    """Retorna uma instância configurada do EWSService."""
    if not EWS_AVAILABLE:
        raise HTTPException(
            status_code=500, 
            detail="Serviço de E-mail indisponível: Dependência 'requests-negotiate-sspi' ou 'lxml' não instalada no servidor."
        )
    return EWSService(
        ews_url=ews_url or EWS_URL,
        verify_ssl=EWS_VERIFY_SSL if verify_ssl is None else verify_ssl,
        username=username,
        password=password,
        timeout=int(os.getenv("EWS_TIMEOUT", "30")),
    )


def _resolve_email_runtime_config(ponto: Optional[str]):
    if ponto:
        user_cfg = get_runtime_config(str(ponto))
        if user_cfg and user_cfg.monitored_targets:
            return user_cfg
    return get_default_runtime_config()


def _resolve_ews_for_ponto(ponto: Optional[str]):
    cfg = _resolve_email_runtime_config(ponto)
    return _get_ews_service(ews_url=cfg.ews_url, verify_ssl=cfg.verify_ssl), cfg


def require_email_admin_config_access(
    request: Request,
    session: SessionData = Depends(require_session),
) -> SessionData:
    """Mesma regra de acesso da página admin/configuracoes."""
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
        "Config Exchange global negada ponto=%s ip=%s path=%s",
        session.ponto,
        session.ip,
        request.url.path,
    )
    raise HTTPException(
        status_code=403,
        detail="Sem permissão para alterar configurações globais de e-mail.",
    )

def _get_os_folder_path(ano: int, id: int) -> Optional[str]:
    """Helper para localizar a pasta da OS na rede (Duplicado de os_routes para evitar circularidade)."""
    if id >= 5000:
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_Papelaria_{ano}"
    else:
        base_path = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"
        
    os_pattern = os.path.join(base_path, f"{id:05d}*")
    
    # Check fallback for local testing
    if not os.path.exists(r"\\redecamara\DfsData"):
        local_path = os.path.abspath(f"storage_test/{ano}/{id}")
        if os.path.exists(local_path):
            return local_path

    found = glob.glob(os_pattern)
    if found:
        return found[0]
    return None

def _get_latest_pdf(os_path: str) -> Optional[str]:
    """Busca o PDF mais recente na pasta Sefoc dentro da OS."""
    sefoc_path = os.path.join(os_path, "Sefoc")
    if not os.path.exists(sefoc_path):
        return None
        
    pdfs = glob.glob(os.path.join(sefoc_path, "*.pdf"))
    if not pdfs:
        return None
        
    # Retorna o mais recente
    return max(pdfs, key=os.path.getmtime)

def _get_proof_template_content(os_id: int) -> str:
    """Retorna o conteúdo do template HTML adequado (Prova SP ou Prova OS)."""
    from services.email_template_service import get_rendered_html, proof_template_id

    return get_rendered_html(proof_template_id(os_id), {"nr_os": os_id})


def _build_pt_html_preview_payload(
    os_id: int,
    ano: int,
    *,
    versao: Optional[str] = None,
) -> dict:
    """Monta resposta de prévia para envio de problemas técnicos (modelo ativo)."""
    from services.email_dispatch_type_service import resolve_pt_versao_for_dispatch
    from services.email_template_model_service import render_pt_email, resolve_pt_send_plan

    resolved_versao = (versao or "").strip() or resolve_pt_versao_for_dispatch(os_id, ano)
    produto = "Produto"
    titulo = ""
    try:
        q_det = """
            SELECT Titulo, TipoPublicacaoLink
            FROM tabDetalhesServico
            WHERE NroProtocoloLinkDet = %(os)s AND AnoProtocoloLinkDet = %(ano)s
        """
        res_det = db.execute_query(q_det, {"os": os_id, "ano": ano})
        if res_det:
            produto = res_det[0].get("TipoPublicacaoLink") or "Produto"
            titulo = res_det[0].get("Titulo") or ""
    except Exception as e_det:
        logger.warning("Erro buscando detalhes OS preview email PT: %s", e_det)

    pt_plan = resolve_pt_send_plan()
    variables = {
        "nr_os": os_id,
        "ano": ano,
        "versao": resolved_versao,
        "produto": produto,
        "titulo": titulo,
    }
    _, final_html = render_pt_email(ano, os_id, variables, plan=pt_plan)

    try:
        from services.activation_email_service import resolve_link_web_base
        from services.pt_report_html_service import absolutize_api_media_urls_for_preview

        final_html = absolutize_api_media_urls_for_preview(
            final_html,
            resolve_link_web_base(),
        )
    except Exception as exc_preview:
        logger.warning("Não foi possível absolutizar URLs de mídia na prévia PT: %s", exc_preview)

    return {
        "html": final_html,
        "versao": resolved_versao,
        "data": datetime.now().strftime("%Y-%m-%d"),
        "type": "pt",
        "send_mode": pt_plan.get("variante") or "portal",
        "use_inline_body": bool(pt_plan.get("use_inline_body")),
        "template_model_id": (pt_plan.get("model") or {}).get("id"),
    }


def _build_proof_html_preview_payload(
    os_id: int,
    ano: int,
    *,
    versao: Optional[str] = None,
) -> dict:
    """Monta prévia de envio de prova usando o modelo ativo (tabEmailTemplateModel)."""
    from services.email_template_model_service import (
        has_prova_web_ready_for_send,
        render_proof_email,
        resolve_proof_send_plan,
    )

    resolved_versao = (versao or "").strip() or "1"
    proof_plan = resolve_proof_send_plan(os_id)
    use_attachment = bool(proof_plan.get("use_attachment"))
    prova_web_ready = False
    if proof_plan.get("prefer_prova_web") and not use_attachment:
        prova_web_ready, prova_web_versao = has_prova_web_ready_for_send(ano, os_id)
        if prova_web_ready and prova_web_versao:
            resolved_versao = prova_web_versao
    send_mode = (
        "anexo"
        if use_attachment
        else ("prova_web" if prova_web_ready else "portal")
    )

    solicitante = "Solicitante"
    produto = "Produto"
    try:
        q_dados = """
            SELECT
                p.NomeUsuario as solicitante,
                d.TipoPublicacaoLink as produto
            FROM tabProtocolos p
            LEFT JOIN tabDetalhesServico d ON
                p.NroProtocolo = d.NroProtocoloLinkDet AND
                p.AnoProtocolo = d.AnoProtocoloLinkDet
            WHERE p.NroProtocolo = %(os)s AND p.AnoProtocolo = %(ano)s
        """
        res_dados = db.execute_query(q_dados, {"os": os_id, "ano": ano})
        if res_dados:
            solicitante = res_dados[0].get("solicitante") or solicitante
            produto = res_dados[0].get("produto") or produto
    except Exception as e_det:
        logger.warning("Erro buscando detalhes OS preview email prova: %s", e_det)

    proof_link = ""
    if not use_attachment:
        try:
            from services.activation_email_service import resolve_link_web_base

            host = resolve_link_web_base().rstrip("/")
            preview_kind = "prova-web-preview" if send_mode == "prova_web" else "preview"
            proof_link = f"{host}/portal/prova/{preview_kind}?os={os_id}&ano={ano}"
        except Exception as exc_link:
            logger.warning("Link de prévia do portal de prova indisponível: %s", exc_link)
            proof_link = "https://exemplo.portal/prova/preview"

    variables = {
        "nr_os": os_id,
        "ano": ano,
        "versao": resolved_versao,
        "produto": produto,
        "solicitante": solicitante,
        "link": proof_link,
        "jobname": str(os_id),
        "ordernumber": str(ano),
    }
    _, final_html = render_proof_email(
        os_id,
        variables,
        proof_link=proof_link,
        use_attachment=use_attachment,
        plan=proof_plan,
    )

    found_pdf_name = None
    debug_path = "Caminho não determinado"
    try:
        import os as _os

        os_path = _get_os_folder_path(ano, os_id)
        if os_path:
            sefoc_path = _os.path.join(os_path, "Sefoc")
            debug_path = sefoc_path
            latest_pdf = _get_latest_pdf(os_path)
            if latest_pdf:
                found_pdf_name = _os.path.basename(latest_pdf)
        else:
            if os_id >= 5000:
                base = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_Papelaria_{ano}"
            else:
                base = fr"\\redecamara\DfsData\CGraf\Sefoc\Deputados\{ano}\Deputados_{ano}"
            debug_path = fr"{base}\{os_id:05d}*\Sefoc"
    except Exception as e_path:
        debug_path = f"Erro ao calcular caminho: {e_path}"

    return {
        "html": final_html,
        "versao": resolved_versao,
        "data": datetime.now().strftime("%Y-%m-%d"),
        "type": "proof",
        "detected_attachment": found_pdf_name,
        "debug_path": debug_path,
        "send_mode": send_mode,
        "anexar_pdf": use_attachment,
        "template_model_id": (proof_plan.get("model") or {}).get("id"),
    }


def _build_timbrado_digital_html_preview_payload(
    os_id: int,
    ano: int,
) -> dict:
    """Prévia de envio Timbrado A4 Digital (modelo + 2 DOCX)."""
    from services.email_template_model_service import (
        render_timbrado_digital_email,
        resolve_timbrado_digital_send_plan,
    )
    from services.proof_files_service import resolve_timbrado_digital_docx_paths

    plan = resolve_timbrado_digital_send_plan()
    solicitante = "Solicitante"
    produto = "Produto"
    try:
        q_dados = """
            SELECT
                p.NomeUsuario as solicitante,
                d.TipoPublicacaoLink as produto
            FROM tabProtocolos p
            LEFT JOIN tabDetalhesServico d ON
                p.NroProtocolo = d.NroProtocoloLinkDet AND
                p.AnoProtocolo = d.AnoProtocoloLinkDet
            WHERE p.NroProtocolo = %(os)s AND p.AnoProtocolo = %(ano)s
        """
        res_dados = db.execute_query(q_dados, {"os": os_id, "ano": ano})
        if res_dados:
            solicitante = res_dados[0].get("solicitante") or solicitante
            produto = res_dados[0].get("produto") or produto
    except Exception as e_det:
        logger.warning("Erro buscando detalhes OS preview Timbrado Digital: %s", e_det)

    variables = {
        "nr_os": os_id,
        "ano": ano,
        "produto": produto,
        "solicitante": solicitante,
        "versao": "1",
        "link": "",
        "jobname": str(os_id),
        "ordernumber": str(ano),
    }
    _, final_html = render_timbrado_digital_email(variables, plan=plan)

    attachments_meta: list[dict] = []
    debug_path = "Caminho não determinado"
    try:
        resolved = resolve_timbrado_digital_docx_paths(ano, os_id)
        attachments_meta = list(resolved.get("files") or [])
        import os as _os

        os_path = _get_os_folder_path(ano, os_id)
        debug_path = _os.path.join(os_path, "Sefoc") if os_path else debug_path
    except Exception as exc:
        logger.warning("DOCX Timbrado Digital indisponíveis na prévia: %s", exc)
        debug_path = str(exc)

    return {
        "html": final_html,
        "versao": "1",
        "data": datetime.now().strftime("%Y-%m-%d"),
        "type": "timbrado_digital",
        "detected_attachment": ", ".join(f["name"] for f in attachments_meta) or None,
        "timbrado_attachments": attachments_meta,
        "debug_path": debug_path,
        "send_mode": "anexo",
        "anexar_pdf": True,
        "template_model_id": (plan.get("model") or {}).get("id"),
    }

# --- PYDANTIC MODELS ---

class MarkReadRequest(BaseModel):
    email_entry_id: str
    category: Optional[str] = "Lido e Desconsiderado"

class AndamentoRequest(BaseModel):
    os: int
    ano: int
    situacao: str
    setor: str
    observacao: str
    ponto: str
    email_entry_id: Optional[str] = None

class EmailSendRequest(BaseModel):
    to: List[str]
    subject: str
    html: str

class EmailPTRequest(BaseModel):
    os: int
    ano: int
    versao: Optional[str] = ""
    to: List[str]
    ponto: str
    type: str = "pt" # pt | proof | apogee | reply
    email_entry_id: Optional[str] = None # Para reply / Apogee
    proof_filename: Optional[str] = None
    html: Optional[str] = None  # Corpo editado na prévia ou e-mail Apogee
    subject: Optional[str] = None  # Assunto do e-mail Apogee
    register_andamento: bool = False


class PendenciaAndamentoRequest(BaseModel):
    os: int
    ano: int
    versao: Optional[str] = ""
    ponto: str
    type: str = "pt"
    proof_filename: Optional[str] = None
    send_mode: Optional[str] = None
    to: List[str] = Field(default_factory=list)


class SaveEmailRequest(BaseModel):
    email_entry_id: str
    os: int
    ano: int


class EmailMonitoredFolder(BaseModel):
    id: str = ""
    name: str
    parent: str = "Inbox"


class EmailMonitoredTarget(BaseModel):
    mailbox: str
    folders: List[EmailMonitoredFolder]


class EmailConnectRequest(BaseModel):
    ews_url: str = DEFAULT_EWS_URL
    verify_ssl: bool = DEFAULT_VERIFY_SSL
    extra_mailboxes: List[str] = Field(default_factory=list)


class EmailFoldersRequest(BaseModel):
    ews_url: str = DEFAULT_EWS_URL
    verify_ssl: bool = DEFAULT_VERIFY_SSL
    mailbox: str
    parent: str = "inbox"


class EmailConfigSaveRequest(BaseModel):
    monitored_targets: List[EmailMonitoredTarget] = Field(default_factory=list)
    send_routing: dict[str, Any] = Field(default_factory=dict)
    sent_folder_routing: dict[str, Any] = Field(default_factory=dict)
    config_version: int = 1


class EmailSendPlanRequest(BaseModel):
    os: int
    ano: int
    type: str = "pt"
    from_mailbox_hint: Optional[str] = None
    validate_folder: bool = False


class GalContactItem(BaseModel):
    name: str = ""
    email: str = ""
    cargo: str = ""
    departamento: str = ""


class GalResolveResponse(BaseModel):
    items: List[GalContactItem] = Field(default_factory=list)


# --- SERVICE DE E-MAIL (Integração EWS) ---

def _normalize_content_id(raw: str) -> str:
    return (raw or "").strip().strip("<>").lower()


def _routing_type_key(email_type: str) -> str:
    key = (email_type or "pt").strip().lower()
    if key in {"proof", "apogee", "reply", "timbrado_digital"}:
        return key
    return "pt"


def _resolve_send_plan(
    *,
    cfg,
    os_id: int,
    email_type: str,
    global_send_mailboxes: dict[str, str],
):
    type_key = _routing_type_key(email_type)
    # Remetente: sempre Contas de envio (OS < 5000 / ≥ 5000). by_type não sobrescreve From.
    global_default = (
        global_send_mailboxes.get("os_gte_5000")
        if os_id >= 5000
        else global_send_mailboxes.get("os_lt_5000")
    )
    legacy_default = (
        cfg.send_mailbox_os_gte_5000
        if os_id >= 5000
        else cfg.send_mailbox_os_lt_5000
    )
    selected_mailbox = str(global_default or "").strip()
    mailbox_source = "global" if selected_mailbox else "legacy"
    if not selected_mailbox:
        selected_mailbox = str(legacy_default or "").strip()
        mailbox_source = "legacy"

    sent_folder_routing = (
        cfg.sent_folder_routing if isinstance(cfg.sent_folder_routing, dict) else {}
    )
    by_mailbox = sent_folder_routing.get("by_mailbox")
    selected_folder = None
    folder_source = "legacy"
    if isinstance(by_mailbox, dict):
        mailbox_map = by_mailbox.get(selected_mailbox)
        if isinstance(mailbox_map, dict):
            candidate = mailbox_map.get(type_key)
            if isinstance(candidate, dict) and candidate.get("name"):
                selected_folder = {
                    "id": str(candidate.get("id") or "").strip(),
                    "name": str(candidate.get("name") or "").strip(),
                    "parent": str(candidate.get("parent") or "sentitems"),
                }
                folder_source = "v2"
    if not selected_folder:
        selected_folder = {
            "id": "",
            "name": "Saida de Provas" if type_key == "proof" else "Saida de Prob. Tec.",
            "parent": "sentitems",
        }
        folder_source = "legacy"

    return {
        "type": type_key,
        "mailbox": selected_mailbox,
        "mailbox_source": mailbox_source,
        "target_folder": selected_folder,
        "folder_source": folder_source,
    }


def _build_inbox_attachment_payload(all_atts: List[dict]):
    """
    Separa anexos reais (não-inline) e mapa cid -> índice (1-based na lista EWS completa).
    O índice é usado pelo endpoint /download e por imagens inline no corpo do e-mail.
    """
    display: List[dict] = []
    inline_images: dict[str, int] = {}
    for idx, att in enumerate(all_atts, start=1):
        if att.get("is_inline"):
            cid = _normalize_content_id(att.get("content_id") or "")
            if cid:
                inline_images[cid] = idx
        else:
            display.append(
                {
                    "name": att.get("name") or "Anexo",
                    "index": idx,
                }
            )
    return display, inline_images


def fetch_exchange_emails(ponto: Optional[str] = None):
    """
    Conecta ao Exchange via EWS e busca e-mails em pastas configuradas pelo usuário.
    """
    service, cfg = _resolve_ews_for_ponto(ponto)
    targets_cfg = cfg.monitored_targets or []
    if not targets_cfg:
        targets_cfg = get_default_runtime_config().monitored_targets

    emails_list = []
    sync_errors: List[str] = []
    
    try:
        for target_cfg in targets_cfg:
            mailbox = target_cfg.get("mailbox")
            folder_entries = target_cfg.get("folders") or []
            if not mailbox or not folder_entries:
                continue

            inbox_target = MailboxFolderTarget(
                mailbox=mailbox,
                folder_type="distinguished_inbox",
                folder_label="Inbox",
            )

            for folder_entry in folder_entries:
                folder_name = folder_entry.get("name")
                folder_id = (folder_entry.get("id") or "").strip()
                if not folder_name:
                    continue
                try:
                    if not folder_id:
                        folder_id = service.find_folder_id(inbox_target, folder_name)
                    if not folder_id:
                        logger.warning(
                            "Subpasta '%s' não encontrada em Inbox de '%s'",
                            folder_name,
                            mailbox,
                        )
                        continue

                    final_target = MailboxFolderTarget(
                        mailbox=mailbox,
                        folder_type="folder_id",
                        folder_label=folder_name,
                        folder_id=folder_id,
                    )

                    max_items = max(1, min(int(cfg.max_items_per_folder or 20), 100))
                    items = service.find_unread_messages(final_target, max_items=max_items)
                    if not cfg.only_unread:
                        # fallback futuro: método dedicado para lidos + não lidos
                        pass
                    
                    for item in items:
                        full_body = item.get('body', "")
                        att_list = []
                        inline_images: dict[str, int] = {}
                        
                        try:
                            details = service.get_message_details(item['item_id'])
                            full_body = details.get('body', full_body)
                            
                            att_list, inline_images = _build_inbox_attachment_payload(
                                details.get('attachments', [])
                            )
                                
                        except Exception as e_det:
                            logger.warning(f"Erro obtendo detalhes msg {item['item_id']}: {e_det}")
                            if item['has_attachments']:
                                att_list.append({"name": "Anexo (Erro Detalhes)", "index": 1})

                        emails_list.append({
                            "id": item['item_id'],          
                            "real_id": item['item_id'],     
                            "sender": item['sender_name'] or item['sender_email'],
                            "email": item['sender_email'],
                            "subject": item['subject'],
                            "preview": item['preview'],
                            "body": full_body,           
                            "date": item['date'],
                            "read": False,
                            "hasAttachment": bool(att_list) or item['has_attachments'],
                            "attachments": att_list,
                            "inline_images": inline_images,
                            "account": mailbox,
                            "folder": folder_name
                        })

                except Exception as folder_err:
                    msg = f"{mailbox} / {folder_name}: {folder_err}"
                    sync_errors.append(msg)
                    logger.error("Erro processando pasta %s de %s: %s", folder_name, mailbox, folder_err)

    except Exception as e:
        logger.error(f"Erro EWS Geral: {e}")
        sync_errors.append(str(e))

    if not emails_list and sync_errors:
        first = sync_errors[0]
        if "401" in first or "Unauthorized" in first:
            detail = (
                "O Exchange recusou a autenticação. Verifique a credencial técnica configurada "
                "no servidor ou confirme que a conta Windows da API tem permissão EWS. "
                f"Detalhe: {first}"
            )
        else:
            detail = (
                "Não foi possível sincronizar a caixa de entrada com o Exchange. "
                "Revise as pastas monitoradas e a credencial técnica do servidor. "
                f"Detalhe: {first}"
            )
        raise HTTPException(status_code=503, detail=detail)

    return emails_list


@router.get("/config")
def get_email_config(session: SessionData = Depends(require_session)):
    return get_public_config(str(session.ponto))


@router.post("/config/connect")
def connect_email_exchange(
    req: EmailConnectRequest,
    session: SessionData = Depends(require_email_admin_config_access),
):
    try:
        service = _get_ews_service(
            ews_url=req.ews_url,
            verify_ssl=req.verify_ssl,
        )
        candidates = list(DEFAULT_MAILBOX_CANDIDATES)
        for mailbox in req.extra_mailboxes:
            value = mailbox.strip().lower()
            if value and value not in candidates:
                candidates.append(value)
        mailboxes = service.list_accessible_mailboxes(extra_candidates=candidates)
        accessible = [item for item in mailboxes if item.get("accessible")]
        if not accessible:
            raise HTTPException(
                status_code=401,
                detail="Credenciais válidas, mas nenhuma caixa postal acessível foi encontrada.",
            )
        return {
            "success": True,
            "mailboxes": mailboxes,
            "primary": next(
                (item.get("address", "") for item in mailboxes if item.get("is_primary")),
                "",
            ),
        }
    except HTTPException:
        raise
    except Exception as exc:
        from resilience.http_errors import ews_http_exception

        raise ews_http_exception(exc) from exc


@router.post("/config/folders")
def list_email_folders(
    req: EmailFoldersRequest,
    session: SessionData = Depends(require_email_admin_config_access),
):
    try:
        service = _get_ews_service(
            ews_url=req.ews_url,
            verify_ssl=req.verify_ssl,
        )
        parent = (req.parent or "inbox").lower()
        if parent == "msgfolderroot":
            parent_target = MailboxFolderTarget(
                mailbox=req.mailbox,
                folder_type="distinguished_msgfolderroot",
                folder_label="msgfolderroot",
            )
            folders = service.list_child_folders(parent_target, deep=True)
        elif parent == "sentitems":
            parent_target = MailboxFolderTarget(
                mailbox=req.mailbox,
                folder_type="distinguished_sentitems",
                folder_label="SentItems",
            )
            folders = service.list_child_folders(parent_target, deep=True)
        else:
            parent_target = MailboxFolderTarget(
                mailbox=req.mailbox,
                folder_type="distinguished_inbox",
                folder_label="Inbox",
            )
            folders = service.list_child_folders(parent_target, deep=False)

        return {
            "mailbox": req.mailbox,
            "parent": parent,
            "folders": folders,
        }
    except HTTPException:
        raise
    except Exception as exc:
        from resilience.http_errors import ews_http_exception

        raise ews_http_exception(exc) from exc


@router.put("/config")
def save_email_config(
    req: EmailConfigSaveRequest,
    session: SessionData = Depends(require_email_admin_config_access),
):
    if not req.monitored_targets:
        raise HTTPException(status_code=400, detail="Selecione ao menos uma pasta para monitorar.")

    total_folders = sum(len(target.folders) for target in req.monitored_targets)
    if total_folders == 0:
        raise HTTPException(status_code=400, detail="Selecione ao menos uma pasta para monitorar.")

    defaults = get_default_runtime_config()
    try:
        saved = save_config(
            ponto=str(session.ponto),
            ews_url=defaults.ews_url,
            verify_ssl=defaults.verify_ssl,
            max_items_per_folder=defaults.max_items_per_folder,
            refresh_interval_sec=defaults.refresh_interval_sec,
            only_unread=defaults.only_unread,
            monitored_targets=[target.model_dump() for target in req.monitored_targets],
            send_mailbox_os_lt_5000=None,
            send_mailbox_os_gte_5000=None,
            send_routing=req.send_routing,
            sent_folder_routing=req.sent_folder_routing,
            config_version=req.config_version,
        )
        return {"success": True, "config": saved}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Erro ao salvar config Exchange: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/config/send-plan")
def get_email_send_plan(
    req: EmailSendPlanRequest,
    session: SessionData = Depends(require_email_admin_config_access),
):
    try:
        service, cfg = _resolve_ews_for_ponto(str(session.ponto))
        from services.email_template_service import get_global_send_mailboxes

        plan = _resolve_send_plan(
            cfg=cfg,
            os_id=req.os,
            email_type=req.type,
            global_send_mailboxes=get_global_send_mailboxes(),
        )
        if req.from_mailbox_hint:
            hinted = req.from_mailbox_hint.strip().lower()
            if hinted:
                plan["mailbox"] = hinted
                plan["mailbox_source"] = "hint"

        save_to_folder_id = None
        fallback_reason = None
        if req.validate_folder:
            try:
                target_folder = plan.get("target_folder") or {}
                folder_name = str(target_folder.get("name") or "").strip()
                if folder_name:
                    sent_target = MailboxFolderTarget(
                        mailbox=plan["mailbox"],
                        folder_type="distinguished_sentitems",
                        folder_label="SentItems",
                    )
                    save_to_folder_id = service.find_folder_id(sent_target, folder_name)
                    if not save_to_folder_id:
                        fallback_reason = f"Pasta '{folder_name}' não encontrada na caixa '{plan['mailbox']}'."
            except Exception as exc:
                fallback_reason = str(exc)

        return {
            "success": True,
            "plan": plan,
            "save_to_folder_id": save_to_folder_id,
            "fallback_reason": fallback_reason,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Erro ao resolver plano de envio de email: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/gal/resolve", response_model=GalResolveResponse)
def resolve_gal_contacts(
    q: str = Query(..., min_length=2, max_length=255),
    session: SessionData = Depends(require_session),
) -> GalResolveResponse:
    """Busca contatos no catálogo global do Exchange (GAL)."""
    if not EWS_AVAILABLE:
        raise HTTPException(
            status_code=500,
            detail="Serviço de E-mail indisponível no servidor.",
        )
    try:
        service, _ = _resolve_ews_for_ponto(str(session.ponto))
        raw_items = service.resolve_names(q.strip())
        items = [
            GalContactItem(
                name=str(item.get("name") or ""),
                email=str(item.get("email") or ""),
                cargo=str(item.get("cargo") or ""),
                departamento=str(item.get("departamento") or ""),
            )
            for item in raw_items
            if item.get("email")
        ]
        return GalResolveResponse(items=items)
    except EWSUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Erro ao resolver contato GAL (q=%s): %s", q, exc)
        raise HTTPException(
            status_code=500,
            detail="Falha ao consultar o catálogo global do Exchange.",
        ) from exc


@router.get("/inbox")
def get_email_inbox(session: SessionData = Depends(require_session)):
    try:
        return fetch_exchange_emails(str(session.ponto))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching emails: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _safe_filename(value: str, fallback: str = "email") -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return fallback
    invalid = '<>:"/\\|?*'
    for ch in invalid:
        cleaned = cleaned.replace(ch, "_")
    cleaned = cleaned.replace("\r", " ").replace("\n", " ")
    cleaned = " ".join(cleaned.split())
    return cleaned[:120] or fallback


@router.post("/save-mht")
def save_email_as_mht(
    request: SaveEmailRequest,
    session: SessionData = Depends(require_session),
):
    """
    Salva o e-mail completo no formato .mht dentro da subpasta Sefoc da OS.
    """
    try:
        from services.os_protocolo_guard import OsProtocoloGuardError, require_protocolo_mysql

        try:
            request.ano = require_protocolo_mysql(request.os, request.ano)
        except OsProtocoloGuardError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        os_path = _get_os_folder_path(request.ano, request.os)
        if not os_path:
            raise HTTPException(status_code=404, detail="Pasta da OS não encontrada.")

        sefoc_path = os.path.join(os_path, "Sefoc")
        os.makedirs(sefoc_path, exist_ok=True)

        service, _cfg = _resolve_ews_for_ponto(str(session.ponto))
        details = service.get_message_details(request.email_entry_id)
        mime_content = service.get_message_mime_content(request.email_entry_id)

        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        subject_part = _safe_filename(details.get("subject", ""), fallback="email")
        filename = f"{request.os:05d}_{request.ano}_{stamp}_{subject_part}.mht"
        output_path = os.path.join(sefoc_path, filename)

        with open(output_path, "wb") as f:
            f.write(mime_content)

        return {
            "success": True,
            "filename": filename,
            "path": output_path,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro ao salvar email .mht: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/download")
def download_attachment(
    entry_id: str,
    att_index: int,
    session: SessionData = Depends(require_session),
):
    """
    Download de anexo.
    OBS: att_index legado (1-based index). No EWS precisamos do AttachmentId.
    Como o frontend manda att_index baseado na ordem da lista 'attachments',
    precisamos baixar o item, pegar a lista de Attachments e usar o índice.
    """
    try:
        service, _cfg = _resolve_ews_for_ponto(str(session.ponto))
        
        # 1. Pegar detalhes para obter AttachmentIds atualizados
        details = service.get_message_details(entry_id)
        atts = details.get('attachments', [])
        
        if not atts:
             raise HTTPException(status_code=404, detail="Email sem anexos.")
             
        # Index frontend 1-based -> 0-based
        idx = att_index - 1
        if idx < 0 or idx >= len(atts):
             raise HTTPException(status_code=404, detail="Anexo não encontrado (índice inválido).")
             
        target_att = atts[idx]
        att_id = target_att['attachment_id']
        name = target_att['name']
        
        # 2. Baixar conteúdo
        name_found, content_bytes = service.get_attachment_content(att_id)
        
        tmp_path = os.path.join(tempfile.gettempdir(), name_found)
        with open(tmp_path, "wb") as f:
            f.write(content_bytes)

        media_type = mimetypes.guess_type(name_found)[0] or "application/octet-stream"
            
        return FileResponse(path=tmp_path, filename=name_found, media_type=media_type)

    except Exception as e:
        logger.error(f"Download Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pendencias")
def get_pendencias(
    setor: str = "SEFOC",
    session: SessionData = Depends(require_session),
):
    try:
        from services.email_apogee_pendencias_service import fetch_apogee_email_pendencias
        from services.email_pendencias_service import (
            fetch_email_pendencias,
            merge_pendencias_lists,
        )

        db_items = fetch_email_pendencias(setor)
        apogee_items: List[dict] = []
        try:
            service, _cfg = _resolve_ews_for_ponto(str(session.ponto))
            apogee_items = fetch_apogee_email_pendencias(service)
        except Exception as apogee_err:
            logger.error("Error fetching Apogee pendencias: %s", apogee_err)

        return merge_pendencias_lists(db_items, apogee_items)
    except Exception as e:
        logger.error(f"Error fetching pendencias: {e}")
        return []

@router.get("/notification_status")
def get_notification_status(
    setor: str = "SEFOC",
    session: SessionData = Depends(require_session),
):
    """
    Retorna status de notificações: quantidade de emails e pendências
    """
    try:
        # Count de emails processáveis
        inbox_count = 0
        try:
            emails = fetch_exchange_emails(str(session.ponto))
            inbox_count = len(emails) if emails else 0
        except Exception as e:
            logger.error(f"Error counting inbox emails: {e}")
            inbox_count = 0
        
        # Count de pendências (banco + Apogee)
        from services.email_apogee_pendencias_service import count_apogee_email_pendencias
        from services.email_pendencias_service import count_all_email_pendencias

        apogee_count = 0
        try:
            service, _cfg = _resolve_ews_for_ponto(str(session.ponto))
            apogee_count = count_apogee_email_pendencias(service)
        except Exception as apogee_err:
            logger.error("Error counting Apogee pendencias: %s", apogee_err)

        pendencias_count = count_all_email_pendencias(setor, apogee_count)

        return {
            "inbox_count": inbox_count,
            "pendencias_count": pendencias_count,
            "last_check": datetime.now().strftime("%H:%M:%S")
        }
    except Exception as e:
        logger.error(f"Error getting notification status: {e}")
        return {
            "inbox_count": 0,
            "pendencias_count": 0,
            "last_check": datetime.now().strftime("%H:%M:%S")
        }


@router.post("/andamento")
def create_andamento(
    request: AndamentoRequest,
    session: SessionData = Depends(require_session),
):
    """
    Cria um novo andamento para uma OS específica
    """
    logger.info(f"Creating andamento for OS {request.os}/{request.ano}")

    from services.os_protocolo_guard import OsProtocoloGuardError, require_protocolo_mysql

    try:
        request.ano = require_protocolo_mysql(request.os, request.ano)
    except OsProtocoloGuardError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    
    obs_formatada = format_andamento_obs(request.observacao or "")
    ponto_formatado = format_ponto(request.ponto)

    def transaction_logic(cursor):
        # 1. Zerar UltimoStatus dos registros anteriores
        cursor.execute(
            "UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %(os)s AND AnoProtocoloLink = %(ano)s",
            {'os': request.os, 'ano': request.ano}
        )
        
        # 2. Calcular próximo CodStatus
        # Formato: 00000AAAA-00 (ProtocoloAno-Seq)
        base_prefix = f"{request.os:05d}{request.ano}-"
        cursor.execute(
            f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'"
        )
        res = cursor.fetchone()
        
        next_seq = 1
        if res and res['max_cod']:
            try:
                # Extrai a sequencia final depois do traço da string CodStatus
                # Ex: 123452024-05 -> 05
                existing_suffix = res['max_cod'].split('-')[-1]
                next_seq = int(existing_suffix) + 1
            except ValueError:
                next_seq = 1
                
        new_cod = f"{base_prefix}{next_seq:02d}"
        
        # 3. Inserir novo andamento
        cursor.execute(
            """INSERT INTO tabAndamento 
               (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto) 
               VALUES (%(cod)s, %(os)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(ponto)s)""",
            {
                'cod': new_cod, 
                'os': request.os, 
                'ano': request.ano, 
                'situacao': request.situacao, 
                'setor': request.setor,
                'obs': obs_formatada,
                'ponto': ponto_formatado
            }
        )
        log_andamento_added(
            cursor,
            nro=request.os,
            ano=request.ano,
            cod_status=new_cod,
            situacao=request.situacao,
            setor=request.setor,
            obs=obs_formatada,
            ponto=ponto_formatado,
            origem="EMAIL",
        )
        return {"success": True, "cod_status": new_cod}
    
    try:
        result = db.execute_transaction([transaction_logic])[0]
        logger.info(f"Andamento created successfully: {result}")

        from routers.realtime import broadcast_os_system_update

        broadcast_os_system_update(
            request.os,
            request.ano,
            "history_added",
            setor=request.setor,
            situacao=request.situacao,
            origem="email",
        )

        from .mdb_writer import dispatch_mdb_sync, sync_andamento_from_mysql_to_mdb

        dispatch_mdb_sync(
            "email_andamento",
            lambda: sync_andamento_from_mysql_to_mdb(
                result["cod_status"], request.os, request.ano
            ),
            cod_status=result["cod_status"],
            nro=request.os,
            ano=request.ano,
        )

        # Marcar email como lido e categorizar no Outlook via EWS
        outlook_success = True
        outlook_error = None
        
        if request.email_entry_id:
            try:
                service, _cfg = _resolve_ews_for_ponto(str(session.ponto))
                service.mark_as_read_and_categorize(
                    item_id=request.email_entry_id,
                    category_text="Pedido atendido (lido e proc.)"
                )
                logger.info(f"Email {request.email_entry_id} marcado como lido e categorizado via EWS")
            except Exception as ews_ex:
                outlook_success = False
                outlook_error = str(ews_ex)
                logger.error(f"Error updating EWS email: {ews_ex}")
        
        # Adicionar informação sobre o Outlook na resposta
        result['outlook_updated'] = outlook_success
        if not outlook_success and outlook_error:
            result['outlook_error'] = outlook_error
            
        return result
        
    except Exception as e:
        logger.error(f"Error creating andamento: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/mark-read")
def mark_email_read(
    request: MarkReadRequest,
    session: SessionData = Depends(require_session),
):
    """
    Marca um e-mail como lido e adiciona categoria no Outlook, sem registrar andamento.
    """
    try:
        service, _cfg = _resolve_ews_for_ponto(str(session.ponto))
        service.mark_as_read_and_categorize(
            item_id=request.email_entry_id,
            category_text=request.category
        )
        logger.info(f"Email {request.email_entry_id} marcado como lido (sem andamento).")
        return {"success": True, "message": "E-mail marcado como lido"}
    except Exception as e:
        logger.error(f"Error marking email read: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send")
def send_email(
    request: EmailSendRequest,
    session: SessionData = Depends(require_session),
):
    """
    Envia e-mail via EWS
    """
    try:
        service, _cfg = _resolve_ews_for_ponto(str(session.ponto))
        service.send_email(
            to=request.to,
            subject=request.subject,
            html_body=request.html
        )
        
        logger.info(f"Email sent successfully to {request.to}")
        return {"success": True, "message": "E-mail enviado com sucesso"}
        
    except Exception as e:
        logger.error(f"Send Email Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/os/{ano}/{os}/proof-files")
def list_os_proof_files(
    ano: int,
    os: int,
    session: SessionData = Depends(require_session),
):
    """Lista PDFs disponíveis em Sefoc/ para seleção no envio de prova (sem expor UNC)."""
    from services.proof_files_service import list_proof_pdf_files

    return list_proof_pdf_files(ano, os)


def _pendencia_andamento_meta(
    email_type: str,
    nova_versao: str,
    *,
    proof_file_basename: str = "",
    send_mode_label: str = "",
    to: Optional[List[str]] = None,
) -> tuple[str, str]:
    if email_type == "proof":
        recipients = [str(a).strip() for a in (to or []) if str(a).strip()]
        lines = [f"P{nova_versao} enviada para:"]
        if recipients:
            lines.extend(f"- {addr}" for addr in recipients)
        else:
            lines.append("- (sem destinatários)")
        return "\n".join(lines), "Aguard. Aprovação"
    if email_type == "timbrado_digital":
        recipients = [str(a).strip() for a in (to or []) if str(a).strip()]
        lines = ["Timbrado Digital enviado para:"]
        if recipients:
            lines.extend(f"- {addr}" for addr in recipients)
        else:
            lines.append("- (sem destinatários)")
        return "\n".join(lines), "Aguard. Aprovação"
    if email_type == "reply":
        return "Resposta enviada por e-mail", "Pendência Usuário"
    if email_type == "apogee":
        if nova_versao:
            return f"E-mail Apogee v{nova_versao} encaminhado", "Pendência Usuário"
        return "E-mail Apogee encaminhado", "Pendência Usuário"
    return f"PT{nova_versao} enviado", "Pendência Usuário"


def _register_pendencia_email_andamento(
    *,
    os: int,
    ano: int,
    ponto: str,
    email_type: str,
    nova_versao: str,
    proof_file_basename: str = "",
    send_mode_label: str = "",
    to: Optional[List[str]] = None,
) -> dict:
    obs, situacao_andamento = _pendencia_andamento_meta(
        email_type,
        nova_versao,
        proof_file_basename=proof_file_basename,
        send_mode_label=send_mode_label,
        to=to,
    )
    obs_formatada = format_andamento_obs(obs)
    ponto_formatado = format_ponto(ponto)

    def transaction_andamento(cursor):
        cursor.execute(
            "UPDATE tabAndamento SET UltimoStatus = 0 WHERE NroProtocoloLink = %(os)s AND AnoProtocoloLink = %(ano)s",
            {"os": os, "ano": ano},
        )

        base_prefix = f"{os:05d}{ano}-"
        cursor.execute(
            f"SELECT MAX(CodStatus) as max_cod FROM tabAndamento WHERE CodStatus LIKE '{base_prefix}%'"
        )
        res = cursor.fetchone()

        next_seq = 1
        if res and res["max_cod"]:
            try:
                existing_suffix = res["max_cod"].split("-")[-1]
                next_seq = int(existing_suffix) + 1
            except ValueError:
                next_seq = 1

        new_cod = f"{base_prefix}{next_seq:02d}"

        cursor.execute(
            """INSERT INTO tabAndamento
               (CodStatus, NroProtocoloLink, AnoProtocoloLink, SituacaoLink, SetorLink, `Data`, UltimoStatus, `Observaçao`, Ponto)
               VALUES (%(cod)s, %(os)s, %(ano)s, %(situacao)s, %(setor)s, NOW(), 1, %(obs)s, %(ponto)s)""",
            {
                "cod": new_cod,
                "os": os,
                "ano": ano,
                "situacao": situacao_andamento,
                "setor": "SEFOC",
                "obs": obs_formatada,
                "ponto": ponto_formatado,
            },
        )
        log_andamento_added(
            cursor,
            nro=os,
            ano=ano,
            cod_status=new_cod,
            situacao=situacao_andamento,
            setor="SEFOC",
            obs=obs_formatada,
            ponto=ponto_formatado,
            origem="EMAIL",
        )
        return {
            "success": True,
            "cod_status": new_cod,
            "obs": obs_formatada,
            "ponto": ponto_formatado,
            "situacao": situacao_andamento,
            "setor": "SEFOC",
        }

    andamento_result = db.execute_transaction([transaction_andamento])[0]
    logger.info("Andamento created for pendencia email: %s", andamento_result)

    from routers.realtime import broadcast_os_system_update

    broadcast_os_system_update(
        os,
        ano,
        "history_added",
        setor=andamento_result.get("setor"),
        situacao=andamento_result.get("situacao"),
        origem="email",
    )

    from .mdb_writer import dispatch_mdb_sync, sync_andamento_from_mysql_to_mdb

    dispatch_mdb_sync(
        "email_pt_andamento",
        lambda: sync_andamento_from_mysql_to_mdb(
            andamento_result["cod_status"], os, ano
        ),
        cod_status=andamento_result["cod_status"],
        nro=os,
        ano=ano,
    )
    return andamento_result


@router.post("/pendencia-andamento")
def register_pendencia_andamento(
    request: PendenciaAndamentoRequest,
    session: SessionData = Depends(require_session),
):
    """Registra andamento após envio de e-mail na aba Pendências (ação confirmada pelo usuário)."""
    try:
        email_type = (request.type or "pt").strip()
        nova_versao = (request.versao or "").strip()
        if email_type != "apogee":
            nova_versao = nova_versao or "1"
        proof_file_basename = (request.proof_filename or "").strip()
        send_mode_label = (request.send_mode or "").strip()
        if email_type == "proof" and not send_mode_label:
            send_mode_label = "anexo" if proof_file_basename else "portal"

        result = _register_pendencia_email_andamento(
            os=request.os,
            ano=request.ano,
            ponto=request.ponto or str(session.ponto),
            email_type=email_type,
            nova_versao=nova_versao,
            proof_file_basename=proof_file_basename,
            send_mode_label=send_mode_label,
            to=list(request.to or []),
        )
        return result
    except Exception as e:
        logger.error("Error registering pendencia andamento: %s", e)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/send-pt")
def send_pt_email(request: EmailPTRequest, session: SessionData = Depends(require_session)):
    """
    Envia e-mail de Problemas Técnicos usando HTML salvo no banco de dados via EWS
    """
    try:
        from services.email_dispatch_type_service import resolve_email_dispatch_type

        email_type = (request.type or "pt").strip()
        # Pendência Apogee: type explícito ou e-mail de origem com corpo informado
        if email_type == "apogee" or (
            request.email_entry_id
            and (request.type or "").strip() != "reply"
            and (request.html or "").strip()
        ):
            email_type = "apogee"
        elif email_type == "proof" and resolve_email_dispatch_type(request.os, request.ano) == "pt":
            logger.info(
                "Tipo de envio corrigido de prova para PT (OS %s/%s) com base no andamento",
                request.os,
                request.ano,
            )
            email_type = "pt"
        elif email_type in ("proof", "pt") and resolve_email_dispatch_type(
            request.os, request.ano
        ) == "timbrado_digital":
            logger.info(
                "Tipo de envio corrigido para Timbrado Digital (OS %s/%s) com base na observação",
                request.os,
                request.ano,
            )
            email_type = "timbrado_digital"

        # --- PREPARAÇÃO DE DADOS (COMUM) ---
        proof_file_basename = ""
        send_mode_label = ""
        nova_versao = (request.versao or "").strip()
        if email_type != "apogee":
            nova_versao = nova_versao or "1"
        email_html = ""
        assunto = ""
        attachments_to_send = []  # Lista de paths locais para anexar
        apogee_inline_images: list[tuple[str, bytes, str, str]] = []

        if email_type == "apogee":
            from security.html_sanitize import sanitize_html_snapshot
            from services.email_apogee_pendencias_service import clean_apogee_email_body

            service_apogee, _cfg_apogee = _resolve_ews_for_ponto(str(session.ponto))
            body_html = (request.html or "").strip()
            subject_line = (request.subject or "").strip()
            apogee_details: dict = {}

            if request.email_entry_id:
                try:
                    apogee_details = service_apogee.get_message_details(request.email_entry_id)
                    ews_body = (apogee_details.get("body") or "").strip()
                    ews_subject = (apogee_details.get("subject") or "").strip()
                    if ews_body:
                        body_html = ews_body
                    if ews_subject:
                        subject_line = ews_subject
                    from services.email_apogee_pendencias_service import (
                        collect_apogee_inline_images_for_send,
                    )

                    apogee_inline_images = collect_apogee_inline_images_for_send(
                        service_apogee,
                        apogee_details,
                    )
                    logger.info(
                        "Corpo Apogee carregado via EWS para %s (%s caracteres, %s inline)",
                        request.email_entry_id,
                        len(body_html),
                        len(apogee_inline_images),
                    )
                except Exception as exc:
                    logger.warning(
                        "Falha ao obter corpo Apogee via EWS (%s): %s",
                        request.email_entry_id,
                        exc,
                    )

            if not body_html:
                raise HTTPException(
                    status_code=400,
                    detail="Corpo do e-mail Apogee não informado.",
                )
            body_html = clean_apogee_email_body(body_html, subject_line)
            safe_html = sanitize_html_snapshot(body_html) or body_html
            if not safe_html.strip():
                raise HTTPException(
                    status_code=400,
                    detail="Corpo do e-mail Apogee inválido.",
                )
            email_html = safe_html
            assunto = subject_line or (
                f"OS {request.os}/{str(request.ano)[-2:]}"
            )
            logger.info(
                "Envio Apogee OS %s/%s com corpo do e-mail original (%s caracteres)",
                request.os,
                request.ano,
                len(email_html),
            )
        elif email_type == "proof":
            from services.email_template_model_service import (
                render_proof_email,
                resolve_prova_web_link_for_send,
                resolve_proof_send_plan,
            )
            from services.proof_files_service import (
                extract_prova_version_from_filename,
                resolve_proof_pdf_path,
                validate_proof_pdf_size,
            )

            plan = resolve_proof_send_plan(request.os)
            use_attachment = bool(plan.get("use_attachment"))
            prefer_prova_web = bool(plan.get("prefer_prova_web"))

            proof_link = ""
            prova_web_link_used = False
            if prefer_prova_web and not use_attachment:
                proof_link, prova_web_versao = resolve_prova_web_link_for_send(
                    request.ano,
                    request.os,
                    ponto_envio=str(session.ponto),
                )
                if proof_link:
                    nova_versao = prova_web_versao or nova_versao
                    prova_web_link_used = True
                    send_mode_label = "prova_web"
                    logger.info(
                        "Prova: envio priorizando link de Prova WEB (modelo id=%s, OS %s/%s)",
                        (plan.get("model") or {}).get("id"),
                        request.os,
                        request.ano,
                    )

            if not prova_web_link_used:
                if not (request.proof_filename or "").strip():
                    raise HTTPException(
                        status_code=400,
                        detail="Selecione o PDF de prova que será enviado ao cliente.",
                    )

                pdf_path = resolve_proof_pdf_path(
                    request.ano,
                    request.os,
                    request.proof_filename,
                )
                proof_file_basename = os.path.basename(pdf_path)
                parsed_ver = extract_prova_version_from_filename(proof_file_basename)
                if parsed_ver is not None:
                    nova_versao = str(parsed_ver)
                else:
                    nova_versao = (request.versao or "").strip() or "1"

            q_dados = """
                SELECT
                    p.NomeUsuario as solicitante,
                    d.TipoPublicacaoLink as produto
                FROM tabProtocolos p
                LEFT JOIN tabDetalhesServico d ON
                    p.NroProtocolo = d.NroProtocoloLinkDet AND
                    p.AnoProtocolo = d.AnoProtocoloLinkDet
                WHERE p.NroProtocolo = %(os)s AND p.AnoProtocolo = %(ano)s
            """
            res_dados = db.execute_query(q_dados, {"os": request.os, "ano": request.ano})
            solicitante = "Solicitante"
            produto = "Produto"
            if res_dados:
                solicitante = res_dados[0].get("solicitante") or "Solicitante"
                produto = res_dados[0].get("produto") or "Produto"

            if use_attachment:
                validate_proof_pdf_size(pdf_path)
                attachments_to_send = [pdf_path]
                send_mode_label = "anexo"
                logger.info(
                    "Prova: envio com anexo PDF (modelo id=%s): %s",
                    (plan.get("model") or {}).get("id"),
                    proof_file_basename,
                )
            elif not prova_web_link_used:
                from routers.proof_portal_routes import (
                    build_proof_portal_url,
                    ensure_proof_token,
                )

                proof_token = ensure_proof_token(
                    request.os,
                    request.ano,
                    nova_versao,
                    proof_file_basename,
                    ponto_envio=str(session.ponto),
                )
                proof_link = build_proof_portal_url(request.os, request.ano, proof_token)
                send_mode_label = "portal"
                logger.info(
                    "Prova: PDF vinculado ao token (sem anexo): %s",
                    proof_file_basename,
                )

            variables = {
                "nr_os": request.os,
                "ano": request.ano,
                "versao": nova_versao,
                "produto": produto,
                "solicitante": solicitante,
                "link": proof_link,
                "jobname": str(request.os),
                "ordernumber": str(request.ano),
            }
            try:
                assunto, email_html = render_proof_email(
                    request.os,
                    variables,
                    proof_link=proof_link,
                    use_attachment=use_attachment,
                    plan=plan,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

        elif email_type == "timbrado_digital":
            from services.email_template_model_service import (
                render_timbrado_digital_email,
                resolve_timbrado_digital_send_plan,
            )
            from services.proof_files_service import resolve_timbrado_digital_docx_paths

            plan = resolve_timbrado_digital_send_plan()
            resolved = resolve_timbrado_digital_docx_paths(request.ano, request.os)
            attachments_to_send = [resolved["cor_path"], resolved["pb_path"]]
            proof_file_basename = f"{resolved['cor_name']}; {resolved['pb_name']}"
            send_mode_label = "anexo"
            nova_versao = (request.versao or "").strip() or "1"

            q_dados = """
                SELECT
                    p.NomeUsuario as solicitante,
                    d.TipoPublicacaoLink as produto
                FROM tabProtocolos p
                LEFT JOIN tabDetalhesServico d ON
                    p.NroProtocolo = d.NroProtocoloLinkDet AND
                    p.AnoProtocolo = d.AnoProtocoloLinkDet
                WHERE p.NroProtocolo = %(os)s AND p.AnoProtocolo = %(ano)s
            """
            res_dados = db.execute_query(q_dados, {"os": request.os, "ano": request.ano})
            solicitante = "Solicitante"
            produto = "Produto"
            if res_dados:
                solicitante = res_dados[0].get("solicitante") or "Solicitante"
                produto = res_dados[0].get("produto") or "Produto"

            variables = {
                "nr_os": request.os,
                "ano": request.ano,
                "versao": nova_versao,
                "produto": produto,
                "solicitante": solicitante,
                "link": "",
                "jobname": str(request.os),
                "ordernumber": str(request.ano),
            }
            try:
                assunto, email_html = render_timbrado_digital_email(
                    variables, plan=plan
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            logger.info(
                "Timbrado Digital: envio com anexos DOCX (modelo id=%s): %s",
                (plan.get("model") or {}).get("id"),
                proof_file_basename,
            )

        else:
             # --- LÓGICA DE REPLY ---
            if request.type == "reply" and request.email_entry_id:
                # Lógica simplificada de Reply: apenas monta um assunto Re:
                # O corpo será enviado pelo frontend? O modelo EmailPTRequest não tem campo 'html' explícito para reply custom,
                # apenas reutiliza lógica. Mas o frontend parece usar send-pt para reply simulando.
                # Se for reply, não buscamos do banco, usamos HTML padrão ou algo do tipo.
                # Porém o código original não tratava 'reply' explicitamente nessa rota, exceto se fosse adaptado.
                # O frontend chama 'send-pt' com type='reply'. 
                # Vamos assumir envio simples de confirmação.
                pass
                
            # --- LÓGICA PADRÃO (PROBLEMA TÉCNICO) ---
            from services.email_template_model_service import (
                render_pt_email,
                resolve_pt_send_plan,
            )

            query = """
                SELECT RelatorioEmail, RelatorioHTML, Versao
                FROM tabAnalises
                WHERE OS = %(os)s AND Ano = %(ano)s
            """
            result = db.execute_query(query, {"os": request.os, "ano": request.ano})

            if request.versao:
                nova_versao = request.versao
            elif result:
                nova_versao = result[0].get("Versao") or nova_versao

            produto = "Produto"
            titulo = ""
            try:
                q_det = """
                    SELECT Titulo, TipoPublicacaoLink
                    FROM tabDetalhesServico
                    WHERE NroProtocoloLinkDet = %(os)s AND AnoProtocoloLinkDet = %(ano)s
                """
                res_det = db.execute_query(q_det, {"os": request.os, "ano": request.ano})
                if res_det:
                    produto = res_det[0].get("TipoPublicacaoLink") or "Produto"
                    titulo = res_det[0].get("Titulo") or ""
            except Exception as e_det:
                logger.warning("Erro buscando detalhes OS envio email: %s", e_det)

            pt_plan = resolve_pt_send_plan()
            send_mode_label = pt_plan.get("variante") or "portal"
            variables = {
                "nr_os": request.os,
                "ano": request.ano,
                "versao": nova_versao,
                "produto": produto,
                "titulo": titulo,
            }
            try:
                assunto, email_html = render_pt_email(
                    request.ano,
                    request.os,
                    variables,
                    plan=pt_plan,
                )
            except ValueError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc

        custom_html = (request.html or "").strip()
        if custom_html and email_type != "apogee":
            from security.html_sanitize import sanitize_html_snapshot

            safe_html = sanitize_html_snapshot(custom_html) or custom_html
            if safe_html.strip():
                email_html = safe_html
                logger.info(
                    "Envio de e-mail OS %s/%s com HTML editado na prévia (%s caracteres)",
                    request.os,
                    request.ano,
                    len(email_html),
                )

        pt_inline_images: list[tuple[str, bytes, str, str]] = []
        if email_type == "pt":
            from services.pt_report_html_service import embed_indication_images_for_email

            email_html, embedded = embed_indication_images_for_email(email_html)
            pt_inline_images = [
                (img.filename, img.content, img.content_id, img.mime_type)
                for img in embedded
            ]
            if pt_inline_images:
                logger.info(
                    "Envio PT OS %s/%s com %s imagem(ns) de indicação embutida(s)",
                    request.os,
                    request.ano,
                    len(pt_inline_images),
                )

        # --- ENVIO VIA EWS ---
        service, cfg = _resolve_ews_for_ponto(str(session.ponto))
        
        # Remetente: Contas de envio (OS < / ≥ 5000); pasta: sent_folder_routing.
        from services.email_template_service import get_global_send_mailboxes

        global_boxes = get_global_send_mailboxes()
        routing_plan = _resolve_send_plan(
            cfg=cfg,
            os_id=request.os,
            email_type=email_type,
            global_send_mailboxes=global_boxes,
        )
        from_mailbox = routing_plan["mailbox"]
        
        # Preparar anexos (ler bytes)
        attachments_tuples = []
        for att_path in attachments_to_send:
            try:
                with open(att_path, "rb") as f:
                    content = f.read()
                filename = os.path.basename(att_path)
                attachments_tuples.append((filename, content))
            except OSError as e_att:
                logger.error("Erro lendo anexo %s: %s", att_path, e_att)
                raise HTTPException(
                    status_code=400,
                    detail="Não foi possível ler o PDF de prova para anexar ao e-mail.",
                ) from e_att
        
        try:
            # --- LÓGICA DE PASTA DE SAÍDA ---
            target_folder = routing_plan.get("target_folder") or {}
            target_folder_name = str(target_folder.get("name") or "").strip()
            save_to_folder_id = None
            fallback_reason = None
            
            try:
                # Tenta localizar a pasta de saída na caixa postal de envio
                target_parent = str(target_folder.get("parent") or "sentitems").strip().lower()
                if target_parent == "msgfolderroot":
                    parent_target = MailboxFolderTarget(
                        mailbox=from_mailbox,
                        folder_type="distinguished_msgfolderroot",
                        folder_label="msgfolderroot",
                    )
                else:
                    parent_target = MailboxFolderTarget(
                        mailbox=from_mailbox,
                        folder_type="distinguished_sentitems",
                        folder_label="SentItems",
                    )

                save_to_folder_id = service.find_folder_id(
                    parent_target,
                    target_folder_name,
                )
                if save_to_folder_id:
                    logger.info(
                        "Pasta de saída localizada: %s (ID: %s) [mailbox=%s source=%s]",
                        target_folder_name,
                        save_to_folder_id,
                        from_mailbox,
                        routing_plan.get("folder_source"),
                    )
                else:
                    fallback_reason = (
                        f"Pasta '{target_folder_name}' não encontrada em '{from_mailbox}'."
                    )
                    logger.warning("%s Usando padrão Sent Items.", fallback_reason)
            except Exception as e_folder:
                fallback_reason = str(e_folder)
                logger.warning("Erro ao tentar localizar pasta de saída: %s", e_folder)

            service.send_email(
                to=request.to,
                subject=assunto,
                html_body=email_html,
                from_mailbox=from_mailbox,
                attachments=attachments_tuples,
                inline_images=(
                    apogee_inline_images
                    if email_type == "apogee"
                    else (pt_inline_images or None)
                ) or None,
                save_to_folder_id=save_to_folder_id
            )
            
            logger.info(f"Email ({email_type}) sent successfully to {request.to} for OS {request.os}/{request.ano}")
            
        except Exception as e_send:
            logger.error(f"EWS Send Error: {e_send}")
            raise RuntimeError(f"Falha no envio EWS: {e_send}")
        
        # 4. Registrar andamento (somente se solicitado explicitamente)
        if request.register_andamento:
            try:
                _register_pendencia_email_andamento(
                    os=request.os,
                    ano=request.ano,
                    ponto=request.ponto,
                    email_type=email_type,
                    nova_versao=nova_versao,
                    proof_file_basename=proof_file_basename,
                    send_mode_label=send_mode_label,
                    to=list(request.to or []),
                )
            except Exception as e:
                logger.error(f"Error creating andamento after email send: {e}")
                # Não falhar o envio se o andamento falhar
        
        if email_type == "proof":
            if send_mode_label == "anexo":
                message = (
                    "E-mail de prova enviado com sucesso. "
                    "O PDF foi anexado à mensagem."
                )
            else:
                message = (
                    "E-mail de prova enviado com sucesso. "
                    "A prova ficará disponível para visualização no portal pelo link enviado."
                )
            attachment_names = [os.path.basename(p) for p in attachments_to_send]
        elif email_type == "timbrado_digital":
            message = (
                "E-mail de Timbrado A4 Digital enviado com sucesso. "
                "Os arquivos Word (Cor e PB) foram anexados."
            )
            attachment_names = [os.path.basename(p) for p in attachments_to_send]
        else:
            message = "E-mail enviado com sucesso"
            attachment_names = [os.path.basename(p) for p in attachments_to_send]

        outlook_updated = None
        outlook_error = None
        if request.email_entry_id:
            try:
                service.mark_as_read_and_categorize(
                    item_id=request.email_entry_id,
                    category_text="Pedido atendido (lido e proc.)",
                )
                outlook_updated = True
                logger.info(
                    "Email %s marcado como lido e categorizado após send-pt",
                    request.email_entry_id,
                )
            except Exception as ews_ex:
                outlook_updated = False
                outlook_error = str(ews_ex)
                logger.error(
                    "Error marking email read after send-pt: %s",
                    ews_ex,
                )

        result_payload = {
            "success": True,
            "message": message,
            "subject": assunto,
            "attachments": attachment_names,
            "proof_file": proof_file_basename or None,
            "used_account": "EWS",
            "routing": {
                "mailbox": from_mailbox,
                "mailbox_source": routing_plan.get("mailbox_source"),
                "folder_name": target_folder_name,
                "folder_source": routing_plan.get("folder_source"),
                "save_to_folder_id": save_to_folder_id,
                "used_default_sent_items": save_to_folder_id is None,
                "fallback_reason": fallback_reason,
            },
        }
        if outlook_updated is not None:
            result_payload["outlook_updated"] = outlook_updated
        if outlook_error:
            result_payload["outlook_error"] = outlook_error
        return result_payload
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Send PT Email Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pt-html/{ano}/{os}")
def get_pt_html(ano: int, os: int):
    """
    Busca HTML de e-mail PT salvo no banco para prévia
    """
    try:
        from services.email_dispatch_type_service import resolve_email_dispatch_type

        query = """
            SELECT RelatorioEmail, RelatorioHTML, Versao
            FROM tabAnalises
            WHERE OS = %(os)s AND Ano = %(ano)s
        """
        result = db.execute_query(query, {'os': os, 'ano': ano})

        versao = result[0].get("Versao") if result else None

        dispatch = resolve_email_dispatch_type(os, ano)
        if dispatch == "pt":
            try:
                return _build_pt_html_preview_payload(os, ano, versao=versao)
            except ValueError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc

        if dispatch == "timbrado_digital":
            return _build_timbrado_digital_html_preview_payload(os, ano)

        return _build_proof_html_preview_payload(os, ano, versao=versao)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching PT HTML: {e}")
        raise HTTPException(status_code=500, detail=str(e))
