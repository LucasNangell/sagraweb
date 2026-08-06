"""
Padrões do painel de setor por setor (MASTER) e leitura para usuários autenticados.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import db
from security.api_auth import require_master_ip
from security.session_auth import SessionData, require_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["setor-painel"])


class SetorPainelPayloadBody(BaseModel):
    payload: Any = Field(..., description="Configuração do painel (JSON)")


def _normalize_setor(setor: str) -> str:
    value = (setor or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Setor inválido.")
    if len(value) > 32:
        raise HTTPException(status_code=400, detail="Setor muito longo.")
    return value


def _parse_payload(raw: Any) -> Any:
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


def fetch_setor_painel_default(setor: str) -> Optional[dict]:
    """Retorna payload do padrão do setor ou None."""
    normalized = (setor or "").strip()
    if not normalized:
        return None
    rows = db.execute_query(
        "SELECT Payload FROM tabSetorPainelDefaults WHERE Setor = %s LIMIT 1",
        (normalized,),
    )
    if not rows:
        return None
    try:
        return _parse_payload(rows[0]["Payload"])
    except Exception as exc:
        logger.warning("Payload inválido para setor %s: %s", normalized, exc)
        return None


def fetch_user_setor(ponto: int | str) -> Optional[str]:
    rows = db.execute_query(
        "SELECT Setor FROM tabUsuarios WHERE Ponto = %s LIMIT 1",
        (ponto,),
    )
    if not rows:
        return None
    value = rows[0].get("Setor")
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def fetch_user_fornecedor(ponto: int | str) -> bool:
    rows = db.execute_query(
        "SELECT Fornecedor FROM tabUsuarios WHERE Ponto = %s LIMIT 1",
        (ponto,),
    )
    if not rows:
        return False
    return bool(rows[0].get("Fornecedor"))


@router.get(
    "/api/admin/setor-painel-defaults",
    dependencies=[Depends(require_master_ip)],
)
async def list_setor_painel_defaults():
    rows = db.execute_query(
        "SELECT Setor, DataAtualizacao FROM tabSetorPainelDefaults ORDER BY Setor"
    )
    return [
        {
            "setor": row["Setor"],
            "data_atualizacao": row.get("DataAtualizacao"),
        }
        for row in (rows or [])
    ]


@router.get(
    "/api/admin/setor-painel-defaults/{setor}",
    dependencies=[Depends(require_master_ip)],
)
async def get_setor_painel_default_admin(setor: str):
    normalized = _normalize_setor(setor)
    payload = fetch_setor_painel_default(normalized)
    return {"setor": normalized, "payload": payload}


@router.put(
    "/api/admin/setor-painel-defaults/{setor}",
    dependencies=[Depends(require_master_ip)],
)
async def put_setor_painel_default_admin(setor: str, body: SetorPainelPayloadBody):
    normalized = _normalize_setor(setor)
    try:
        payload_json = json.dumps(body.payload)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Payload inválido.") from exc

    db.execute_query(
        """
        INSERT INTO tabSetorPainelDefaults (Setor, Payload, DataAtualizacao)
        VALUES (%s, %s, NOW())
        ON DUPLICATE KEY UPDATE
            Payload = VALUES(Payload),
            DataAtualizacao = NOW()
        """,
        (normalized, payload_json),
    )
    return {"status": "ok", "setor": normalized}


@router.get("/api/settings/setor-painel-default/{setor}")
async def get_setor_painel_default_for_session(
    setor: str,
    session: SessionData = Depends(require_session),
):
    """Leitura do padrão por setor (usuário autenticado)."""
    _ = session
    normalized = _normalize_setor(setor)
    payload = fetch_setor_painel_default(normalized)
    return {"setor": normalized, "payload": payload}
