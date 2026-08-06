"""
Schema da Prova WEB (visualizador de prova com folheamento).
Registra qual arquivo da pasta da OS é usado para gerar a prova web.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TAB_PROVA_WEB_SQL = """
CREATE TABLE IF NOT EXISTS tabProvaWeb (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    NroProtocolo INT NOT NULL,
    AnoProtocolo INT NOT NULL,
    Versao INT NOT NULL DEFAULT 1,
    PastaRender VARCHAR(64) NOT NULL DEFAULT 'Prova1',
    Modo VARCHAR(16) NOT NULL DEFAULT 'unico',
    ArquivoUnico VARCHAR(512) NULL,
    ArquivoCapa VARCHAR(512) NULL,
    ArquivoMiolo VARCHAR(512) NULL,
    CropJson JSON NULL,
    Status VARCHAR(16) NOT NULL DEFAULT 'rascunho',
    PontoRegistro INT NULL,
    DataRegistro DATETIME DEFAULT CURRENT_TIMESTAMP,
    DataAtualizacao DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_prova_web_os_versao (NroProtocolo, AnoProtocolo, Versao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def _column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(
        """
        SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table, column),
    )
    row = cursor.fetchone()
    return bool(row and int(row.get("c") or 0) > 0)


def _index_exists(cursor, table: str, index_name: str) -> bool:
    cursor.execute(
        """
        SELECT COUNT(*) AS c FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        """,
        (table, index_name),
    )
    row = cursor.fetchone()
    return bool(row and int(row.get("c") or 0) > 0)


def _ensure_prova_web_version_columns(cursor) -> None:
    """Adiciona Versao/PastaRender e troca a unique key (idempotente)."""
    if not _column_exists(cursor, "tabProvaWeb", "Versao"):
        cursor.execute(
            """
            ALTER TABLE tabProvaWeb
            ADD COLUMN Versao INT NOT NULL DEFAULT 1 AFTER AnoProtocolo
            """
        )
        logger.info("Coluna tabProvaWeb.Versao adicionada.")
    if not _column_exists(cursor, "tabProvaWeb", "PastaRender"):
        cursor.execute(
            """
            ALTER TABLE tabProvaWeb
            ADD COLUMN PastaRender VARCHAR(64) NOT NULL DEFAULT 'Prova1'
            AFTER Versao
            """
        )
        logger.info("Coluna tabProvaWeb.PastaRender adicionada.")

    if _index_exists(cursor, "tabProvaWeb", "uq_prova_web_os"):
        cursor.execute("ALTER TABLE tabProvaWeb DROP INDEX uq_prova_web_os")
        logger.info("Índice antigo uq_prova_web_os removido.")

    if not _index_exists(cursor, "tabProvaWeb", "uq_prova_web_os_versao"):
        cursor.execute(
            """
            ALTER TABLE tabProvaWeb
            ADD UNIQUE KEY uq_prova_web_os_versao
                (NroProtocolo, AnoProtocolo, Versao)
            """
        )
        logger.info("Índice uq_prova_web_os_versao criado.")

    if not _column_exists(cursor, "tabProvaWeb", "CropJson"):
        cursor.execute(
            """
            ALTER TABLE tabProvaWeb
            ADD COLUMN CropJson JSON NULL AFTER ArquivoMiolo
            """
        )
        logger.info("Coluna tabProvaWeb.CropJson adicionada.")

    if not _column_exists(cursor, "tabProvaWeb", "Status"):
        cursor.execute(
            """
            ALTER TABLE tabProvaWeb
            ADD COLUMN Status VARCHAR(16) NOT NULL DEFAULT 'publicado'
            AFTER CropJson
            """
        )
        logger.info("Coluna tabProvaWeb.Status adicionada (existentes=publicado).")


def ensure_prova_web_schema() -> None:
    """Cria/atualiza tabProvaWeb (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB_PROVA_WEB_SQL)
            _ensure_prova_web_version_columns(cursor)
    except Exception as exc:
        logger.error("Erro ao garantir schema tabProvaWeb: %s", exc)
        raise
