"""Envio de e-mail de recuperação de senha via EWS (Exchange)."""
from __future__ import annotations

import logging
import os

from config_manager import config_manager
from services.activation_email_service import (
    _activation_from_mailbox,
    resolve_link_web_base,
)

logger = logging.getLogger(__name__)


def build_password_reset_link(token: str) -> str:
    return f"{resolve_link_web_base()}/login/reset?token={token}"


def send_password_reset_email(*, to_email: str, nome: str, token: str) -> None:
    from services.email_template_service import (
        get_rendered_html,
        get_rendered_subject,
        get_settings_path,
        get_template_effective,
    )

    link = build_password_reset_link(token)
    variables = {"nome": nome, "link": link}
    eff = get_template_effective("password_reset")
    subject = get_rendered_subject("password_reset", variables)
    html_body = get_rendered_html("password_reset", variables)
    logger.info(
        "Recuperação senha: template custom=%s config=%s assunto_len=%s html_len=%s",
        eff.get("use_custom"),
        get_settings_path(),
        len(subject),
        len(html_body),
    )

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
        logger.info(
            "Recuperação senha: enviando para %s from=%s",
            to_email,
            from_mailbox or "(conta autenticada EWS)",
        )
        service.send_email(
            to=[to_email],
            subject=subject,
            html_body=html_body,
            from_mailbox=from_mailbox or None,
        )
        logger.info("E-mail de recuperação de senha enviado para %s", to_email)
    except Exception as exc:
        logger.error("Falha ao enviar e-mail de recuperação para %s: %s", to_email, exc)
        if config_manager.is_development():
            logger.warning("DEV: link de recuperação = %s", link)
            return
        raise
