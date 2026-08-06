"""Configurações do chat de suporte persistidas em config/support_settings.json."""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Dict, List

logger = logging.getLogger(__name__)

_SETTINGS_PATH = Path(__file__).resolve().parents[3] / "config" / "support_settings.json"
_lock = threading.Lock()

_DEFAULTS: Dict[str, bool] = {
    "usuario_chat_enabled": True,
    "cliente_chat_enabled": True,
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


def _read_bool(raw: Dict[str, object], key: str) -> bool:
    value = raw.get(key)
    if isinstance(value, bool):
        return value
    return _DEFAULTS[key]


def get_public_settings() -> Dict[str, bool]:
    with _lock:
        raw = _load_raw()
    return {
        "usuario_chat_enabled": _read_bool(raw, "usuario_chat_enabled"),
        "cliente_chat_enabled": _read_bool(raw, "cliente_chat_enabled"),
    }


def is_usuario_chat_enabled() -> bool:
    return get_public_settings()["usuario_chat_enabled"]


def is_cliente_chat_enabled() -> bool:
    return get_public_settings()["cliente_chat_enabled"]


def set_support_chat_settings(
    *,
    usuario_chat_enabled: bool,
    cliente_chat_enabled: bool,
) -> None:
    with _lock:
        raw = _load_raw()
        raw["usuario_chat_enabled"] = bool(usuario_chat_enabled)
        raw["cliente_chat_enabled"] = bool(cliente_chat_enabled)
        _save_raw(raw)


def list_admin_notify_pontos() -> List[str]:
    """Pontos que recebem notificação de mensagens ao suporte."""
    from database import db

    with _lock:
        raw = _load_raw()
    manual = raw.get("admin_notify_pontos")
    pontos: list[str] = []
    if isinstance(manual, list):
        pontos.extend(str(item).strip() for item in manual if str(item).strip())

    try:
        rows = db.execute_query(
            """
            SELECT DISTINCT Ponto
            FROM user_permissions
            WHERE sb_admin_ips = 1
              AND Ponto IS NOT NULL
            """
        )
        for row in rows:
            value = str(row.get("Ponto") or "").strip()
            if value:
                pontos.append(value)
    except Exception as exc:
        logger.warning("Falha ao listar administradores para suporte: %s", exc)

    seen: set[str] = set()
    ordered: list[str] = []
    for ponto in pontos:
        if ponto in seen:
            continue
        seen.add(ponto)
        ordered.append(ponto)
    return ordered
