"""Rotas de suporte: envio pelo usuário, gestão pelo admin e manual do usuário."""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from routers.admin_system_routes import require_admin_config_access
from routers.cliente_gabinete_routes import (
    _assert_os_belongs_to_cliente,
    _cliente_context_from_session,
)
from security.session_auth import SessionData, require_cliente_session, require_session
from services import support_message_service as support_svc
from services import support_settings as support_cfg

logger = logging.getLogger(__name__)

router = APIRouter(tags=["support"])

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_MANUAL_DIR = _PROJECT_ROOT / "docs" / "manual_pdf_assets"
_MANUAL_HTML = _MANUAL_DIR / "MANUAL_USUARIO_FINAL_SAGRA_WEB.html"
_FILE_CSS_RE = re.compile(
    r'href="file:///[^"]*manual-style\.css"',
    re.IGNORECASE,
)


class SupportMessageCreateRequest(BaseModel):
    tipo: Literal["problema", "sugestao"] = "problema"
    assunto: str = Field(..., min_length=3, max_length=255)
    mensagem: str = Field(..., min_length=10, max_length=8000)


class SupportMessageReplyRequest(BaseModel):
    resposta: str = Field(..., min_length=3, max_length=8000)


class SupportUserReplyRequest(BaseModel):
    mensagem: str = Field(..., min_length=3, max_length=8000)


class ClienteSupportMessageCreateRequest(BaseModel):
    ano: int = Field(..., ge=2000, le=2100)
    nr_os: int = Field(..., ge=1)
    assunto: str = Field(..., min_length=3, max_length=255)
    mensagem: str = Field(..., min_length=3, max_length=8000)
    versao: Optional[str] = Field(None, max_length=64)


class ClienteSupportReplyRequest(BaseModel):
    mensagem: str = Field(..., min_length=3, max_length=8000)


class SupportChatSettingsSaveRequest(BaseModel):
    usuario_chat_enabled: bool = True
    cliente_chat_enabled: bool = True


def _session_ponto_str(session: SessionData) -> str:
    return str(session.ponto)


def _ensure_usuario_chat_enabled() -> None:
    if not support_cfg.is_usuario_chat_enabled():
        raise HTTPException(
            status_code=403,
            detail="O chat de suporte para usuários está temporariamente desativado.",
        )


def _ensure_cliente_chat_enabled() -> None:
    if not support_cfg.is_cliente_chat_enabled():
        raise HTTPException(
            status_code=403,
            detail="O chat de dúvidas em Problemas Técnicos está temporariamente desativado.",
        )


@router.get("/api/support/settings")
def get_support_settings(session: SessionData = Depends(require_session)):
    del session
    settings = support_cfg.get_public_settings()
    return {"usuario_chat_enabled": settings["usuario_chat_enabled"]}


@router.get("/api/cliente/support/settings")
def get_cliente_support_settings(
    session: SessionData = Depends(require_cliente_session),
):
    del session
    settings = support_cfg.get_public_settings()
    return {"cliente_chat_enabled": settings["cliente_chat_enabled"]}


@router.get(
    "/api/admin/system/support-settings",
    dependencies=[Depends(require_admin_config_access)],
)
def get_admin_support_settings():
    return support_cfg.get_public_settings()


@router.put(
    "/api/admin/system/support-settings",
    dependencies=[Depends(require_admin_config_access)],
)
def save_admin_support_settings(body: SupportChatSettingsSaveRequest):
    support_cfg.set_support_chat_settings(
        usuario_chat_enabled=body.usuario_chat_enabled,
        cliente_chat_enabled=body.cliente_chat_enabled,
    )
    return support_cfg.get_public_settings()


@router.post("/api/support/messages")
def submit_support_message(
    body: SupportMessageCreateRequest,
    session: SessionData = Depends(require_session),
):
    _ensure_usuario_chat_enabled()
    try:
        created = support_svc.create_support_message(
            ponto=_session_ponto_str(session),
            nome_usuario=session.nome,
            tipo=body.tipo,
            assunto=body.assunto,
            mensagem=body.mensagem,
        )
        return created
    except Exception as exc:
        logger.error("Erro ao criar mensagem de suporte: %s", exc)
        raise HTTPException(status_code=500, detail="Não foi possível enviar a mensagem.") from exc


@router.get("/api/support/tickets")
def list_user_support_tickets(
    status: Optional[str] = Query(None, pattern="^(aberto|resolvido)$"),
    session: SessionData = Depends(require_session),
):
    return {
        "items": support_svc.list_support_messages(
            status=status,
            ponto=_session_ponto_str(session),
        )
    }


@router.get("/api/support/tickets/{ticket_id}")
def get_user_support_ticket(
    ticket_id: int,
    session: SessionData = Depends(require_session),
):
    item = support_svc.get_support_message(ticket_id)
    if item is None or str(item.get("Ponto") or "") != _session_ponto_str(session):
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return item


