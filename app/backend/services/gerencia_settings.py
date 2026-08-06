"""Configurações da gerência (abertura de OS) persistidas em config/gerencia_settings.json."""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Dict

logger = logging.getLogger(__name__)

_SETTINGS_PATH = Path(__file__).resolve().parents[3] / "config" / "gerencia_settings.json"
_lock = threading.Lock()

_DEFAULTS: Dict[str, bool] = {
    "os_arquivos_client_email_enabled": True,
}


def _load_raw() -> Dict[str, object]:
    if not _SETTINGS_PATH.is_file():
        return {}
    try:
        with _SETTINGS_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Não foi possível ler %s: %s", _SETTINGS_PATH, exc)
        return {}


def _save_raw(data: Dict[str, object]) -> None:
    _SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = _SETTINGS_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    tmp.replace(_SETTINGS_PATH)


def get_public_settings() -> Dict[str, bool]:
    with _lock:
        raw = _load_raw()
    out = dict(_DEFAULTS)
    value = raw.get("os_arquivos_client_email_enabled")
    if isinstance(value, bool):
        out["os_arquivos_client_email_enabled"] = value
    return out


def is_os_arquivos_client_email_enabled() -> bool:
    return get_public_settings()["os_arquivos_client_email_enabled"]


def set_os_arquivos_client_email_enabled(enabled: bool) -> None:
    with _lock:
        raw = _load_raw()
        raw["os_arquivos_client_email_enabled"] = bool(enabled)
        _save_raw(raw)
