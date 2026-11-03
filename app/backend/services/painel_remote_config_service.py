"""Persistência e push da configuração remota dos painéis OS."""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
PAINEL_ROUTES = frozenset({"setor", "setor-moderno", "tablet", "celular"})


def normalize_client_id(value: Any) -> str:
    text = str(value or "").strip()
    if not CLIENT_ID_RE.match(text):
        return ""
    return text


def normalize_route(value: Any) -> str:
    raw = str(value or "").strip().lower().replace("_", "-")
    if raw.startswith("/painel/"):
        raw = raw[len("/painel/") :]
    if raw.endswith("/"):
        raw = raw[:-1]
    if raw in PAINEL_ROUTES:
        return raw
    return ""


def clip(value: Any, size: int) -> str:
    return str(value or "").strip()[:size]


def parse_payload(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


def _as_iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="seconds")
    text = str(value)
    return text or None


def _lookup_ip_descricao(ip: str) -> str:
    if not ip:
        return ""
    try:
        rows = db.execute_query(
            "SELECT descricao FROM ip_permissions WHERE ip = %s LIMIT 1",
            (ip,),
        )
    except Exception as exc:
        logger.warning("Falha ao buscar descrição do IP %s: %s", ip, exc)
        return ""
    if not rows:
        return ""
    return clip(rows[0].get("descricao"), 255)


def upsert_instance(
    client_id: str,
    *,
    ip: str = "",
    route: str = "",
    setor: str = "",
    nome: Optional[str] = None,
    descricao: Optional[str] = None,
) -> None:
    cid = normalize_client_id(client_id)
    if not cid:
        return
    ip_val = clip(ip, 64)
    route_val = normalize_route(route) or clip(route, 64)
    setor_val = clip(setor, 128)
    nome_val = clip(nome, 128) if nome is not None else None
    descricao_val = clip(descricao, 255) if descricao is not None else None
    if descricao_val is None and ip_val:
        descricao_val = _lookup_ip_descricao(ip_val) or None

    db.execute_query(
        """
        INSERT INTO tabPainelInstancia (ClientId, Nome, Setor, Descricao, Ip, Route, LastSeen)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            Nome = IF(Nome = '', VALUES(Nome), Nome),
            Setor = IF(VALUES(Setor) = '', Setor, VALUES(Setor)),
            Descricao = IF(Descricao = '', VALUES(Descricao), Descricao),
            Ip = IF(VALUES(Ip) = '', Ip, VALUES(Ip)),
            Route = IF(VALUES(Route) = '', Route, VALUES(Route)),
            LastSeen = NOW()
        """,
        (
            cid,
            nome_val or "",
            setor_val,
            descricao_val or "",
            ip_val,
            route_val,
        ),
    )


def fetch_instance(client_id: str) -> Optional[dict[str, Any]]:
    cid = normalize_client_id(client_id)
    if not cid:
        return None
    rows = db.execute_query(
        """
        SELECT ClientId, Nome, Setor, Descricao, Ip, Route, LastSeen
        FROM tabPainelInstancia
        WHERE ClientId = %s
        LIMIT 1
        """,
        (cid,),
    )
    if not rows:
        return None
    return _row_to_instance(rows[0])


def fetch_instances_map(client_ids: list[str]) -> dict[str, dict[str, Any]]:
    ids = [normalize_client_id(cid) for cid in client_ids]
    ids = [cid for cid in ids if cid]
    if not ids:
        return {}
    placeholders = ", ".join(["%s"] * len(ids))
    rows = db.execute_query(
        f"""
        SELECT ClientId, Nome, Setor, Descricao, Ip, Route, LastSeen
        FROM tabPainelInstancia
        WHERE ClientId IN ({placeholders})
        """,
        tuple(ids),
    )
    return {_row_to_instance(row)["clientId"]: _row_to_instance(row) for row in rows or []}


def _row_to_instance(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "clientId": str(row.get("ClientId") or ""),
        "nome": str(row.get("Nome") or ""),
        "setor": str(row.get("Setor") or ""),
        "descricao": str(row.get("Descricao") or ""),
        "ip": str(row.get("Ip") or ""),
        "route": str(row.get("Route") or ""),
        "lastSeen": _as_iso(row.get("LastSeen")),
    }


def fetch_config(client_id: str) -> Optional[dict[str, Any]]:
    cid = normalize_client_id(client_id)
    if not cid:
        return None
    rows = db.execute_query(
        """
        SELECT Payload, UpdatedAt, UpdatedBy
        FROM tabPainelConfig
        WHERE ClientId = %s
        LIMIT 1
        """,
        (cid,),
    )
    if not rows:
        return None
    try:
        payload = parse_payload(rows[0].get("Payload"))
    except Exception as exc:
        logger.warning("Payload inválido para painel %s: %s", cid, exc)
        payload = None
    return {
        "payload": payload,
        "updatedAt": _as_iso(rows[0].get("UpdatedAt")),
        "updatedBy": str(rows[0].get("UpdatedBy") or ""),
    }


