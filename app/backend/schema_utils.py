"""Utilitários de schema: migrações aditivas idempotentes sem ruído de log.

Checa `information_schema` antes do `ALTER ... ADD COLUMN` — evita o erro
"Duplicate column" a cada boot. Importante: `database.execute_query` loga TODO
MySQLError em nível ERROR *antes* de propagar, então apenas capturar no chamador
não silencia o ruído; é preciso não executar o ALTER quando a coluna já existe.

Nomes de tabela/coluna aqui são constantes internas do código (nunca entrada do
usuário), por isso o uso em f-string no DDL é seguro.
"""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)


def column_exists(table: str, column: str) -> bool:
    rows = db.execute_query(
        """
        SELECT COUNT(*) AS c
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table, column),
    )
    return bool(rows and rows[0].get("c"))


def ensure_columns(table: str, columns: dict[str, str]) -> None:
    """Adiciona apenas as colunas que faltam.

    `columns`: {nome_coluna: definição_ddl} — ex.: {"ConfigVersion": "INT NOT NULL DEFAULT 1"}.
    """
    for name, ddl in columns.items():
        try:
            if column_exists(table, name):
                continue
            db.execute_query(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
            logger.info("Schema: coluna %s.%s adicionada", table, name)
        except Exception as exc:
            logger.warning("Schema: falha ao garantir coluna %s.%s: %s", table, name, exc)
