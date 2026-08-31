"""Schema MySQL para fotos cadastradas de solicitantes (modal da OS)."""
from __future__ import annotations

import logging
from pathlib import Path

from database import Database

logger = logging.getLogger(__name__)

CREATE_TAB_SOLICITANTE_FOTO_SQL = """
CREATE TABLE IF NOT EXISTS tab_solicitante_foto (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    solicitante VARCHAR(255) NOT NULL,
    solicitante_normalizado VARCHAR(255) NOT NULL,
    image_path VARCHAR(512) NOT NULL,
    content_type VARCHAR(64) NOT NULL DEFAULT 'image/jpeg',
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_solicitante_foto_norm (solicitante_normalizado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def solicitante_fotos_dir() -> Path:
    root = Path(__file__).resolve().parent
    path = root / "data" / "solicitante_fotos"
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_solicitante_foto_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(CREATE_TAB_SOLICITANTE_FOTO_SQL)
        solicitante_fotos_dir()
        logger.info("Schema tab_solicitante_foto verificado")
    except Exception as exc:
        logger.error("Falha ao garantir schema tab_solicitante_foto: %s", exc)
        raise
