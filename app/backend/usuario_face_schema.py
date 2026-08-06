"""Schema MySQL para fotos faciais de usuários (painel tablet)."""
from __future__ import annotations

import logging
from pathlib import Path

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TAB_USUARIO_FACE = """
CREATE TABLE IF NOT EXISTS tabUsuarioFace (
    Ponto INT NOT NULL PRIMARY KEY,
    EmbeddingJson LONGTEXT NOT NULL,
    ImagePath VARCHAR(512) NULL,
    Active TINYINT(1) NOT NULL DEFAULT 1,
    UpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def face_images_dir() -> Path:
    root = Path(__file__).resolve().parent.parent
    path = root / "data" / "face_enrollments"
    path.mkdir(parents=True, exist_ok=True)
    return path


def ensure_usuario_face_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB_USUARIO_FACE)
        face_images_dir()
        logger.info("Schema tabUsuarioFace verificado")
    except Exception as exc:
        logger.error("Falha ao garantir schema tabUsuarioFace: %s", exc)
        raise
