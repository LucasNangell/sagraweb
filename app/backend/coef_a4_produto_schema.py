"""Tabela de coeficiente A4 por produto de papelaria (SP >= 5000)."""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS tabCoefA4Produto (
    Produto VARCHAR(128) NOT NULL,
    Coeficiente DECIMAL(10, 4) NOT NULL,
    Amostras INT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (Produto)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def ensure_coef_a4_produto_schema() -> None:
    """Cria tabCoefA4Produto (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_SQL)
    except Exception as exc:
        logger.error("Erro ao migrar schema coef_a4_produto: %s", exc)
        raise
