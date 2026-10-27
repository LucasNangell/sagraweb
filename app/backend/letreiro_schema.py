"""Schema: instâncias e config remota do letreiro WPF."""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

CREATE_TAB_LETREIRO_INSTANCIA = """
CREATE TABLE IF NOT EXISTS tabLetreiroInstancia (
    HostName VARCHAR(128) NOT NULL,
    WindowsUser VARCHAR(128) NOT NULL,
    Nome VARCHAR(128) NOT NULL DEFAULT '',
    Setor VARCHAR(128) NOT NULL DEFAULT '',
    Version VARCHAR(32) NOT NULL DEFAULT '',
    Ponto VARCHAR(32) NOT NULL DEFAULT '',
    LastSeen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (HostName, WindowsUser),
    KEY idx_letreiro_instancia_seen (LastSeen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

_TAB_LETREIRO_INSTANCIA_COLUMNS = (
    ("Nome", "VARCHAR(128) NOT NULL DEFAULT '' AFTER WindowsUser"),
    ("Setor", "VARCHAR(128) NOT NULL DEFAULT '' AFTER Nome"),
)

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

CREATE_TAB_LETREIRO_COMANDO = """
CREATE TABLE IF NOT EXISTS tabLetreiroComando (
    Id INT NOT NULL AUTO_INCREMENT,
    Nome VARCHAR(128) NOT NULL,
    Tipo VARCHAR(8) NOT NULL,
    Conteudo MEDIUMTEXT NOT NULL,
    TimeoutSec INT NOT NULL DEFAULT 60,
    CreatedBy VARCHAR(128) NOT NULL DEFAULT '',
    UpdatedBy VARCHAR(128) NOT NULL DEFAULT '',
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (Id),
    UNIQUE KEY uk_letreiro_comando_nome (Nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

CREATE_TAB_LETREIRO_COMANDO_JOB = """
CREATE TABLE IF NOT EXISTS tabLetreiroComandoJob (
    Id INT NOT NULL AUTO_INCREMENT,
    ComandoId INT NULL,
    Nome VARCHAR(128) NOT NULL DEFAULT '',
    Tipo VARCHAR(8) NOT NULL,
    Conteudo MEDIUMTEXT NOT NULL,
    TimeoutSec INT NOT NULL DEFAULT 60,
    HostName VARCHAR(128) NOT NULL,
    WindowsUser VARCHAR(128) NOT NULL,
    Status VARCHAR(16) NOT NULL DEFAULT 'pending',
    ExitCode INT NULL,
    Stdout MEDIUMTEXT NULL,
    Stderr MEDIUMTEXT NULL,
    CreatedBy VARCHAR(128) NOT NULL DEFAULT '',
    CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    StartedAt DATETIME NULL,
    FinishedAt DATETIME NULL,
    PRIMARY KEY (Id),
    KEY idx_letreiro_job_claim (HostName, WindowsUser, Status),
    KEY idx_letreiro_job_created (CreatedAt),
    CONSTRAINT fk_letreiro_job_comando
        FOREIGN KEY (ComandoId) REFERENCES tabLetreiroComando (Id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

CREATE_TAB_LETREIRO_AJUSTE = """
CREATE TABLE IF NOT EXISTS tabLetreiroAjuste (
    Id TINYINT NOT NULL,
    CommandPollIntervalSec INT NOT NULL DEFAULT 10,
    UpdatedBy VARCHAR(128) NOT NULL DEFAULT '',
    UpdatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
"""

ENSURE_TAB_LETREIRO_AJUSTE_ROW = """
INSERT INTO tabLetreiroAjuste (Id, CommandPollIntervalSec, UpdatedBy)
VALUES (1, 10, '')
ON DUPLICATE KEY UPDATE Id = Id
"""


def _ensure_instancia_profile_columns(cursor) -> None:
    cursor.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tabLetreiroInstancia'
        """
    )
    existing = {row["COLUMN_NAME"] for row in cursor.fetchall()}
    for col_name, col_ddl in _TAB_LETREIRO_INSTANCIA_COLUMNS:
        if col_name in existing:
            continue
        cursor.execute(f"ALTER TABLE tabLetreiroInstancia ADD COLUMN {col_name} {col_ddl}")
        logger.info("tabLetreiroInstancia: coluna adicionada — %s", col_name)


def ensure_letreiro_schema() -> None:
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(CREATE_TAB_LETREIRO_INSTANCIA)
            cursor.execute(CREATE_TAB_LETREIRO_CONFIG)
            cursor.execute(CREATE_TAB_LETREIRO_COMANDO)
            cursor.execute(CREATE_TAB_LETREIRO_COMANDO_JOB)
            cursor.execute(CREATE_TAB_LETREIRO_AJUSTE)
            cursor.execute(ENSURE_TAB_LETREIRO_AJUSTE_ROW)
            _ensure_instancia_profile_columns(cursor)
        logger.info("Schema letreiro verificado")
    except Exception as exc:
        logger.error("Erro ao garantir schema letreiro: %s", exc)
        raise
