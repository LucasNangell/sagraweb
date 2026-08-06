"""Envio de e-mail de ativação de conta do portal do cliente (gabinete)."""
from __future__ import annotations

import logging
import os

from config_manager import config_manager
from services.activation_email_service import (
    _activation_from_mailbox,
    resolve_link_web_base,
)

logger = logging.getLogger(__name__)


def build_cliente_activation_link(token: str) -> str:
    return f"{resolve_link_web_base()}/cliente/login/activate?token={token}"


def build_cliente_portal_login_url() -> str:
    return f"{resolve_link_web_base()}/cliente/login"


def _vinculo_tipo_label(tipo_conta: str) -> str:
    return "órgão" if str(tipo_conta or "").strip().lower() == "orgao" else "gabinete"


def send_cliente_activation_email(
    *,
    to_email: str,
    nome: str,
    gabinete: str,
    token: str,
    tipo_conta: str = "gabinete",
) -> None:
    from services.email_template_service import get_rendered_html, get_rendered_subject

    link = build_cliente_activation_link(token)
    portal_url = build_cliente_portal_login_url()
    vinculo_tipo = _vinculo_tipo_label(tipo_conta)
    variables = {
        "nome": nome,
        "link": link,
        "gabinete": gabinete,
        "tipo_conta": tipo_conta,
        "vinculo_tipo": vinculo_tipo,
        "portal_url": portal_url,
    }
    subject = get_rendered_subject("cliente_activation", variables)
    html_body = get_rendered_html("cliente_activation", variables)

    try:
        from services.ews_service import EWSService
        from services.email_config_service import DEFAULT_EWS_URL, DEFAULT_VERIFY_SSL

        ews_url = os.getenv("EWS_URL", DEFAULT_EWS_URL)
        verify_ssl = os.getenv("EWS_VERIFY_SSL", str(DEFAULT_VERIFY_SSL)).lower() in (
            "1",
            "true",
            "yes",
        )
        service = EWSService(ews_url=ews_url, verify_ssl=verify_ssl)
        from_mailbox = _activation_from_mailbox() or None
        service.send_email(
            to=[to_email],
            subject=subject,
            html_body=html_body,
            from_mailbox=from_mailbox,
        )
        logger.info(
            "E-mail de ativação (cliente) enviado para %s link=%s",
            to_email,
            link,
        )
    except Exception as exc:
        logger.error("Falha ao enviar e-mail de ativação (cliente) para %s: %s", to_email, exc)
        if config_manager.is_development():
            logger.warning("DEV: link de ativação cliente = %s", link)
            return
        raise
