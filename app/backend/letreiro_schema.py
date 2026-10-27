"""Schema: instâncias e config remota do letreiro WPF."""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

CREATE_TAB_LETREIRO_INSTANCIA = """
CREATE TABLE IF NOT EXISTS tabLetreiroInstancia (
    HostName VARCHAR(128) NOT NULL,
    WindowsUser VARCHAR(128) NOT NULL,
    Version VARCHAR(32) NOT NULL DEFAULT '',
    Ponto VARCHAR(32) NOT NULL DEFAULT '',
    LastSeen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (HostName, WindowsUser),
    KEY idx_letreiro_instancia_seen (LastSeen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

CREATE_TAB_LETREIRO_CONFIG = """
CREATE TABLE IF NOT EXISTS tabLetreiroConfig (
    HostName VARCHAR(128) NOT NULL,
    WindowsUser VARCHAR(128) NOT NULL,
    Payload JSON NOT NULL,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UpdatedBy VARCHAR(128) NOT NULL DEFAULT '',
    PRIMARY KEY (HostName, WindowsUser),
    KEY idx_letreiro_config_updated (UpdatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""


def ensure_letreiro_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(CREATE_TAB_LETREIRO_INSTANCIA)
            cursor.execute(CREATE_TAB_LETREIRO_CONFIG)
        logger.info("Schema letreiro verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema letreiro: %s", exc)
        raise
