"""Estado em processo do comando admin force_refresh (fallback de poll)."""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

_lock = threading.Lock()
_epoch = 0
_overwrite_config = False
_at: str | None = None


def is_admin_force_reload(message: dict[str, Any] | None) -> bool:
    if not isinstance(message, dict):
        return False
    if message.get("type") != "force_refresh":
        return False
    action = str(message.get("action") or "").strip()
    origem = str(message.get("origem") or "").strip()
    return action == "reload" or origem == "admin_panel"


def record_admin_reload(*, overwrite_config: bool) -> dict[str, Any]:
    global _epoch, _overwrite_config, _at
    with _lock:
        _epoch += 1
        _overwrite_config = bool(overwrite_config)
        _at = datetime.now(timezone.utc).isoformat()
        return {
            "epoch": _epoch,
            "overwriteConfig": _overwrite_config,
            "at": _at,
        }


def get_admin_reload_state() -> dict[str, Any]:
    with _lock:
        return {
            "epoch": _epoch,
            "overwriteConfig": _overwrite_config,
            "at": _at,
        }


def reset_admin_reload_state_for_tests() -> None:
    global _epoch, _overwrite_config, _at
    with _lock:
        _epoch = 0
        _overwrite_config = False
        _at = None
