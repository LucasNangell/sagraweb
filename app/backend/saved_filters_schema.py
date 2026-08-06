"""
Garante colunas extras em tabUserSavedFilters (filtros por módulo).
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_EXTRA_COLUMNS: tuple[tuple[str, str], ...] = (
    ("FilterContext", "VARCHAR(32) NOT NULL DEFAULT 'os'"),
    # JSON opcional com critérios extras (nr_os, anos, produtos, …).
    # situacoes/setores continuam nas colunas dedicadas (compatível).
    ("Criterios", "MEDIUMTEXT NULL"),
)


def ensure_saved_filters_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'tabUserSavedFilters'
                """
            )
            existing = {row["COLUMN_NAME"] for row in cursor.fetchall()}
            for col_name, col_ddl in _EXTRA_COLUMNS:
                if col_name in existing:
                    continue
                cursor.execute(
                    f"ALTER TABLE tabUserSavedFilters ADD COLUMN {col_name} {col_ddl}"
                )
                logger.info("tabUserSavedFilters: coluna adicionada — %s", col_name)
    except Exception as exc:
        logger.error("Erro ao migrar schema tabUserSavedFilters: %s", exc)
        raise
