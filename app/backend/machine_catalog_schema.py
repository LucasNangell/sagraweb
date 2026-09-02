"""Schema de grupos e configurações adicionais das máquinas do sistema."""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)

_CREATE_GROUPS_SQL = """
CREATE TABLE IF NOT EXISTS tabSystemMachineGroup (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Nome VARCHAR(120) NOT NULL,
    Tipo VARCHAR(32) NOT NULL DEFAULT 'geral',
    Ativo TINYINT(1) NOT NULL DEFAULT 1,
    Ordem INT NOT NULL DEFAULT 50,
    CriadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    AtualizadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    AtualizadoPorPonto VARCHAR(32) NULL,
    UNIQUE KEY uq_system_machine_group_nome (Nome),
    KEY idx_system_machine_group_ativo (Ativo, Ordem)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_SETTINGS_SQL = """
CREATE TABLE IF NOT EXISTS tabSystemMachineConfig (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    MaquinaRotulo VARCHAR(255) NOT NULL,
    GrupoID INT NULL,
    Tecnologia VARCHAR(16) NULL,
    PapelMaxAlturaMm DECIMAL(8,2) NULL,
    PapelMaxLarguraMm DECIMAL(8,2) NULL,
    PapelPadraoAlturaMm DECIMAL(8,2) NULL,
    PapelPadraoLarguraMm DECIMAL(8,2) NULL,
    MargemSuperiorMm DECIMAL(8,2) NULL,
    MargemDireitaMm DECIMAL(8,2) NULL,
    MargemInferiorMm DECIMAL(8,2) NULL,
    MargemEsquerdaMm DECIMAL(8,2) NULL,
    CriadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    AtualizadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    AtualizadoPorPonto VARCHAR(32) NULL,
    UNIQUE KEY uq_system_machine_config_rotulo (MaquinaRotulo),
    KEY idx_system_machine_config_grupo (GrupoID),
    CONSTRAINT fk_system_machine_config_group FOREIGN KEY (GrupoID)
        REFERENCES tabSystemMachineGroup(ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_machine_catalog_schema() -> None:
    db.execute_query(_CREATE_GROUPS_SQL)
    db.execute_query(_CREATE_SETTINGS_SQL)
    logger.info("Tabelas tabSystemMachineGroup / tabSystemMachineConfig verificadas/criadas")
