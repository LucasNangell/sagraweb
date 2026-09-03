"""Schema do baseline versionado do Gantt de fluxo de produção."""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)

_CREATE_TAB = """
CREATE TABLE IF NOT EXISTS tab_os_fluxo_baseline (
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    versao INT NOT NULL DEFAULT 1,
    inicio_producao_em DATETIME NULL,
    etapas_json JSON NOT NULL,
    produto VARCHAR(255) NULL,
    tiragem INT NULL,
    pags INT NULL,
    tecnologia VARCHAR(16) NULL,
    hash_entrada CHAR(64) NOT NULL,
    modelo_versao VARCHAR(32) NOT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (nro_protocolo, ano_protocolo),
    KEY idx_fluxo_baseline_atualizado (atualizado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_schema_ready = False


def ensure_os_fluxo_baseline_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB)
        _schema_ready = True
        logger.info("Schema tab_os_fluxo_baseline verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema de fluxo baseline: %s", exc)
        raise
