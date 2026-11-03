"""Hello, config remota e lista ao vivo dos painéis OS."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from security.api_auth import resolve_client_ip
from security.painel_config_admin import require_painel_config_admin_ponto
from security.session_auth import SessionData, require_session
from services import painel_remote_config_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["painel-remoto"])


class PainelHelloBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    client_id: str = Field(alias="clientId")
    route: str = ""
    sector: str = ""


class PainelInstancePut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    nome: Optional[str] = None
    setor: Optional[str] = None
    descricao: Optional[str] = None


class PainelConfigPut(BaseModel):
    payload: Any


class PainelPresetBody(BaseModel):
    nome: str
    payload: Any


def _require_admin(session: SessionData = Depends(require_session)) -> SessionData:
    require_painel_config_admin_ponto(session.ponto)
    return session


@router.post("/api/painel/hello")
def post_hello(body: PainelHelloBody, request: Request):
    client_id = svc.normalize_client_id(body.client_id)
    if not client_id:
        raise HTTPException(status_code=400, detail="clientId inválido.")
    ip = resolve_client_ip(request)
    svc.upsert_instance(
        client_id,
        ip=ip,
        route=body.route,
        setor=body.sector,
    )
    return {"status": "ok", "clientId": client_id}


@router.get("/api/painel/config")
def get_config(clientId: str = Query(..., min_length=8, max_length=64)):
    client_id = svc.normalize_client_id(clientId)
    if not client_id:
        raise HTTPException(status_code=400, detail="clientId inválido.")
    row = svc.fetch_config(client_id)
    if row is None:
        return {"payload": None, "updatedAt": None, "updatedBy": ""}
    return row


@router.get("/api/admin/painel/instances")
def list_instances(_session: SessionData = Depends(_require_admin)):
    from routers.realtime import manager

    live = manager.get_painel_instances()
    stored = svc.fetch_instances_map([item["clientId"] for item in live])
    result = []
    for item in live:
        cid = item["clientId"]
        meta = stored.get(cid) or {}
        result.append(
            {
                "clientId": cid,
                "online": True,
                "nome": meta.get("nome") or "",
                "setor": meta.get("setor") or item.get("sector") or "",
                "descricao": meta.get("descricao") or "",
                "ip": meta.get("ip") or item.get("ip") or "",
                "route": item.get("route") or meta.get("route") or "",
                "lastSeen": meta.get("lastSeen"),
            }
        )
    result.sort(key=lambda row: (row.get("nome") or row.get("ip") or row["clientId"]).lower())
    return {"instances": result}


@router.put("/api/admin/painel/instances/{client_id}")
def put_instance(
    client_id: str,
    body: PainelInstancePut,
    session: SessionData = Depends(_require_admin),
):
    cid = svc.normalize_client_id(client_id)
    if not cid:
        raise HTTPException(status_code=400, detail="clientId inválido.")
    try:
        row = svc.update_instance_profile(
            cid,
            nome=body.nome,
            setor=body.setor,
            descricao=body.descricao,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if body.setor is not None:
        setor = svc.clip(body.setor, 128)
        merged = svc.merge_config_sector(cid, setor, str(session.ponto))
        if merged and merged.get("payload") is not None:
            svc.push_config_update(cid, payload=merged["payload"], sector=setor)
        else:
            svc.push_config_update(cid, sector=setor)
    return {"status": "ok", "instance": row}


@router.put("/api/admin/painel/config/{client_id}")
def put_config(
    client_id: str,
    body: PainelConfigPut,
    session: SessionData = Depends(_require_admin),
):
    cid = svc.normalize_client_id(client_id)
    if not cid:
        raise HTTPException(status_code=400, detail="clientId inválido.")
    if body.payload is None or not isinstance(body.payload, dict):
        raise HTTPException(status_code=400, detail="Payload inválido.")
    saved = svc.upsert_config(cid, body.payload, str(session.ponto))
    sector = ""
    if isinstance(saved.get("payload"), dict):
        sector = str(saved["payload"].get("sector") or "")
        svc.upsert_instance(cid, setor=sector)
    svc.push_config_update(cid, payload=saved.get("payload"), sector=sector or None)
    return {"status": "ok", **saved}


@router.get("/api/admin/painel/presets")
def list_presets(_session: SessionData = Depends(_require_admin)):
    return {"presets": svc.list_presets()}


@router.post("/api/admin/painel/presets")
def post_preset(
    body: PainelPresetBody,
    session: SessionData = Depends(_require_admin),
):
    try:
        row = svc.create_preset(body.nome, body.payload, str(session.ponto))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "preset": row}


@router.delete("/api/admin/painel/presets/{preset_id}")
def remove_preset(
    preset_id: int,
    _session: SessionData = Depends(_require_admin),
):
    if not svc.delete_preset(preset_id):
        raise HTTPException(status_code=400, detail="Preset inválido.")
    return {"status": "ok"}
