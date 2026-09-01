"""Validação de Nr OS / ano contra tabProtocolos (MySQL)."""
from __future__ import annotations

from database import db

ANO_MIN = 2000
ANO_MAX = 2100


class OsProtocoloGuardError(ValueError):
    """Ano inválido ou protocolo inexistente no MySQL."""


def normalize_ano(ano: int) -> int:
    """
    Expande ano de 2 dígitos (26 → 2026). Rejeita 3 dígitos (216) e
    valores fora de 2000–2100.
    """
    try:
        year = int(ano)
    except (TypeError, ValueError) as exc:
        raise OsProtocoloGuardError("Ano inválido.") from exc
    if year < 0:
        raise OsProtocoloGuardError(f"Ano {ano} inválido.")
    if year < 100:
        year += 2000
    if year < ANO_MIN or year > ANO_MAX:
        raise OsProtocoloGuardError(
            f"Ano {ano} inválido. Informe um ano com 4 dígitos entre {ANO_MIN} e {ANO_MAX}."
        )
    return year


def require_protocolo_mysql(nro: int, ano: int) -> int:
    """
    Normaliza o ano e exige que (nro, ano) exista em tabProtocolos.
    Retorna o ano normalizado. Raises OsProtocoloGuardError.
    """
    try:
        nro_i = int(nro)
    except (TypeError, ValueError) as exc:
        raise OsProtocoloGuardError("Número de OS inválido.") from exc
    if nro_i <= 0:
        raise OsProtocoloGuardError("Número de OS inválido.")
    ano_n = normalize_ano(ano)
    rows = db.execute_query(
        "SELECT 1 FROM tabProtocolos WHERE NroProtocolo = %s AND AnoProtocolo = %s",
        (nro_i, ano_n),
    )
    if not rows:
        raise OsProtocoloGuardError(f"OS {nro_i}/{ano_n} não encontrada.")
    return ano_n
