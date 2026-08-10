"""
Schema do Análise Lab — laboratório técnico com marcas em mm.

Tabelas isoladas de tabProvaWeb / tabAnalises; não afeta o portal do cliente.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_TAB_SESSAO_SQL = """
CREATE TABLE IF NOT EXISTS tabAnaliseLabSessao (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    NroProtocolo INT NOT NULL,
    AnoProtocolo INT NOT NULL,
    VersaoLabel VARCHAR(128) NOT NULL DEFAULT '',
    Modo VARCHAR(16) NOT NULL DEFAULT 'unico',
    ArquivoUnico VARCHAR(512) NULL,
    ArquivoCapa VARCHAR(512) NULL,
    ArquivoMiolo VARCHAR(512) NULL,
    CropJson JSON NULL,
    PastaRender VARCHAR(64) NOT NULL DEFAULT 'AnaliseLab',
    RenderStatus VARCHAR(16) NOT NULL DEFAULT 'pending',
    RenderError VARCHAR(512) NULL,
    RenderProgress JSON NULL,
    RenderStartedAt DATETIME NULL,
    RenderFinishedAt DATETIME NULL,
    CropVersao INT NOT NULL DEFAULT 1,
    PontoRegistro INT NULL,
    DataRegistro DATETIME DEFAULT CURRENT_TIMESTAMP,
    DataAtualizacao DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_analise_lab_os (NroProtocolo, AnoProtocolo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CREATE_TAB_MARCA_SQL = """
CREATE TABLE IF NOT EXISTS tabAnaliseLabMarca (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    SessaoID INT NOT NULL,
    Pagina INT NOT NULL DEFAULT 0,
    Tipo VARCHAR(32) NOT NULL,
    GeometriaJson JSON NOT NULL,
    Rotulo VARCHAR(120) NULL,
    Cor VARCHAR(32) NOT NULL DEFAULT 'red',
    Espelhar TINYINT(1) NOT NULL DEFAULT 0,
    PaginaOrigem INT NOT NULL DEFAULT 0,
    CropVersao INT NOT NULL DEFAULT 1,
    PontoRegistro INT NULL,
    DataRegistro DATETIME DEFAULT CURRENT_TIMESTAMP,
    DataAtualizacao DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_analise_lab_marca_sessao_pagina (SessaoID, Pagina),
    CONSTRAINT fk_analise_lab_marca_sessao
        FOREIGN KEY (SessaoID) REFERENCES tabAnaliseLabSessao(ID)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def _column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(
        """
        SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (table, column),
    )
    row = cursor.fetchone()
    return bool(row and int(row.get("c") or 0) > 0)


def _ensure_column(cursor, table: str, column: str, ddl: str) -> None:
    if _column_exists(cursor, table, column):
        return
    cursor.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")
    logger.info("Análise Lab: coluna %s.%s adicionada.", table, column)


def ensure_analise_lab_schema() -> None:
    """Cria/atualiza tabelas do Análise Lab (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB_SESSAO_SQL)
            cursor.execute(_CREATE_TAB_MARCA_SQL)
            _ensure_column(
                cursor,
                "tabAnaliseLabSessao",
                "CropVersao",
                "CropVersao INT NOT NULL DEFAULT 1",
            )
            _ensure_column(
                cursor,
                "tabAnaliseLabMarca",
                "Espelhar",
                "Espelhar TINYINT(1) NOT NULL DEFAULT 0",
            )
            _ensure_column(
                cursor,
                "tabAnaliseLabMarca",
                "PaginaOrigem",
                "PaginaOrigem INT NOT NULL DEFAULT 0",
            )
            _ensure_column(
                cursor,
                "tabAnaliseLabMarca",
                "CropVersao",
                "CropVersao INT NOT NULL DEFAULT 1",
            )
        logger.info("Schema Análise Lab garantido (tabAnaliseLabSessao/Marca).")
    except Exception as exc:
        logger.error("Erro ao garantir schema Análise Lab: %s", exc)
        raise
