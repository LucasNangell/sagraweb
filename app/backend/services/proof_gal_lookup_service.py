"""Lookup de nome no GAL (Exchange) para o portal de prova."""
from __future__ import annotations

import logging
import re

from services.email_config_service import (
    GLOBAL_EMAIL_CONFIG_PONTO,
    get_default_runtime_config,
    get_runtime_config,
)

logger = logging.getLogger(__name__)

_PONTO_LABEL_RE = re.compile(r"^P_\d+$", re.IGNORECASE)
MIN_PONTO_DIGITS = 4
MAX_PONTO_DIGITS = 8
GAL_LOOKUP_TIMEOUT_SEC = 8


def normalize_ponto_digits(value: str) -> str:
    return "".join(c for c in (value or "") if c.isdigit())


def is_valid_ponto_digits(digits: str) -> bool:
    return MIN_PONTO_DIGITS <= len(digits) <= MAX_PONTO_DIGITS


def pick_gal_display_name(items: list[dict], digits: str) -> str | None:
    """Escolhe um nome de pessoa; ignora rótulos só com P_1234."""
    query = f"P_{digits}".lower()
    ranked: list[tuple[int, str]] = []
    for item in items:
        name = str(item.get("name") or "").strip()
        email = str(item.get("email") or "").strip().lower()
        if not name or _PONTO_LABEL_RE.fullmatch(name):
            continue
        score = 0
        compact_email = email.replace(".", "").replace("_", "")
        if digits in compact_email:
            score += 2
        if query in name.lower().replace(" ", ""):
            score += 1
        ranked.append((score, name))
    if not ranked:
        return None
    ranked.sort(key=lambda row: -row[0])
    return ranked[0][1]


def lookup_display_name_for_ponto(digits: str) -> str | None:
    """Resolve P_{dígitos} no GAL. Sem resultado ou EWS indisponível → None."""
    if not is_valid_ponto_digits(digits):
        return None
    try:
        from services.ews_service import EWSService, EWSUnavailableError
    except ImportError:
        logger.warning("GAL lookup indisponível: EWSService não importou")
        return None

    cfg = get_runtime_config(GLOBAL_EMAIL_CONFIG_PONTO) or get_default_runtime_config()
    query = f"P_{digits}"
    try:
        service = EWSService(
            ews_url=cfg.ews_url,
            verify_ssl=cfg.verify_ssl,
            timeout=GAL_LOOKUP_TIMEOUT_SEC,
        )
        items = service.resolve_names(query, max_results=8)
    except EWSUnavailableError:
        logger.warning("GAL lookup Exchange indisponível ponto_len=%s", len(digits))
        return None
    except Exception:
        logger.exception("GAL lookup falhou ponto_len=%s", len(digits))
        return None
    return pick_gal_display_name(items, digits)
