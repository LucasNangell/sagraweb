"""
Permissões de painel: global separado e setores individuais (JSON).
Compatível com sb_dashboard_setor legado (acesso a todos os setores).
"""
from __future__ import annotations

import json
from typing import Any

LEGACY_DASHBOARD_SETOR_KEY = "sb_dashboard_setor"
DASHBOARD_GLOBAL_KEY = "sb_dashboard_global"
PAINEL_SETORES_KEY = "painel_setores"


def parse_painel_setores_raw(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return sorted({str(s).strip() for s in raw if str(s) and str(s).strip()})
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return []
        if isinstance(data, list):
            return sorted({str(s).strip() for s in data if str(s) and str(s).strip()})
    return []


def enrich_permissions(perms: dict[str, Any]) -> dict[str, Any]:
    """Normaliza campos de painel para API e guards."""
    legacy_all = bool(perms.get(LEGACY_DASHBOARD_SETOR_KEY, False))
    setores = parse_painel_setores_raw(perms.get(PAINEL_SETORES_KEY))
    global_ok = bool(perms.get(DASHBOARD_GLOBAL_KEY, False))

    perms[DASHBOARD_GLOBAL_KEY] = global_ok
    perms[PAINEL_SETORES_KEY] = setores
    perms[LEGACY_DASHBOARD_SETOR_KEY] = legacy_all or bool(setores)
    perms["painel_setores_legacy_all"] = legacy_all and not setores
    return perms


def serialize_painel_setores(setores: list[str]) -> str:
    clean = sorted({str(s).strip() for s in setores if str(s).strip()})
    return json.dumps(clean, ensure_ascii=False)
