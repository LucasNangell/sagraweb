"""E-mails de ciclo de vida da Gravação Externa."""
from __future__ import annotations

import logging
import os
from typing import Literal

from database import db
from services.activation_email_service import _activation_from_mailbox
from services.email_config_service import DEFAULT_EWS_URL, DEFAULT_VERIFY_SSL
from services.email_template_service import (
    get_gravacao_notification_settings,
    get_rendered_html,
    get_rendered_subject,
)
from services.ews_service import EWSService

logger = logging.getLogger(__name__)

GravacaoEmailEvent = Literal["encaminhada", "iniciada", "concluida"]


def _clean_ponto(value: str | None) -> str:
    return "".join(char for char in str(value or "") if char.isdigit())


def _user_email(ponto: str) -> str:
    ponto_digits = _clean_ponto(ponto)
    if not ponto_digits:
        return ""
    rows = db.execute_query(
        """
        SELECT Email
        FROM tabUsuarios
        WHERE Ponto = %s
        LIMIT 1
        """,
        (int(ponto_digits),),
    )
    return str((rows[0] if rows else {}).get("Email") or "").strip()


def _resolve_recipients(event: GravacaoEmailEvent, target_ponto: str) -> list[str]:
    event_config = get_gravacao_notification_settings()[event]
    if event_config["mode"] == "usuario":
        candidates = [_user_email(target_ponto)]
    else:
        candidates = list(event_config["recipients"])
    return list(dict.fromkeys(
        value.strip().lower()
        for value in candidates
        if value and value.strip() and "@" in value
    ))


def send_gravacao_notification_email(
    *,
    event: GravacaoEmailEvent,
    ano: int,
    os_id: int,
    target_ponto: str,
    target_nome: str | None,
    operador_ponto: str,
) -> bool:
    """Envia o aviso sem propagar falha para a alteração de status da gravação."""
    try:
        event_config = get_gravacao_notification_settings()[event]
        if not event_config.get("enabled", True):
            logger.info(
                "Notificação de gravação %s da OS %s/%s desativada na configuração",
                event,
                os_id,
                ano,
            )
            return False

        recipients = _resolve_recipients(event, target_ponto)
        if not recipients:
            logger.warning(
                "Notificação de gravação %s da OS %s/%s sem destinatário configurado",
                event,
                os_id,
                ano,
            )
            return False

        template_id = f"gravacao_{event}"
        variables = {
            "nome": (target_nome or "").strip() or "Usuário SAGRA",
            "nr_os": str(os_id),
            "ano": str(ano),
            "operador": operador_ponto,
        }
        subject = get_rendered_subject(template_id, variables)
        html_body = get_rendered_html(template_id, variables)
        verify_ssl = os.getenv("EWS_VERIFY_SSL", str(DEFAULT_VERIFY_SSL)).lower() in (
            "1",
            "true",
            "yes",
        )
        service = EWSService(
            ews_url=os.getenv("EWS_URL", DEFAULT_EWS_URL),
            verify_ssl=verify_ssl,
        )
        service.send_email(
            to=recipients,
            subject=subject,
            html_body=html_body,
            from_mailbox=_activation_from_mailbox() or None,
        )
        logger.info(
            "Notificação de gravação %s da OS %s/%s enviada para %s",
            event,
            os_id,
            ano,
            ", ".join(recipients),
        )
        return True
    except Exception as exc:
        logger.error(
            "Falha no e-mail de gravação %s da OS %s/%s: %s",
            event,
            os_id,
            ano,
            exc,
        )
        return False
