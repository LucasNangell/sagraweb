"""Broadcast em tempo real do chat de suporte via WebSocket."""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def push_support_thread_message(
    *,
    ticket_id: int,
    thread_message: dict[str, Any],
    owner_ponto: str,
    ticket_status: str | None = None,
    assigned_ponto: str | None = None,
    cliente_id: int | None = None,
) -> None:
    from services.support_ponto_utils import normalize_ponto, normalize_ponto_digits

    meta = get_ticket_ws_meta(ticket_id)
    if meta:
        owner_ponto = str(meta.get("owner_ponto") or owner_ponto or "")
        if meta.get("assigned_ponto") is not None:
            assigned_ponto = meta.get("assigned_ponto")
        if meta.get("cliente_id") is not None:
            cliente_id = meta.get("cliente_id")

    owner_norm = normalize_ponto_digits(owner_ponto) or normalize_ponto(owner_ponto)
    msg_id = thread_message.get("Id") or thread_message.get("id")
    payload: dict[str, Any] = {
        "type": "support_chat_message",
        "ticket_id": int(ticket_id),
        "owner_ponto": owner_norm,
        "message": thread_message,
        "author_role": str(thread_message.get("AutorTipo") or "admin"),
    }
    if msg_id is not None:
        payload["message_id"] = int(msg_id)
    if ticket_status:
        payload["ticket_status"] = ticket_status
    if assigned_ponto:
        assigned_norm = normalize_ponto_digits(assigned_ponto) or normalize_ponto(assigned_ponto)
        payload["assigned_ponto"] = assigned_norm
    if cliente_id:
        payload["cliente_id"] = int(cliente_id)
    try:
        from services.support_ws_debug import ws_log

        ws_log(
            "[SUPPORT EMIT] type=support_chat_message ticket_id=%s message_id=%s "
            "author_role=%s owner=%s assigned=%s",
            ticket_id,
            msg_id,
            payload.get("author_role"),
            payload.get("owner_ponto"),
            payload.get("assigned_ponto"),
        )
    except Exception:
        pass
    _schedule(payload)


def push_support_ticket_resolved(
    *,
    ticket_id: int,
    owner_ponto: str,
    assigned_ponto: str | None = None,
    cliente_id: int | None = None,
) -> None:
    from services.support_ponto_utils import normalize_ponto, normalize_ponto_digits

    owner_norm = normalize_ponto_digits(owner_ponto) or normalize_ponto(owner_ponto)
    payload: dict[str, Any] = {
        "type": "support_chat_resolved",
        "ticket_id": int(ticket_id),
        "owner_ponto": owner_norm,
    }
    if assigned_ponto:
        assigned_norm = normalize_ponto_digits(assigned_ponto) or normalize_ponto(assigned_ponto)
        payload["assigned_ponto"] = assigned_norm
    if cliente_id:
        payload["cliente_id"] = int(cliente_id)
    _schedule(payload)


def get_ticket_owner_ponto(ticket_id: int) -> Optional[str]:
    meta = get_ticket_ws_meta(ticket_id)
    if meta is None:
        return None
    return str(meta.get("owner_ponto") or "")


def get_ticket_ws_meta(ticket_id: int) -> Optional[dict[str, Any]]:
    from database import db

    rows = db.execute_query(
        """
        SELECT Ponto, AssignedPonto, ClienteId
        FROM tabSupportMessages WHERE Id = %s
        """,
        (ticket_id,),
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "owner_ponto": str(row.get("Ponto") or ""),
        "assigned_ponto": row.get("AssignedPonto"),
        "cliente_id": int(row["ClienteId"]) if row.get("ClienteId") else None,
    }


def _schedule(payload: dict[str, Any]) -> None:
    """Entrega WS: HTTP notify (loop async) primeiro, schedule_broadcast como fallback."""
    try:
        from services.notification_push_service import broadcast_ws_payload

        broadcast_ws_payload(payload)
    except Exception as exc:
        logger.error("Falha no broadcast de suporte: %s", exc)
