"""
Schema do portal do cliente (gabinete) — contas com login/senha vinculadas a GabSalaUsuario.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_CLIENTE_GABINETE_SQL = """
CREATE TABLE IF NOT EXISTS tabClienteGabinete (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Gabinete VARCHAR(255) NOT NULL,
    Email VARCHAR(255) NOT NULL,
    PasswordHash VARCHAR(255) NULL,
    Nome VARCHAR(255) NOT NULL,
    ParentID INT NULL,
    AuthAtivo TINYINT(1) NOT NULL DEFAULT 1,
    EmailVerified TINYINT(1) NOT NULL DEFAULT 0,
    ActivationToken VARCHAR(64) NULL,
    ActivationExpires DATETIME NULL,
    PasswordResetToken VARCHAR(64) NULL,
    PasswordResetExpires DATETIME NULL,
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cliente_email (Email),
    KEY idx_cliente_gabinete (Gabinete),
    CONSTRAINT fk_cliente_parent FOREIGN KEY (ParentID)
        REFERENCES tabClienteGabinete (ID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_PROOF_TOKENS_SQL = """
CREATE TABLE IF NOT EXISTS tabProofTokens (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    NroProtocolo INT NOT NULL,
    AnoProtocolo INT NOT NULL,
    Versao VARCHAR(32) NULL,
    Token VARCHAR(128) NOT NULL,
    DataExpiracao DATETIME NULL,
    Aprovado TINYINT(1) NULL,
    Observacao TEXT NULL,
    DataResposta DATETIME NULL,
    ClienteNome VARCHAR(255) NULL,
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_proof_token (Token),
    KEY idx_proof_os (NroProtocolo, AnoProtocolo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_cliente_gabinete_schema() -> None:
    """Garante tabelas do portal do cliente e tokens de aprovação de prova."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_CLIENTE_GABINETE_SQL)
            cursor.execute(_CREATE_PROOF_TOKENS_SQL)
            cursor.execute(
                """
                SELECT COUNT(*) AS c FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'tabClienteGabinete'
                  AND COLUMN_NAME = 'TipoConta'
                """
            )
            row = cursor.fetchone()
            if not row or int(row.get("c") or 0) == 0:
                cursor.execute(
                    """
                    ALTER TABLE tabClienteGabinete
                    ADD COLUMN TipoConta VARCHAR(16) NOT NULL DEFAULT 'gabinete'
                    AFTER Gabinete
                    """
                )
            _ensure_cliente_nav_columns(cursor)
            _ensure_proof_tokens_columns(cursor)
    except Exception as exc:
        logger.error("Erro ao migrar schema cliente_gabinete: %s", exc)
        raise


def _ensure_column(cursor, table: str, col_name: str, col_def: str) -> None:
    cursor.execute(
        """
        SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table, col_name),
    )
    row = cursor.fetchone()
    if not row or int(row.get("c") or 0) == 0:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}")
        logger.info("Coluna %s.%s adicionada.", table, col_name)


def _ensure_cliente_nav_columns(cursor) -> None:
    """Flags de menu do portal externo (idempotente)."""
    _ensure_column(
        cursor,
        "tabClienteGabinete",
        "NavCredencialDepol",
        "TINYINT(1) NOT NULL DEFAULT 0 AFTER AuthAtivo",
    )


def _ensure_proof_tokens_columns(cursor) -> None:
    """Adiciona colunas de vínculo arquivo/envio em tabProofTokens (idempotente)."""
    columns = (
        ("ArquivoProva", "VARCHAR(512) NULL AFTER Versao"),
        ("PontoEnvio", "VARCHAR(32) NULL AFTER ClienteNome"),
        ("DataEnvio", "DATETIME NULL AFTER CreatedAt"),
        ("AlteracoesJson", "JSON NULL AFTER Observacao"),
        ("JobIdPapelaria", "INT NULL AFTER AlteracoesJson"),
        # NULL = prova PDF tradicional; 'prova_web' = flipbook da pasta da OS.
        ("TipoProva", "VARCHAR(16) NULL AFTER ArquivoProva"),
    )
    for col_name, col_def in columns:
        _ensure_column(cursor, "tabProofTokens", col_name, col_def)
