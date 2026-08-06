"""Utilitários para evitar vazamento de segredos em logs."""
from __future__ import annotations


def mask_token(value: str | None, *, visible: int = 4) -> str:
    """Mascara token/secret para logs (ex.: abcd…wxyz)."""
    if not value:
        return "<vazio>"
    raw = str(value).strip()
    if len(raw) <= visible * 2:
        return "***"
    return f"{raw[:visible]}…{raw[-visible:]}"


def mask_path_for_log(path: str | None) -> str:
    """Exibe apenas o nome do arquivo, sem caminho completo da rede."""
    if not path:
        return "<vazio>"
    normalized = str(path).replace("\\", "/")
    if "/" in normalized:
        return f"…/{normalized.rsplit('/', 1)[-1]}"
    return normalized