@router.post("/api/support/tickets/{ticket_id}/reply")
def reply_user_support_ticket(
    ticket_id: int,
    body: SupportUserReplyRequest,
    session: SessionData = Depends(require_session),
):
    _ensure_usuario_chat_enabled()
    try:
        item = support_svc.add_user_reply(
            message_id=ticket_id,
            ponto=_session_ponto_str(session),
            nome_usuario=session.nome,
            mensagem=body.mensagem,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return item


@router.get("/api/cliente/support/ticket")
def get_cliente_open_support_ticket(
    ano: int = Query(..., ge=2000, le=2100),
    nr_os: int = Query(..., ge=1),
    session: SessionData = Depends(require_cliente_session),
):
    tipo_conta, vinculo = _cliente_context_from_session(session)
    _assert_os_belongs_to_cliente(nr_os, ano, vinculo, tipo_conta)
    item = support_svc.get_cliente_open_ticket(
        cliente_id=int(session.cliente_id or 0),
        nr_os=nr_os,
        ano=ano,
    )
    return {"item": item}


@router.post("/api/cliente/support/messages")
def submit_cliente_support_message(
    body: ClienteSupportMessageCreateRequest,
    session: SessionData = Depends(require_cliente_session),
):
    _ensure_cliente_chat_enabled()
    tipo_conta, vinculo = _cliente_context_from_session(session)
    _assert_os_belongs_to_cliente(body.nr_os, body.ano, vinculo, tipo_conta)
    try:
        created = support_svc.create_cliente_support_message(
            cliente_id=int(session.cliente_id or 0),
            nome_cliente=session.nome or session.gabinete,
            nr_os=body.nr_os,
            ano=body.ano,
            assunto=body.assunto,
            mensagem=body.mensagem,
            versao=body.versao,
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Erro ao criar mensagem cliente: %s", exc)
        raise HTTPException(status_code=500, detail="Não foi possível enviar a mensagem.") from exc


@router.get("/api/cliente/support/tickets/{ticket_id}")
def get_cliente_support_ticket(
    ticket_id: int,
    session: SessionData = Depends(require_cliente_session),
):
    item = support_svc.get_cliente_support_message(
        ticket_id,
        cliente_id=int(session.cliente_id or 0),
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return item


@router.post("/api/cliente/support/tickets/{ticket_id}/reply")
def reply_cliente_support_ticket(
    ticket_id: int,
    body: ClienteSupportReplyRequest,
    session: SessionData = Depends(require_cliente_session),
):
    _ensure_cliente_chat_enabled()
    try:
        item = support_svc.add_cliente_reply(
            message_id=ticket_id,
            cliente_id=int(session.cliente_id or 0),
            nome_cliente=session.nome or session.gabinete,
            mensagem=body.mensagem,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return item


@router.get("/api/support/assigned-tickets")
def list_assigned_support_tickets(
    status: Optional[str] = Query(None, pattern="^(aberto|resolvido)$"),
    session: SessionData = Depends(require_session),
):
    return {
        "items": support_svc.list_assigned_support_messages(
            assigned_ponto=_session_ponto_str(session),
            status=status,
        )
    }


@router.get("/api/support/assigned-tickets/{ticket_id}")
def get_assigned_support_ticket(
    ticket_id: int,
    session: SessionData = Depends(require_session),
):
    item = support_svc.get_assigned_support_message(
        ticket_id,
        assigned_ponto=_session_ponto_str(session),
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return item


@router.post("/api/support/assigned-tickets/{ticket_id}/reply")
def reply_assigned_support_ticket(
    ticket_id: int,
    body: SupportMessageReplyRequest,
    session: SessionData = Depends(require_session),
):
    try:
        item = support_svc.add_assigned_reply(
            message_id=ticket_id,
            assigned_ponto=_session_ponto_str(session),
            respondido_por=session.nome or _session_ponto_str(session),
            resposta=body.resposta,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada.")
    return item


@router.get(
    "/api/admin/system/support-messages",
    dependencies=[Depends(require_admin_config_access)],
)
def list_admin_support_messages(
    status: Optional[str] = Query(None, pattern="^(aberto|resolvido)$"),
):
    return {"items": support_svc.list_support_messages(status=status)}


@router.get(
    "/api/admin/system/support-messages/{message_id}",
    dependencies=[Depends(require_admin_config_access)],
)
def get_admin_support_message(message_id: int):
    item = support_svc.get_support_message(message_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    return item


@router.post(
    "/api/admin/system/support-messages/{message_id}/reply",
    dependencies=[Depends(require_admin_config_access)],
)
def reply_admin_support_message(
    message_id: int,
    body: SupportMessageReplyRequest,
    session: SessionData = Depends(require_session),
):
    try:
        item = support_svc.add_admin_reply(
            message_id=message_id,
            resposta=body.resposta,
            respondido_por=session.nome or _session_ponto_str(session),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if item is None:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    return item


@router.post(
    "/api/admin/system/support-messages/{message_id}/resolve",
    dependencies=[Depends(require_admin_config_access)],
)
def resolve_admin_support_message(
    message_id: int,
    session: SessionData = Depends(require_session),
):
    item = support_svc.resolve_support_message(
        message_id=message_id,
        resolvido_por=session.nome or _session_ponto_str(session),
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    return item


@router.get("/manual/usuario", include_in_schema=False)
async def serve_user_manual_html(request: Request):
    if not _MANUAL_HTML.is_file():
        raise HTTPException(status_code=404, detail="Manual não encontrado.")
    raw = _MANUAL_HTML.read_text(encoding="utf-8")
    css_href = "/manual/assets/manual-style.css"
    if request.url.path.startswith("/sagra/"):
        css_href = "/sagra/manual/assets/manual-style.css"
    html = _FILE_CSS_RE.sub(f'href="{css_href}"', raw, count=1)
    return Response(content=html, media_type="text/html; charset=utf-8")


@router.get("/manual/assets/{asset_name}", include_in_schema=False)
async def serve_manual_asset(asset_name: str):
    safe_name = Path(asset_name).name
    if safe_name != asset_name:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")
    path = _MANUAL_DIR / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    media = "application/octet-stream"
    if safe_name.endswith(".css"):
        media = "text/css; charset=utf-8"
    elif safe_name.endswith(".html"):
        media = "text/html; charset=utf-8"
    return FileResponse(path, media_type=media)