def upsert_config(client_id: str, payload: Any, updated_by: str) -> dict[str, Any]:
    cid = normalize_client_id(client_id)
    if not cid:
        raise ValueError("clientId inválido")
    payload_json = json.dumps(payload, ensure_ascii=False)
    actor = clip(updated_by, 32)
    db.execute_query(
        """
        INSERT INTO tabPainelConfig (ClientId, Payload, UpdatedAt, UpdatedBy)
        VALUES (%s, %s, NOW(), %s)
        ON DUPLICATE KEY UPDATE
            Payload = VALUES(Payload),
            UpdatedAt = NOW(),
            UpdatedBy = VALUES(UpdatedBy)
        """,
        (cid, payload_json, actor),
    )
    return fetch_config(cid) or {
        "payload": payload,
        "updatedAt": None,
        "updatedBy": actor,
    }


def update_instance_profile(
    client_id: str,
    *,
    nome: Optional[str] = None,
    setor: Optional[str] = None,
    descricao: Optional[str] = None,
) -> dict[str, Any]:
    cid = normalize_client_id(client_id)
    if not cid:
        raise ValueError("clientId inválido")
    existing = fetch_instance(cid)
    if existing is None:
        upsert_instance(
            cid,
            nome=nome or "",
            setor=setor or "",
            descricao=descricao or "",
        )
    else:
        next_nome = existing["nome"] if nome is None else clip(nome, 128)
        next_setor = existing["setor"] if setor is None else clip(setor, 128)
        next_desc = existing["descricao"] if descricao is None else clip(descricao, 255)
        db.execute_query(
            """
            UPDATE tabPainelInstancia
            SET Nome = %s, Setor = %s, Descricao = %s, LastSeen = LastSeen
            WHERE ClientId = %s
            """,
            (next_nome, next_setor, next_desc, cid),
        )
    row = fetch_instance(cid)
    if row is None:
        raise RuntimeError("Falha ao gravar instância do painel.")
    return row


def merge_config_sector(client_id: str, setor: str, updated_by: str) -> Optional[dict[str, Any]]:
    current = fetch_config(client_id)
    if not current or not isinstance(current.get("payload"), dict):
        return None
    payload = dict(current["payload"])
    payload["sector"] = clip(setor, 128)
    return upsert_config(client_id, payload, updated_by)


def push_config_update(
    client_id: str,
    *,
    payload: Any = None,
    sector: str | None = None,
) -> None:
    from routers.realtime import schedule_broadcast

    message: dict[str, Any] = {
        "type": "painel_config_update",
        "target_client_id": client_id,
    }
    if payload is not None:
        message["payload"] = payload
    if sector:
        message["sector"] = clip(sector, 128)
    schedule_broadcast(message)


def _row_to_preset(row: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = parse_payload(row.get("Payload"))
    except Exception:
        payload = None
    return {
        "id": int(row.get("Id") or 0),
        "nome": str(row.get("Nome") or ""),
        "payload": payload if isinstance(payload, dict) else {},
        "updatedAt": _as_iso(row.get("UpdatedAt")),
        "updatedBy": str(row.get("UpdatedBy") or ""),
    }


def list_presets() -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT Id, Nome, Payload, UpdatedAt, UpdatedBy
        FROM tabPainelPreset
        ORDER BY Nome ASC
        """
    )
    return [_row_to_preset(row) for row in rows or []]


def create_preset(nome: str, payload: Any, updated_by: str) -> dict[str, Any]:
    name = clip(nome, 128)
    if len(name) < 2:
        raise ValueError("Nome do preset inválido.")
    if not isinstance(payload, dict):
        raise ValueError("Payload do preset inválido.")
    actor = clip(updated_by, 32)
    payload_json = json.dumps(payload, ensure_ascii=False)
    db.execute_query(
        """
        INSERT INTO tabPainelPreset (Nome, Payload, UpdatedAt, UpdatedBy)
        VALUES (%s, %s, NOW(), %s)
        """,
        (name, payload_json, actor),
    )
    rows = db.execute_query(
        """
        SELECT Id, Nome, Payload, UpdatedAt, UpdatedBy
        FROM tabPainelPreset
        WHERE Nome = %s
        ORDER BY Id DESC
        LIMIT 1
        """,
        (name,),
    )
    if not rows:
        raise RuntimeError("Falha ao gravar preset.")
    return _row_to_preset(rows[0])


def delete_preset(preset_id: int) -> bool:
    try:
        pid = int(preset_id)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    db.execute_query("DELETE FROM tabPainelPreset WHERE Id = %s", (pid,))
    return True
