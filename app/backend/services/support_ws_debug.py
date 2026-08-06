"""Logs de diagnóstico WebSocket do chat de suporte (somente desenvolvimento)."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def ws_debug_enabled() -> bool:
    import os

    flag = os.getenv("SUPPORT_WS_DEBUG", "").strip().lower()
    if flag in ("1", "true", "yes", "on"):
        return True
    try:
        from config_manager import config_manager

        return config_manager.is_development()
    except Exception:
        return False


def ws_log(message: str, *args: Any) -> None:
    if ws_debug_enabled():
        logger.info(message, *args)
