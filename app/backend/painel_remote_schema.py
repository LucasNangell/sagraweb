"""Schema: instâncias e config remota dos painéis OS (setor/tablet/moderno)."""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

CREATE_TAB_PAINEL_INSTANCIA = """
CREATE TABLE IF NOT EXISTS tabPainelInstancia (
    ClientId VARCHAR(64) NOT NULL,
    Nome VARCHAR(128) NOT NULL DEFAULT '',
    Setor VARCHAR(128) NOT NULL DEFAULT '',
    Descricao VARCHAR(255) NOT NULL DEFAULT '',
    Ip VARCHAR(64) NOT NULL DEFAULT '',
    Route VARCHAR(64) NOT NULL DEFAULT '',
    LastSeen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ClientId),
    KEY idx_painel_instancia_seen (LastSeen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

CREATE_TAB_PAINEL_CONFIG = """
CREATE TABLE IF NOT EXISTS tabPainelConfig (
    ClientId VARCHAR(64) NOT NULL,
    Payload JSON NOT NULL,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UpdatedBy VARCHAR(32) NOT NULL DEFAULT '',
    PRIMARY KEY (ClientId),
    KEY idx_painel_config_updated (UpdatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

CREATE_TAB_PAINEL_PRESET = """
CREATE TABLE IF NOT EXISTS tabPainelPreset (
    Id INT NOT NULL AUTO_INCREMENT,
    Nome VARCHAR(128) NOT NULL,
    Payload JSON NOT NULL,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UpdatedBy VARCHAR(32) NOT NULL DEFAULT '',
    PRIMARY KEY (Id),
    UNIQUE KEY uq_painel_preset_nome (Nome),
    KEY idx_painel_preset_updated (UpdatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""


def ensure_painel_remote_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(CREATE_TAB_PAINEL_INSTANCIA)
            cursor.execute(CREATE_TAB_PAINEL_CONFIG)
            cursor.execute(CREATE_TAB_PAINEL_PRESET)
        logger.info("Schema painel remoto verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema painel remoto: %s", exc)
        raise
