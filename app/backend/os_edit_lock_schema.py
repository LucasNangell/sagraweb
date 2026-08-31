"""Schema MySQL para lock pessimista de edição de OS (somente web, sem MDB)."""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

CREATE_TAB_OS_EDIT_LOCK_SQL = """
CREATE TABLE IF NOT EXISTS tab_os_edit_lock (
    nro_protocolo INT NOT NULL,
    ano_protocolo INT NOT NULL,
    ponto INT NOT NULL,
    nome VARCHAR(120) NOT NULL DEFAULT '',
    origem VARCHAR(32) NOT NULL DEFAULT 'os_edit',
    token CHAR(36) NOT NULL,
    acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nro_protocolo, ano_protocolo),
    KEY idx_os_edit_lock_heartbeat (heartbeat_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def ensure_os_edit_lock_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(CREATE_TAB_OS_EDIT_LOCK_SQL)
        logger.info("Schema tab_os_edit_lock verificado/criado com sucesso")
    except Exception as exc:
        logger.error("Erro ao garantir schema tab_os_edit_lock: %s", exc)
        raise
