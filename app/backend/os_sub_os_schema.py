"""
Garante tabelas MySQL-only para Sub OS por componente.
Não altera nem sincroniza MDB.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_COMPONENTES_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_componentes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    nome VARCHAR(120) NOT NULL,
    nome_normalizado VARCHAR(120) NOT NULL,
    tipo VARCHAR(20) NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    techspec_json JSON NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por VARCHAR(32) NULL,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(32) NULL,
    INDEX idx_os_componentes_os (ano_protocolo, nro_protocolo, ativo),
    INDEX idx_os_componentes_nome_norm (ano_protocolo, nro_protocolo, nome_normalizado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_SUB_OS_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_sub_os (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    componente_id BIGINT NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    congelada TINYINT(1) NOT NULL DEFAULT 0,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por VARCHAR(32) NULL,
    UNIQUE KEY uk_sub_os_os_componente (ano_protocolo, nro_protocolo, componente_id),
    INDEX idx_sub_os_os (ano_protocolo, nro_protocolo, ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_SUB_OS_ANDAMENTO_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_sub_os_andamento (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sub_os_id BIGINT NOT NULL,
    situacao VARCHAR(120) NOT NULL,
    setor VARCHAR(80) NOT NULL,
    observacao TEXT NULL,
    data DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ultimo_status TINYINT(1) NOT NULL DEFAULT 0,
    ponto VARCHAR(32) NULL,
    cod_status_espelho VARCHAR(32) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por VARCHAR(32) NULL,
    INDEX idx_sub_os_andamento_sub (sub_os_id, ultimo_status),
    INDEX idx_sub_os_andamento_espelho (cod_status_espelho)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_SUB_OS_ANDAMENTO_MIGRATIONS = (
    "source_type VARCHAR(32) NULL DEFAULT 'manual_sub_os'",
    "source_cod_status VARCHAR(32) NULL",
    "herdado_da_os_principal TINYINT(1) NOT NULL DEFAULT 0",
)


def _migrate_sub_os_andamento_columns(cursor) -> None:
    for col_ddl in _SUB_OS_ANDAMENTO_MIGRATIONS:
        col_name = col_ddl.split()[0]
        try:
            cursor.execute(
                f"ALTER TABLE tab_os_sub_os_andamento ADD COLUMN {col_ddl}"
            )
            logger.info("Coluna %s adicionada em tab_os_sub_os_andamento", col_name)
        except Exception as exc:
            if "Duplicate column" not in str(exc):
                logger.debug("Migração coluna %s: %s", col_name, exc)


def ensure_os_sub_os_schema() -> None:
    """Cria tabelas de componentes/Sub OS se não existirem (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_COMPONENTES_SQL)
            cursor.execute(_CREATE_SUB_OS_SQL)
            cursor.execute(_CREATE_SUB_OS_ANDAMENTO_SQL)
            _migrate_sub_os_andamento_columns(cursor)
            try:
                cursor.execute(
                    """
                    CREATE UNIQUE INDEX uk_sub_os_andamento_inherited
                    ON tab_os_sub_os_andamento (sub_os_id, source_cod_status)
                    """
                )
                logger.info("Índice uk_sub_os_andamento_inherited criado")
            except Exception as exc:
                if "Duplicate key name" not in str(exc) and "already exists" not in str(exc):
                    logger.debug("Índice inherited: %s", exc)
        logger.info("Schema Sub OS verificado/criado com sucesso")
    except Exception as exc:
        logger.error("Erro ao garantir schema Sub OS: %s", exc)
        raise
