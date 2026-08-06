"""
Disparo imediato de notificações via WebSocket (+ fallback HTTP interno).
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)


def _clean_ponto(value: str | None) -> str:
    return "".join(c for c in str(value or "") if c.isdigit())


def insert_user_notification(
    *,
    ponto: str,
    nro: int,
    ano: int,
    mensagem: str,
    detalhes_json: str | None = None,
) -> Optional[int]:
    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO tabNotificacoes
                    (Ponto, NroProtocolo, AnoProtocolo, Mensagem, DetalhesJson)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (ponto, nro, ano, mensagem, detalhes_json),
            )
            row_id = cursor.lastrowid
            return int(row_id) if row_id else None
    except Exception as exc:
        logger.error("Falha ao gravar notificação: %s", exc)
        return None


def broadcast_ws_payload(payload: dict[str, Any]) -> None:
    """Broadcast WS: suporte sempre in-process; demais tipos HTTP notify + fallback."""
    msg_type = str(payload.get("type") or "")
    if msg_type.startswith("support_") or msg_type.startswith("gravacao_externa_"):
        try:
            from routers.realtime import schedule_broadcast

            schedule_broadcast(payload)
        except Exception as exc:
            logger.error("Falha no schedule_broadcast (%s): %s", msg_type, exc)
        return

    if _http_notify(payload):
        return
    try:
        from routers.realtime import schedule_broadcast

        schedule_broadcast(payload)
    except Exception as exc:
        logger.error("Falha no schedule_broadcast: %s", exc)


def push_user_notification(
    *,
    target_ponto: str,
    mensagem: str,
    nro: int,
    ano: int,
    notification_id: int | None = None,
    action: str = "notification",
    ticket_id: int | None = None,
    support_message_id: int | None = None,
    gravacao_message_id: int | None = None,
    browser_notify: bool | None = None,
) -> None:
    """Envia notification_new a clientes autenticados (filtro por ponto no cliente)."""
    target_digits = _clean_ponto(target_ponto) or str(target_ponto).strip()
    payload: dict[str, Any] = {
        "type": "notification_new",
        "id": int(nro),
        "ano": int(ano),
        "action": action,
        "mensagem": mensagem,
        "target_ponto": target_digits,
    }
    if notification_id:
        payload["notification_id"] = int(notification_id)
    tid = ticket_id or support_message_id
    if tid is not None:
        payload["ticket_id"] = int(tid)
        payload["support_message_id"] = int(tid)
    if gravacao_message_id is not None:
        payload["gravacao_message_id"] = int(gravacao_message_id)
        payload["message_id"] = int(gravacao_message_id)
    if browser_notify is not None:
        payload["browser_notify"] = bool(browser_notify)

    broadcast_ws_payload(payload)


def _http_notify(payload: dict[str, Any]) -> bool:
    """Mesmo padrão do monitor_os_changes — broadcast no loop async da API."""
    try:
        import requests
        from config_manager import config_manager
        from security.notify_auth import notify_request_headers

        url = f"{config_manager.get_api_internal_base()}/realtime/notify"
        headers = notify_request_headers()
        resp = requests.post(
            url,
            json=payload,
            headers=headers,
            timeout=2.0,
            proxies={"http": None, "https": None},
        )
        return resp.status_code == 200
    except Exception as exc:
        logger.debug("HTTP notify indisponível: %s", exc)
        return False
