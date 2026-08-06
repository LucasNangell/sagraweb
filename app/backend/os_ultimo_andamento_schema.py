"""
Tabela materializada: último andamento operacional por OS principal.
Idempotente no startup — não altera MDB.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_ultimo_andamento_operacional (
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    cod_status VARCHAR(32) NULL,
    situacao VARCHAR(120) NULL,
    setor VARCHAR(80) NULL,
    `data` DATETIME NULL,
    observacao TEXT NULL,
    ponto VARCHAR(32) NULL,
    ultimo_status TINYINT(1) NOT NULL DEFAULT 0,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (nro_protocolo, ano_protocolo),
    INDEX idx_ua_oper_situacao (situacao),
    INDEX idx_ua_oper_setor (setor),
    INDEX idx_ua_oper_setor_situacao (setor, situacao),
    INDEX idx_ua_oper_data (`data`),
    INDEX idx_ua_oper_ano_nro (ano_protocolo, nro_protocolo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def ensure_os_ultimo_andamento_schema() -> None:
    """Cria tabela e índices se ainda não existirem."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TABLE_SQL)
        logger.info("Schema tab_os_ultimo_andamento_operacional verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema ultimo andamento operacional: %s", exc)
        raise
