"""
Persistência das verificações de pré-análise habilitadas/desabilitadas.

Arquivo: config/pre_analise_checks.json — apenas IDs desabilitados são gravados.
Ausência no arquivo = verificação habilitada (comportamento legado).
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Dict, List, Set

logger = logging.getLogger(__name__)

_SETTINGS_PATH = Path(__file__).resolve().parents[4] / "config" / "pre_analise_checks.json"
_lock = threading.Lock()


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


_LEGACY_DISABLED_ALIASES = {
    "formato_impressao": "formato",
}


def get_disabled_check_ids() -> Set[str]:
    with _lock:
        raw = _load_raw()
    disabled = raw.get("disabled")
    if not isinstance(disabled, list):
        return set()
    out = {str(item).strip() for item in disabled if str(item).strip()}
    for old_id, new_id in _LEGACY_DISABLED_ALIASES.items():
        if old_id in out:
            out.add(new_id)
    return out


def is_check_enabled(check_id: str) -> bool:
    return check_id not in get_disabled_check_ids()


def set_disabled_check_ids(disabled: Set[str]) -> None:
    with _lock:
        _save_raw({"disabled": sorted(disabled)})


def get_enabled_check_ids(registered_ids: List[str]) -> List[str]:
    disabled = get_disabled_check_ids()
    return [cid for cid in registered_ids if cid not in disabled]
