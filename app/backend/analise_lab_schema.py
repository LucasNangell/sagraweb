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
    PontoRegistro INT NULL,
    DataRegistro DATETIME DEFAULT CURRENT_TIMESTAMP,
    DataAtualizacao DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_analise_lab_marca_sessao_pagina (SessaoID, Pagina),
    CONSTRAINT fk_analise_lab_marca_sessao
        FOREIGN KEY (SessaoID) REFERENCES tabAnaliseLabSessao(ID)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_analise_lab_schema() -> None:
    """Cria/atualiza tabelas do Análise Lab (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TAB_SESSAO_SQL)
            cursor.execute(_CREATE_TAB_MARCA_SQL)
        logger.info("Schema Análise Lab garantido (tabAnaliseLabSessao/Marca).")
    except Exception as exc:
        logger.error("Erro ao garantir schema Análise Lab: %s", exc)
        raise
