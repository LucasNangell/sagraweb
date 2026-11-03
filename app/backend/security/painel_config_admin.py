"""Administrador da configuração remota dos painéis OS (setor/tablet/moderno)."""
from __future__ import annotations

from typing import Optional

PAINEL_CONFIG_ADMIN_PONTO = 918713


def is_painel_config_admin_ponto(ponto: int | str | None) -> bool:
    if ponto is None:
        return False
    try:
        digits = "".join(ch for ch in str(ponto) if ch.isdigit())
        if not digits:
            return False
        return int(digits) == PAINEL_CONFIG_ADMIN_PONTO
    except (TypeError, ValueError):
        return False


def require_painel_config_admin_ponto(ponto: Optional[int | str]) -> int:
    from fastapi import HTTPException

    if not is_painel_config_admin_ponto(ponto):
        raise HTTPException(
            status_code=403,
            detail="Acesso restrito ao administrador dos painéis OS.",
        )
    return PAINEL_CONFIG_ADMIN_PONTO
