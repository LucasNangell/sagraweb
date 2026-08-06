"""
Schema de controle de cotas por cliente (OS <5000 e SP >=5000), por semestre.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_SEMESTRE_SQL = """
CREATE TABLE IF NOT EXISTS tabCotaSemestre (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Ano INT NOT NULL,
    NumeroSemestre TINYINT NOT NULL,
    DataInicio DATE NOT NULL,
    DataFim DATE NOT NULL,
    LimiteOsDeputado BIGINT NOT NULL DEFAULT 120000,
    LimiteSpDeputado BIGINT NOT NULL DEFAULT 10000,
    Status ENUM('aberto', 'fechado') NOT NULL DEFAULT 'aberto',
    ResetadoEm DATETIME NULL,
    ResetadoPorPonto INT NULL,
    CriadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cota_semestre (Ano, NumeroSemestre),
    KEY idx_cota_semestre_status (Status, Ano, NumeroSemestre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_CLIENTE_SQL = """
CREATE TABLE IF NOT EXISTS tabCotaCliente (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    SemestreID INT NOT NULL,
    CodUsuarioLink VARCHAR(64) NOT NULL DEFAULT '',
    CategoriaLink VARCHAR(128) NOT NULL DEFAULT '',
    NomeUsuario VARCHAR(255) NOT NULL DEFAULT '',
    SolicitanteExibicao VARCHAR(255) NOT NULL DEFAULT '',
    GabSalaUsuario VARCHAR(64) NULL,
    LimiteOs BIGINT NULL,
    LimiteSp BIGINT NULL,
    ConsumoOs BIGINT NOT NULL DEFAULT 0,
    ConsumoSp BIGINT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cota_cliente (
        SemestreID, CodUsuarioLink, CategoriaLink, NomeUsuario(128)
    ),
    KEY idx_cota_cliente_semestre (SemestreID),
    KEY idx_cota_cliente_categoria (CategoriaLink(64)),
    CONSTRAINT fk_cota_cliente_semestre
        FOREIGN KEY (SemestreID) REFERENCES tabCotaSemestre (ID)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_MOVIMENTO_SQL = """
CREATE TABLE IF NOT EXISTS tabCotaMovimento (
    ID BIGINT AUTO_INCREMENT PRIMARY KEY,
    SemestreID INT NOT NULL,
    ClienteCotaID INT NULL,
    NroProtocolo INT NOT NULL,
    AnoProtocolo INT NOT NULL,
    Tipo ENUM('os', 'sp') NOT NULL,
    ValorCota BIGINT NOT NULL DEFAULT 0,
    DataEntrada DATE NULL,
    CodUsuarioLink VARCHAR(64) NOT NULL DEFAULT '',
    CategoriaLink VARCHAR(128) NOT NULL DEFAULT '',
    NomeUsuario VARCHAR(255) NOT NULL DEFAULT '',
    Origem VARCHAR(32) NOT NULL DEFAULT 'backfill',
    ReferenciaExterna VARCHAR(64) NOT NULL DEFAULT '',
    ProdutoExterno VARCHAR(128) NULL,
    TituloExterno VARCHAR(255) NULL,
    RegistradoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cota_mov_chave (
        SemestreID, Origem, NroProtocolo, AnoProtocolo, ReferenciaExterna
    ),
    KEY idx_cota_mov_externo (SemestreID, Origem, ReferenciaExterna),
    KEY idx_cota_mov_cliente (ClienteCotaID),
    KEY idx_cota_mov_semestre (SemestreID),
    CONSTRAINT fk_cota_mov_semestre
        FOREIGN KEY (SemestreID) REFERENCES tabCotaSemestre (ID)
        ON DELETE CASCADE,
    CONSTRAINT fk_cota_mov_cliente
        FOREIGN KEY (ClienteCotaID) REFERENCES tabCotaCliente (ID)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_IMPORT_LOTE_SQL = """
CREATE TABLE IF NOT EXISTS tabCotaImportLote (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    ArquivoNome VARCHAR(255) NOT NULL DEFAULT '',
    ArquivoHash CHAR(64) NOT NULL,
    Origem VARCHAR(32) NOT NULL,
    LinhasLidas INT NOT NULL DEFAULT 0,
    Inseridas INT NOT NULL DEFAULT 0,
    Duplicadas INT NOT NULL DEFAULT 0,
    Rejeitadas INT NOT NULL DEFAULT 0,
    ImportadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ImportadoPorPonto INT NULL,
    UNIQUE KEY uq_cota_import_hash (Origem, ArquivoHash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_cliente_cota_schema() -> None:
    """Cria tabelas de cotas por cliente/semestre (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_SEMESTRE_SQL)
            cursor.execute(_CREATE_CLIENTE_SQL)
            cursor.execute(_CREATE_MOVIMENTO_SQL)
            cursor.execute(_CREATE_IMPORT_LOTE_SQL)
            _migrate_movimento_externo_columns(cursor)
            _migrate_cliente_solicitante_column(cursor)
            _migrate_movimento_unique_key(cursor)
    except Exception as exc:
        logger.error("Erro ao migrar schema cliente_cota: %s", exc)
        raise


def _migrate_movimento_externo_columns(cursor) -> None:
    """Colunas para consumo importado (Gráfica Rápida) em bases já existentes."""
    alters = (
        "ALTER TABLE tabCotaMovimento ADD COLUMN ReferenciaExterna VARCHAR(64) NOT NULL DEFAULT ''",
        "ALTER TABLE tabCotaMovimento ADD COLUMN ProdutoExterno VARCHAR(128) NULL",
        "ALTER TABLE tabCotaMovimento ADD COLUMN TituloExterno VARCHAR(255) NULL",
    )
    for ddl in alters:
        try:
            cursor.execute(ddl)
        except Exception as exc:
            if "Duplicate column" not in str(exc):
                logger.debug("migrate tabCotaMovimento: %s", exc)
    try:
        cursor.execute(
            """
            CREATE INDEX idx_cota_mov_externo
            ON tabCotaMovimento (SemestreID, Origem, ReferenciaExterna)
            """
        )
    except Exception as exc:
        if "Duplicate key name" not in str(exc):
            logger.debug("migrate idx_cota_mov_externo: %s", exc)


def _migrate_cliente_solicitante_column(cursor) -> None:
    try:
        cursor.execute(
            "ALTER TABLE tabCotaCliente ADD COLUMN SolicitanteExibicao VARCHAR(255) NOT NULL DEFAULT ''"
        )
    except Exception as exc:
        if "Duplicate column" not in str(exc):
            logger.debug("migrate tabCotaCliente SolicitanteExibicao: %s", exc)


def _migrate_movimento_unique_key(cursor) -> None:
    """
    Separa chave de OS (backfill) da referência PA (Gráfica Rápida).
    Consumo externo usa NroProtocolo=0, AnoProtocolo=0 e ReferenciaExterna=PA-…
    """
    try:
        cursor.execute(
            """
            UPDATE tabCotaMovimento
            SET NroProtocolo = 0, AnoProtocolo = 0
            WHERE Origem = 'grafica_rapida'
              AND (NroProtocolo <> 0 OR AnoProtocolo <> 0)
            """
        )
    except Exception as exc:
        logger.debug("migrate grafica nro/ano zerados: %s", exc)
    try:
        cursor.execute("ALTER TABLE tabCotaMovimento DROP INDEX uq_cota_mov_os")
    except Exception as exc:
        if "check that it exists" not in str(exc).lower() and "1091" not in str(exc):
            logger.debug("drop uq_cota_mov_os: %s", exc)
    try:
        cursor.execute(
            """
            CREATE UNIQUE INDEX uq_cota_mov_chave
            ON tabCotaMovimento (
                SemestreID, Origem, NroProtocolo, AnoProtocolo, ReferenciaExterna
            )
            """
        )
    except Exception as exc:
        if "Duplicate key name" not in str(exc):
            logger.debug("create uq_cota_mov_chave: %s", exc)
