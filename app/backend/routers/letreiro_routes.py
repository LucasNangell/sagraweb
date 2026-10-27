"""Heartbeat e config remota do letreiro WPF."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from database import db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/letreiro", tags=["letreiro"])

ADMIN_SAM = "p_918713"
ONLINE_SECONDS = 120


def normalize_windows_sam(windows_user: str | None) -> str:
    raw = (windows_user or "").strip()
    if not raw:
        return ""
    parts = raw.replace("/", "\\").split("\\")
    return parts[-1].strip().lower()


def is_letreiro_admin(windows_user: str | None) -> bool:
    return normalize_windows_sam(windows_user) == ADMIN_SAM


def _require_admin(windows_user: str | None) -> str:
    if not is_letreiro_admin(windows_user):
        raise HTTPException(status_code=403, detail="Acesso restrito ao administrador do letreiro.")
    return (windows_user or "").strip()


def _clip(value: str | None, size: int) -> str:
    return (value or "").strip()[:size]


def _parse_payload(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


def _as_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text[:19], fmt)
        except ValueError:
            continue
    return None


class HeartbeatBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    host_name: str = Field(alias="hostName")
    windows_user: str = Field(alias="windowsUser")
    version: str = ""
    ponto: str = ""


class LetreiroConfigPut(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    windows_user: str = Field(alias="windowsUser")
    host_name: Optional[str] = Field(default=None, alias="hostName")
    target_user: Optional[str] = Field(default=None, alias="targetUser")
    apply_to_all: bool = Field(default=False, alias="applyToAll")
    payload: dict[str, Any]


@router.post("/heartbeat")
async def post_heartbeat(body: HeartbeatBody):
    host = _clip(body.host_name, 128)
    user = _clip(body.windows_user, 128)
    if not host or not user:
        raise HTTPException(status_code=400, detail="hostName e windowsUser são obrigatórios.")
    db.execute_query(
        """
        INSERT INTO tabLetreiroInstancia (HostName, WindowsUser, Version, Ponto, LastSeen)
        VALUES (%s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            Version = VALUES(Version),
            Ponto = VALUES(Ponto),
            LastSeen = NOW()
        """,
        (host, user, _clip(body.version, 32), _clip(body.ponto, 32)),
    )
    return {"status": "ok"}


@router.get("/config")
async def get_config(
    host: str = Query(..., min_length=1),
    user: str = Query(..., min_length=1),
):
    host_name = _clip(host, 128)
    windows_user = _clip(user, 128)
    rows = db.execute_query(
        """
        SELECT Payload, UpdatedAt, UpdatedBy
        FROM tabLetreiroConfig
        WHERE HostName = %s AND WindowsUser = %s
        LIMIT 1
        """,
        (host_name, windows_user),
    )
    if not rows:
        return {"payload": None}
    try:
        payload = _parse_payload(rows[0].get("Payload"))
    except Exception as exc:
        logger.warning("Payload letreiro inválido %s/%s: %s", host_name, windows_user, exc)
        raise HTTPException(status_code=500, detail="Config remota inválida.") from exc
    return {
        "payload": payload,
        "updatedAt": rows[0].get("UpdatedAt"),
        "updatedBy": rows[0].get("UpdatedBy") or "",
    }


@router.get("/instances")
async def list_instances(
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
    windows_user: Optional[str] = Query(default=None, alias="windowsUser"),
):
    _require_admin(x_letreiro_windows_user or windows_user)
    rows = db.execute_query(
        """
        SELECT i.HostName, i.WindowsUser, i.Version, i.Ponto, i.LastSeen,
               c.HostName AS ConfigHost
        FROM tabLetreiroInstancia i
        LEFT JOIN tabLetreiroConfig c
          ON c.HostName = i.HostName AND c.WindowsUser = i.WindowsUser
        ORDER BY i.LastSeen DESC
        """
    )
    now = datetime.now()
    items = []
    for row in rows or []:
        seen = _as_datetime(row.get("LastSeen"))
        online = bool(seen and (now - seen) <= timedelta(seconds=ONLINE_SECONDS))
        items.append(
            {
                "hostName": row.get("HostName") or "",
                "windowsUser": row.get("WindowsUser") or "",
                "version": row.get("Version") or "",
                "ponto": row.get("Ponto") or "",
                "lastSeen": row.get("LastSeen"),
                "online": online,
                "hasConfig": bool(row.get("ConfigHost")),
            }
        )
    return {"instances": items}


def _upsert_config(host: str, user: str, payload_json: str, updated_by: str) -> None:
    db.execute_query(
        """
        INSERT INTO tabLetreiroConfig (HostName, WindowsUser, Payload, UpdatedAt, UpdatedBy)
        VALUES (%s, %s, %s, NOW(), %s)
        ON DUPLICATE KEY UPDATE
            Payload = VALUES(Payload),
            UpdatedAt = NOW(),
            UpdatedBy = VALUES(UpdatedBy)
        """,
        (host, user, payload_json, updated_by),
    )


@router.put("/config")
async def put_config(
    body: LetreiroConfigPut,
    x_letreiro_windows_user: Optional[str] = Header(default=None, alias="X-Letreiro-Windows-User"),
):
    actor = _require_admin(x_letreiro_windows_user or body.windows_user)
    try:
        payload_json = json.dumps(body.payload)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Payload inválido.") from exc

    if body.apply_to_all:
        rows = db.execute_query("SELECT HostName, WindowsUser FROM tabLetreiroInstancia")
        if not rows:
            raise HTTPException(status_code=400, detail="Nenhuma instância conhecida.")
        for row in rows:
            _upsert_config(
                _clip(row.get("HostName"), 128),
                _clip(row.get("WindowsUser"), 128),
                payload_json,
                actor,
            )
        return {"status": "ok", "updated": len(rows)}

    host = _clip(body.host_name, 128)
    target = _clip(body.target_user, 128)
    if not host or not target:
        raise HTTPException(status_code=400, detail="hostName e targetUser são obrigatórios.")
    _upsert_config(host, target, payload_json, actor)
    return {"status": "ok", "updated": 1}
