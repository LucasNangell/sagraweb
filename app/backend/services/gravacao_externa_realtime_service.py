"""Broadcast em tempo real do chat de Gravação Externa via WebSocket."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def push_gravacao_externa_message(
    *,
    gravacao_externa_id: int,
    os_ano: int,
    os_nro: int,
    thread_message: dict[str, Any],
    lancado_por_ponto: str,
) -> None:
    from services.os_vinculo_grupo_service import _clean_ponto

    msg_id = thread_message.get("Id") or thread_message.get("id")
    payload: dict[str, Any] = {
        "type": "gravacao_externa_message",
        "gravacao_externa_id": int(gravacao_externa_id),
        "os_ano": int(os_ano),
        "os_nro": int(os_nro),
        "lancado_por_ponto": _clean_ponto(lancado_por_ponto) or str(lancado_por_ponto).strip(),
        "message": thread_message,
    }
    if msg_id is not None:
        payload["message_id"] = int(msg_id)
    _schedule(payload)


def push_gravacao_externa_sessao_criada(
    *,
    gravacao_externa_id: int,
    os_ano: int,
    os_nro: int,
    lancado_por_ponto: str,
) -> None:
    from services.os_vinculo_grupo_service import _clean_ponto

    payload: dict[str, Any] = {
        "type": "gravacao_externa_sessao_criada",
        "gravacao_externa_id": int(gravacao_externa_id),
        "os_ano": int(os_ano),
        "os_nro": int(os_nro),
        "lancado_por_ponto": _clean_ponto(lancado_por_ponto) or str(lancado_por_ponto).strip(),
    }
    _schedule(payload)


def push_gravacao_externa_iniciada(
    *,
    gravacao_externa_id: int,
    os_ano: int,
    os_nro: int,
    lancado_por_ponto: str,
    status: str,
) -> None:
    from services.os_vinculo_grupo_service import _clean_ponto

    payload: dict[str, Any] = {
        "type": "gravacao_externa_iniciada",
        "gravacao_externa_id": int(gravacao_externa_id),
        "os_ano": int(os_ano),
        "os_nro": int(os_nro),
        "lancado_por_ponto": _clean_ponto(lancado_por_ponto) or str(lancado_por_ponto).strip(),
        "status": status,
    }
    _schedule(payload)


def push_gravacao_externa_arquivos_atualizados(
    *,
    gravacao_externa_id: int,
    os_ano: int,
    os_nro: int,
    lancado_por_ponto: str,
) -> None:
    from services.os_vinculo_grupo_service import _clean_ponto

    payload: dict[str, Any] = {
        "type": "gravacao_externa_arquivos_atualizados",
        "gravacao_externa_id": int(gravacao_externa_id),
        "os_ano": int(os_ano),
        "os_nro": int(os_nro),
        "lancado_por_ponto": _clean_ponto(lancado_por_ponto) or str(lancado_por_ponto).strip(),
    }
    _schedule(payload)


def push_gravacao_externa_concluida(
    *,
    gravacao_externa_id: int,
    os_ano: int,
    os_nro: int,
    lancado_por_ponto: str,
) -> None:
    from services.os_vinculo_grupo_service import _clean_ponto

    payload: dict[str, Any] = {
        "type": "gravacao_externa_concluida",
        "gravacao_externa_id": int(gravacao_externa_id),
        "os_ano": int(os_ano),
        "os_nro": int(os_nro),
        "lancado_por_ponto": _clean_ponto(lancado_por_ponto) or str(lancado_por_ponto).strip(),
    }
    _schedule(payload)


def _schedule(payload: dict[str, Any]) -> None:
    try:
        from services.notification_push_service import broadcast_ws_payload

        broadcast_ws_payload(payload)
    except Exception as exc:
        logger.error("Falha no broadcast Gravação Externa: %s", exc)
