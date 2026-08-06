"""Rotas de inscrição de notificação por OS e Web Push."""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from security.session_auth import get_session_from_request
from services.os_notificacao_watch_service import (
    delete_watch,
    get_watch_for_user_os,
    is_os_change_control_active,
    upsert_watch,
)
from services.web_push_service import (
    delete_push_subscription,
    get_vapid_public_key,
    save_push_subscription,
)
from services.painel_tablet_push_pref_service import (
    get_painel_tablet_push_pref,
    upsert_painel_tablet_push_pref,
)

router = APIRouter()
logger = logging.getLogger(__name__)


class OsNotificacaoWatchPayload(BaseModel):
    notify_andamentos: bool = False
    notify_all_andamentos: bool = True
    andamento_situacao: Optional[str] = None
    andamento_setor: Optional[str] = None
    notify_os_changes: bool = False


class PushSubscribePayload(BaseModel):
    endpoint: str = Field(..., min_length=8)
    keys: dict[str, str]
    user_agent: Optional[str] = None


class PushUnsubscribePayload(BaseModel):
    endpoint: str = Field(..., min_length=8)


class PainelTabletPushPrefPayload(BaseModel):
    enabled: bool
    setor: Optional[str] = None


def _require_session_ponto(request: Request) -> str:
    session = get_session_from_request(request)
    if not session or not session.ponto:
        raise HTTPException(status_code=403, detail="Sessão inválida.")
    return str(session.ponto)


def _serialize_watch(row: dict | None, *, nro: int | None = None, ano: int | None = None) -> dict | None:
    if not row:
        return None
    ponto = str(row.get("Ponto") or "")
    payload = {
        "notify_andamentos": bool(row.get("NotifyAndamentos")),
        "notify_all_andamentos": bool(row.get("NotifyAllAndamentos")),
        "andamento_situacao": row.get("AndamentoSituacao"),
        "andamento_setor": row.get("AndamentoSetor"),
        "notify_os_changes": bool(row.get("NotifyOsChanges")),
        "ativo": bool(row.get("Ativo")),
        "data_criacao": row.get("DataCriacao"),
        "data_atualizacao": row.get("DataAtualizacao"),
    }
    if payload["notify_os_changes"] and nro and ano and ponto:
        payload["os_change_control_active"] = is_os_change_control_active(
            ponto=ponto, nro=nro, ano=ano
        )
    else:
        payload["os_change_control_active"] = False
    return payload


@router.get("/os/{ano}/{id}/notificacao-watch")
def get_os_notificacao_watch(ano: int, id: int, request: Request):
    ponto = _require_session_ponto(request)
    row = get_watch_for_user_os(ponto=ponto, nro=id, ano=ano)
    return {"watch": _serialize_watch(row, nro=id, ano=ano)}


def _save_os_notificacao_watch(
    *,
    ponto: str,
    ano: int,
    id: int,
    body: OsNotificacaoWatchPayload,
) -> dict:
    try:
        result = upsert_watch(
            ponto=ponto,
            nro=id,
            ano=ano,
            notify_andamentos=body.notify_andamentos,
            notify_all_andamentos=body.notify_all_andamentos,
            andamento_situacao=body.andamento_situacao,
            andamento_setor=body.andamento_setor,
            notify_os_changes=body.notify_os_changes,
        )
        if result.get("deleted"):
            return {"watch": None, "deleted": True}
        row = get_watch_for_user_os(ponto=ponto, nro=id, ano=ano)
        return {"watch": _serialize_watch(row, nro=id, ano=ano)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Erro ao salvar notificação OS %s/%s: %s", id, ano, exc)
        raise HTTPException(status_code=500, detail="Falha ao salvar inscrição.") from exc


@router.put("/os/{ano}/{id}/notificacao-watch")
def put_os_notificacao_watch(ano: int, id: int, body: OsNotificacaoWatchPayload, request: Request):
    ponto = _require_session_ponto(request)
    return _save_os_notificacao_watch(ponto=ponto, ano=ano, id=id, body=body)


@router.post("/os/{ano}/{id}/notificacao-watch")
def post_os_notificacao_watch(ano: int, id: int, body: OsNotificacaoWatchPayload, request: Request):
    """Alias POST — alguns proxies móveis bloqueiam PUT."""
    ponto = _require_session_ponto(request)
    return _save_os_notificacao_watch(ponto=ponto, ano=ano, id=id, body=body)


@router.delete("/os/{ano}/{id}/notificacao-watch")
@router.post("/os/{ano}/{id}/notificacao-watch/delete")
def remove_os_notificacao_watch(ano: int, id: int, request: Request):
    ponto = _require_session_ponto(request)
    delete_watch(ponto=ponto, nro=id, ano=ano)
    return {"status": "ok"}


@router.get("/push/vapid-public-key")
def push_vapid_public_key():
    key = get_vapid_public_key()
    if not key:
        raise HTTPException(status_code=503, detail="Web Push não configurado.")
    return {"public_key": key}


@router.post("/push/subscribe")
def push_subscribe(body: PushSubscribePayload, request: Request):
    ponto = _require_session_ponto(request)
    p256dh = (body.keys.get("p256dh") or "").strip()
    auth_key = (body.keys.get("auth") or "").strip()
    if not p256dh or not auth_key:
        raise HTTPException(status_code=400, detail="Chaves push inválidas.")
    save_push_subscription(
        ponto=ponto,
        endpoint=body.endpoint,
        p256dh=p256dh,
        auth_key=auth_key,
        user_agent=body.user_agent or request.headers.get("user-agent"),
    )
    return {"status": "ok"}


@router.delete("/push/subscribe")
@router.post("/push/subscribe/delete")
def push_unsubscribe(body: PushUnsubscribePayload, request: Request):
    _require_session_ponto(request)
    delete_push_subscription(endpoint=body.endpoint)
    return {"status": "ok"}


@router.get("/painel-tablet/push-pref")
def get_painel_tablet_push_pref_route(request: Request):
    ponto = _require_session_ponto(request)
    return get_painel_tablet_push_pref(ponto)


def _save_painel_tablet_push_pref(
    *,
    ponto: str,
    body: PainelTabletPushPrefPayload,
) -> dict:
    try:
        return upsert_painel_tablet_push_pref(
            ponto=ponto,
            enabled=body.enabled,
            setor=body.setor,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Erro ao salvar push-pref painel tablet ponto=%s: %s", ponto, exc)
        raise HTTPException(status_code=500, detail="Falha ao salvar preferência.") from exc


@router.put("/painel-tablet/push-pref")
def put_painel_tablet_push_pref(body: PainelTabletPushPrefPayload, request: Request):
    ponto = _require_session_ponto(request)
    return _save_painel_tablet_push_pref(ponto=ponto, body=body)


@router.post("/painel-tablet/push-pref")
def post_painel_tablet_push_pref(body: PainelTabletPushPrefPayload, request: Request):
    """Alias POST — alguns proxies móveis bloqueiam PUT."""
    ponto = _require_session_ponto(request)
    return _save_painel_tablet_push_pref(ponto=ponto, body=body)
