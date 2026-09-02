"""Schema do rascunho editável da sequência de produção."""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)

_CREATE_TAB_OS_SEQUENCIA_PRODUCAO = """
CREATE TABLE IF NOT EXISTS tabOsSequenciaProducao (
    Id INT AUTO_INCREMENT PRIMARY KEY,
    NroProtocolo INT NOT NULL,
    AnoProtocolo INT NOT NULL,
    DraftJson LONGTEXT NOT NULL,
    SourceHash CHAR(64) NOT NULL,
    DocxPath TEXT NULL,
    DocxGeneratedAt DATETIME NULL,
    CreatedBy VARCHAR(32) NULL,
    UpdatedBy VARCHAR(32) NULL,
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_os_sequencia (NroProtocolo, AnoProtocolo),
    KEY idx_os_sequencia_updated (UpdatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_schema_ready = False


def ensure_sequencia_producao_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB_OS_SEQUENCIA_PRODUCAO)
        _schema_ready = True
        logger.info("Schema tabOsSequenciaProducao verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema de sequência de produção: %s", exc)
        raise
