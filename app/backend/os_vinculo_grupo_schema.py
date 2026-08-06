"""
Schema MySQL para comportamento de grupos de OSs vinculadas (andamento/setor sincronizado).
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_GRUPOS_SQL = """
CREATE TABLE IF NOT EXISTS tabOSVinculoGrupos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    situacao VARCHAR(120) NOT NULL,
    setor VARCHAR(80) NOT NULL,
    criado_por_ponto VARCHAR(32) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def ensure_os_vinculo_grupo_schema() -> None:
    """Cria tabela de grupos e coluna grupo_id em tabOSVinculadas (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_GRUPOS_SQL)
            try:
                cursor.execute(
                    """
                    ALTER TABLE tabOSVinculadas
                    ADD COLUMN grupo_id INT NULL,
                    ADD INDEX idx_os_vinculadas_grupo (grupo_id)
                    """
                )
                logger.info("Coluna grupo_id adicionada em tabOSVinculadas")
            except Exception as exc:
                if "Duplicate column" not in str(exc):
                    logger.debug("Migração grupo_id em tabOSVinculadas: %s", exc)
        logger.info("Schema grupo de vínculo OS verificado/criado com sucesso")
    except Exception as exc:
        logger.error("Erro ao garantir schema grupo de vínculo OS: %s", exc)
        raise
