"""
Schema: setor do usuário (tabUsuarios.Setor) e padrões do painel por setor.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TAB_SETOR_PAINEL_DEFAULTS = """
CREATE TABLE IF NOT EXISTS tabSetorPainelDefaults (
    Setor VARCHAR(32) NOT NULL PRIMARY KEY,
    Payload JSON NOT NULL,
    DataAtualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_setor_painel_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'tabUsuarios'
                """
            )
            existing = {row["COLUMN_NAME"] for row in cursor.fetchall()}
            if "Setor" not in existing:
                cursor.execute(
                    "ALTER TABLE tabUsuarios ADD COLUMN Setor VARCHAR(32) NULL"
                )
                logger.info("tabUsuarios: coluna Setor adicionada")

            cursor.execute(_CREATE_TAB_SETOR_PAINEL_DEFAULTS)

            for table in ("user_permissions", "ip_permissions"):
                cursor.execute(
                    """
                    SELECT COLUMN_NAME
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = %s
                    """,
                    (table,),
                )
                cols = {row["COLUMN_NAME"] for row in cursor.fetchall()}
                if "sb_dashboard_global" not in cols:
                    cursor.execute(
                        f"ALTER TABLE {table} ADD COLUMN sb_dashboard_global TINYINT(1) NOT NULL DEFAULT 0"
                    )
                    logger.info("%s: coluna sb_dashboard_global adicionada", table)
                if "painel_setores" not in cols:
                    cursor.execute(
                        f"ALTER TABLE {table} ADD COLUMN painel_setores JSON NULL"
                    )
                    logger.info("%s: coluna painel_setores adicionada", table)
    except Exception as exc:
        logger.error("Erro ao migrar schema setor_painel: %s", exc)
        raise
