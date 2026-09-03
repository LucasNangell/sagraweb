"""Flags de funcionalidades em desenvolvimento (config/dev_features.json)."""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any, Dict, List, TypedDict

logger = logging.getLogger(__name__)

_SETTINGS_PATH = Path(__file__).resolve().parents[3] / "config" / "dev_features.json"
_lock = threading.Lock()


class FeatureDef(TypedDict):
    id: str
    label: str
    description: str
    default: bool


FEATURE_CATALOG: List[FeatureDef] = [
    {
        "id": "sequencia_producao",
        "label": "Sequência de produção",
        "description": (
            "Mostra a aba Sequência de produção no detalhe da OS (modal de gerência)."
        ),
        "default": False,
    },
    {
        "id": "fluxo_producao",
        "label": "Fluxo de produção",
        "description": (
            "Mostra a aba Fluxo de produção (Gantt) no detalhe da OS (modal de gerência)."
        ),
        "default": False,
    },
]

_KNOWN_IDS = {item["id"] for item in FEATURE_CATALOG}


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


def _enabled_map(raw: Dict[str, object]) -> Dict[str, bool]:
    enabled: Dict[str, bool] = {}
    for item in FEATURE_CATALOG:
        feature_id = item["id"]
        value = raw.get(feature_id)
        enabled[feature_id] = bool(value) if isinstance(value, bool) else item["default"]
    return enabled


def get_features_payload() -> Dict[str, Any]:
    with _lock:
        raw = _load_raw()
    enabled = _enabled_map(raw)
    features = [
        {
            "id": item["id"],
            "label": item["label"],
            "description": item["description"],
            "enabled": enabled[item["id"]],
        }
        for item in FEATURE_CATALOG
    ]
    return {"features": features, "enabled": enabled}


def is_feature_enabled(feature_id: str) -> bool:
    payload = get_features_payload()
    return bool(payload["enabled"].get(feature_id, False))


def set_features_enabled(updates: Dict[str, bool]) -> Dict[str, Any]:
    with _lock:
        raw = _load_raw()
        for key, value in updates.items():
            feature_id = str(key).strip()
            if feature_id not in _KNOWN_IDS:
                continue
            raw[feature_id] = bool(value)
        _save_raw(raw)
    return get_features_payload()
