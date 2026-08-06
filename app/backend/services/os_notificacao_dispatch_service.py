"""Dispara notificações (DB + WS + Web Push) para inscrições de OS."""
from __future__ import annotations

import json
import logging
import unicodedata
from typing import Any

from services.notification_push_service import insert_user_notification, push_user_notification
from services.os_notificacao_watch_service import list_andamento_watchers, list_os_change_watchers
from services.web_push_service import send_web_push_to_ponto

logger = logging.getLogger(__name__)

_ERROR_SITUATION_TERMS = ("erro", "falha", "problema tecnico", "cancelad")


def is_error_situation(situacao: str | None) -> bool:
    normalized = unicodedata.normalize("NFKD", str(situacao or "").strip().lower())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    return any(term in normalized for term in _ERROR_SITUATION_TERMS)


def _os_url(nro: int, ano: int) -> str:
    try:
        from config_manager import config_manager

        base = config_manager.get_public_web_base().rstrip("/")
        return f"{base}/gerencia?ano={ano}&id={nro}"
    except Exception:
        return f"/gerencia?ano={ano}&id={nro}"


def _notify_ponto(
    *,
    ponto: str,
    nro: int,
    ano: int,
    mensagem: str,
    action: str,
    detalhes: dict[str, Any] | None = None,
    browser_notify: bool = False,
) -> None:
    detalhes_json = json.dumps(detalhes or {"type": action}, ensure_ascii=False)
    notification_id = insert_user_notification(
        ponto=ponto,
        nro=nro,
        ano=ano,
        mensagem=mensagem,
        detalhes_json=detalhes_json,
    )
    push_user_notification(
        target_ponto=ponto,
        mensagem=mensagem,
        nro=nro,
        ano=ano,
        notification_id=notification_id,
        action=action,
        browser_notify=browser_notify,
    )
    if browser_notify:
        send_web_push_to_ponto(
            ponto=ponto,
            title=f"OS {nro}/{ano}",
            body=mensagem,
            url=_os_url(nro, ano),
            tag=f"os-{nro}-{ano}",
            nro=nro,
            ano=ano,
        )


def dispatch_andamento_notifications(
    *,
    nro: int,
    ano: int,
    situacao: str | None,
    setor: str | None,
    action: str,
) -> None:
    try:
        pontos = list_andamento_watchers(nro=nro, ano=ano, situacao=situacao, setor=setor)
        if not pontos:
            return
        sit_label = (situacao or "").strip() or "—"
        sec_label = (setor or "").strip() or "—"
        mensagem = f"Andamento na OS {nro}/{ano}: {sit_label} ({sec_label})."
        browser_notify = is_error_situation(situacao)
        for ponto in pontos:
            _notify_ponto(
                ponto=ponto,
                nro=nro,
                ano=ano,
                mensagem=mensagem,
                action="os_watch_andamento",
                detalhes={
                    "type": "os_watch_andamento",
                    "situacao": situacao,
                    "setor": setor,
                    "source_action": action,
                },
                browser_notify=browser_notify,
            )
    except Exception as exc:
        logger.warning("Falha ao disparar notificações de andamento OS %s/%s: %s", nro, ano, exc)


def dispatch_os_change_notifications(
    *,
    nro: int,
    ano: int,
    changes: dict[str, Any] | None = None,
) -> None:
    try:
        pontos = list_os_change_watchers(nro=nro, ano=ano)
        if not pontos:
            return
        mensagem = f"A OS {nro}/{ano} sofreu alterações nas informações."
        for ponto in pontos:
            _notify_ponto(
                ponto=ponto,
                nro=nro,
                ano=ano,
                mensagem=mensagem,
                action="os_watch_change",
                detalhes={"type": "os_watch_change", "changes": changes or {}},
            )
    except Exception as exc:
        logger.warning("Falha ao disparar notificações de alteração OS %s/%s: %s", nro, ano, exc)
