"""Schema: preferências de UI por usuário (tabUserPreferences)."""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TAB_USER_PREFERENCES = """
CREATE TABLE IF NOT EXISTS tabUserPreferences (
    Ponto VARCHAR(32) NOT NULL,
    PreferenceKey VARCHAR(64) NOT NULL,
    Payload JSON NOT NULL,
    DataAtualizacao DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (Ponto, PreferenceKey),
    KEY idx_user_pref_updated (DataAtualizacao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""


def ensure_user_preferences_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB_USER_PREFERENCES)
        logger.info("Schema tabUserPreferences verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema tabUserPreferences: %s", exc)
        raise
