"""Evita suspensão/hibernação do Windows enquanto o worker está ativo."""
from __future__ import annotations

import logging
import sys

logger = logging.getLogger(__name__)

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001

_active = False


def _is_windows() -> bool:
    return sys.platform == "win32"


def prevent_sleep() -> bool:
    """Impede suspensão do sistema (não afeta bloqueio de tela nem monitor)."""
    global _active
    if not _is_windows():
        logger.warning(
            "Proteção contra suspensão indisponível fora do Windows — ignorando."
        )
        return False
    import ctypes

    ctypes.windll.kernel32.SetThreadExecutionState(
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    )
    _active = True
    return True


def allow_sleep() -> bool:
    """Restaura comportamento normal de suspensão do sistema."""
    global _active
    if not _is_windows():
        return False
    if not _active:
        return False
    import ctypes

    ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS)
    _active = False
    return True


def sleep_guard_active() -> bool:
    return _active
