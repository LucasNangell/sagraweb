"""Schema do calendário de dias não úteis (feriados, recesso, etc.)."""
from __future__ import annotations

import logging
from datetime import date

from database import db

logger = logging.getLogger(__name__)

_CREATE_TAB = """
CREATE TABLE IF NOT EXISTS tab_calendario_nao_util (
    `data` DATE NOT NULL PRIMARY KEY,
    descricao VARCHAR(120) NOT NULL,
    tipo ENUM('feriado','recesso','ponto_facultativo','manutencao') NOT NULL DEFAULT 'feriado',
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

# Seed mínimo: feriados nacionais fixos (mês/dia) + exemplos de recesso típico.
# Anos cobertos no seed: 2024–2028.
_FIXED_HOLIDAYS = [
    (1, 1, "Confraternização Universal"),
    (4, 21, "Tiradentes"),
    (5, 1, "Dia do Trabalho"),
    (9, 7, "Independência do Brasil"),
    (10, 12, "Nossa Senhora Aparecida"),
    (11, 2, "Finados"),
    (11, 15, "Proclamação da República"),
    (12, 25, "Natal"),
]

_schema_ready = False


def _seed_rows() -> list[tuple[date, str, str]]:
    rows: list[tuple[date, str, str]] = []
    for year in range(2024, 2029):
        for month, day, label in _FIXED_HOLIDAYS:
            rows.append((date(year, month, day), label, "feriado"))
        # Recesso típico fim de ano (ajuste manual via tabela se necessário)
        rows.append((date(year, 12, 24), "Véspera de Natal", "ponto_facultativo"))
        rows.append((date(year, 12, 31), "Véspera de Ano Novo", "ponto_facultativo"))
    return rows


def ensure_calendario_nao_util_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB)
            for d, desc, tipo in _seed_rows():
                cursor.execute(
                    """
                    INSERT IGNORE INTO tab_calendario_nao_util (`data`, descricao, tipo)
                    VALUES (%s, %s, %s)
                    """,
                    (d.isoformat(), desc, tipo),
                )
        _schema_ready = True
        logger.info("Schema tab_calendario_nao_util verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema de calendário não útil: %s", exc)
        raise
