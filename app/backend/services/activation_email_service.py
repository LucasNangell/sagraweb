"""Envio de e-mail de ativação de conta via EWS (Exchange)."""
from __future__ import annotations

import logging
import os
from ipaddress import ip_address
from urllib.parse import urlparse

from config_manager import config_manager

logger = logging.getLogger(__name__)

# Base padrão para links em e-mails e portais (intranet)
DEFAULT_PUBLIC_WEB_BASE = "http://cgrafsysvm"


def _is_non_public_web_base(base: str) -> bool:
    """True quando a base é apenas dev local (substituída pelo DEFAULT_PUBLIC_WEB_BASE)."""
    try:
        host = (urlparse(base).hostname or "").strip().lower()
    except Exception:
        return True
    if not host:
        return True
    if host in ("localhost", "127.0.0.1") or host.endswith(".local"):
        return True
    try:
        addr = ip_address(host)
        return addr.is_loopback
    except ValueError:
        return False


def resolve_link_web_base() -> str:
    """URL base para links em e-mails e portais — sempre intranet (cgrafsysvm)."""
    explicit = (
        os.getenv("SAGRA_PUBLIC_WEB_BASE", "").strip()
        or os.getenv("SAGRA_PUBLIC_DOMAIN", "").strip()
    )
    if explicit:
        return explicit.rstrip("/")
    stored = (config_manager.get("public_web_base") or "").strip()
    if stored and not _is_non_public_web_base(stored):
        return stored.rstrip("/")
    return DEFAULT_PUBLIC_WEB_BASE


def _activation_from_mailbox() -> str:
    """Remetente para ativação/recuperação: config admin > SAGRA_ACTIVATION_FROM.

    EWS_USERNAME é credencial NTLM, não endereço de envio — não usar como From.
    """
    from services.email_template_service import get_global_send_mailboxes

    activation = (get_global_send_mailboxes().get("activation") or "").strip()
    if activation:
        return activation
    return (os.getenv("SAGRA_ACTIVATION_FROM") or "").strip()


def build_activation_link(token: str) -> str:
    return f"{resolve_link_web_base()}/login/activate?token={token}"


def send_activation_email(*, to_email: str, nome: str, token: str) -> None:
    from services.email_template_service import (
        get_rendered_html,
        get_rendered_subject,
    )

    link = build_activation_link(token)
    variables = {"nome": nome, "link": link}
    from services.email_template_service import get_settings_path, get_template_effective

    eff = get_template_effective("activation")
    subject = get_rendered_subject("activation", variables)
    html_body = get_rendered_html("activation", variables)
    logger.info(
        "Ativação: template custom=%s config=%s assunto_len=%s html_len=%s",
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
            "Ativação: enviando para %s from=%s",
            to_email,
            from_mailbox or "(conta autenticada EWS)",
        )
        service.send_email(
            to=[to_email],
            subject=subject,
            html_body=html_body,
            from_mailbox=from_mailbox,
        )
        logger.info("E-mail de ativação enviado para %s", to_email)
    except Exception as exc:
        logger.error("Falha ao enviar e-mail de ativação para %s: %s", to_email, exc)
        if config_manager.is_development():
            logger.warning("DEV: link de ativação = %s", link)
            return
        raise
