"""Schema MySQL para Gravação Externa."""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)

_SESSION_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_gravacao_externa (
  Id INT NOT NULL AUTO_INCREMENT,
  OsAno INT NOT NULL,
  OsNro INT NOT NULL,
  CodStatus VARCHAR(32) NOT NULL,
  LancadoPorPonto VARCHAR(32) NOT NULL,
  LancadoPorNome VARCHAR(128) DEFAULT NULL,
  Status VARCHAR(16) NOT NULL DEFAULT 'pendente',
  IniciadoPorPonto VARCHAR(32) DEFAULT NULL,
  IniciadoEm DATETIME DEFAULT NULL,
  CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_ge_os (OsAno, OsNro),
  KEY idx_ge_status (Status),
  KEY idx_ge_cod_status (CodStatus)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_ARQUIVO_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_gravacao_externa_arquivo (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoExternaId INT NOT NULL,
  RelativePath VARCHAR(512) NOT NULL,
  NomeArquivo VARCHAR(255) NOT NULL,
  TamanhoBytes BIGINT DEFAULT NULL,
  Ordem INT NOT NULL DEFAULT 0,
  PRIMARY KEY (Id),
  KEY idx_ge_arq_sessao (GravacaoExternaId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_MENSAGEM_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_gravacao_externa_mensagem (
  Id INT NOT NULL AUTO_INCREMENT,
  GravacaoExternaId INT NOT NULL,
  AutorPonto VARCHAR(32) NOT NULL,
  AutorNome VARCHAR(128) DEFAULT NULL,
  AutorPapel VARCHAR(16) NOT NULL,
  Mensagem TEXT NOT NULL,
  CriadoEm DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (Id),
  KEY idx_ge_msg_sessao (GravacaoExternaId),
  KEY idx_ge_msg_data (CriadoEm)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_CATALOG_SEEDED = False


def _column_exists(table: str, column: str) -> bool:
    rows = db.execute_query(
        """
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        LIMIT 1
        """,
        (table, column),
    )
    return bool(rows)


def _index_exists(table: str, index_name: str) -> bool:
    rows = db.execute_query(
        """
        SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND INDEX_NAME = %s
        LIMIT 1
        """,
        (table, index_name),
    )
    return bool(rows)


def _ensure_ge_fornecedor_index() -> None:
    if not _column_exists("tab_os_gravacao_externa", "FornecedorPonto"):
        return
    if _index_exists("tab_os_gravacao_externa", "idx_ge_fornecedor"):
        return
    try:
        db.execute_query(
            """
            ALTER TABLE tab_os_gravacao_externa
            ADD INDEX idx_ge_fornecedor (FornecedorPonto)
            """
        )
        logger.info("Índice idx_ge_fornecedor adicionado em tab_os_gravacao_externa")
    except Exception as exc:
        logger.warning("Índice idx_ge_fornecedor ignorado: %s", exc)


def _apply_externa_migrations() -> None:
    migrations = (
        (
            "tab_os_gravacao_externa",
            "OrigemPendenteId",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN OrigemPendenteId INT DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "JuntadaGrupoId",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN JuntadaGrupoId CHAR(36) DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "FornecedorPonto",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN FornecedorPonto VARCHAR(32) DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "ConcluidaEm",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN ConcluidaEm DATETIME DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "ConcluidaPorPonto",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN ConcluidaPorPonto VARCHAR(32) DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "EntregaLancadaEm",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN EntregaLancadaEm DATETIME DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "RecebidoPorPonto",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN RecebidoPorPonto VARCHAR(32) DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "RecebidoPorNome",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN RecebidoPorNome VARCHAR(128) DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa",
            "PagamentoNfEm",
            "ALTER TABLE tab_os_gravacao_externa ADD COLUMN PagamentoNfEm DATETIME DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa_arquivo",
            "AbsolutePath",
            "ALTER TABLE tab_os_gravacao_externa_arquivo ADD COLUMN AbsolutePath VARCHAR(1024) DEFAULT NULL",
        ),
        (
            "tab_os_gravacao_externa_arquivo",
            "Maquina",
            "ALTER TABLE tab_os_gravacao_externa_arquivo ADD COLUMN Maquina VARCHAR(128) DEFAULT NULL",
        ),
    )
    for table, column, ddl in migrations:
        if not _column_exists(table, column):
            db.execute_query(ddl)
            logger.info("Coluna %s.%s adicionada", table, column)
    _ensure_ge_fornecedor_index()
    if _column_exists("tab_os_gravacao_externa", "JuntadaGrupoId"):
        if not _index_exists("tab_os_gravacao_externa", "idx_ge_juntada"):
            try:
                db.execute_query(
                    "ALTER TABLE tab_os_gravacao_externa ADD INDEX idx_ge_juntada (JuntadaGrupoId)"
                )
                logger.info("Índice idx_ge_juntada adicionado")
            except Exception as exc:
                logger.warning("Índice idx_ge_juntada ignorado: %s", exc)


def ensure_gravacao_externa_schema() -> None:
    global _CATALOG_SEEDED
    try:
        db.execute_query(_SESSION_SQL)
        db.execute_query(_ARQUIVO_SQL)
        db.execute_query(_MENSAGEM_SQL)
        _apply_externa_migrations()
        if not _CATALOG_SEEDED:
            _seed_situacao_catalog()
            _CATALOG_SEEDED = True
        logger.info("Schema Gravação Externa verificado")
    except Exception as exc:
        logger.error("Falha ao garantir schema Gravação Externa: %s", exc)
        raise


def _seed_situacao_catalog() -> None:
    try:
        db.execute_query(
            """
            INSERT IGNORE INTO tabSystemCatalog (Categoria, Rotulo, Ativo, Ordem, Origem)
            VALUES ('situacao', 'Gravação Externa', 1, 50, 'catalog')
            """
        )
    except Exception as exc:
        logger.warning("Seed situação Gravação Externa ignorado: %s", exc)
