"""
Garante tabela MySQL-only de funções de custo (mão de obra).
Não altera nem sincroniza MDB.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_FUNCAO_SQL = """
CREATE TABLE IF NOT EXISTS tab_custo_funcao (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    codigo VARCHAR(64) NULL,
    descricao TEXT NULL,
    custo_mensal DECIMAL(14,4) NOT NULL DEFAULT 0,
    custo_hora DECIMAL(14,4) NOT NULL DEFAULT 0,
    horas_mes DECIMAL(8,2) NOT NULL DEFAULT 176,
    moeda VARCHAR(8) NOT NULL DEFAULT 'BRL',
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por VARCHAR(32) NULL,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(32) NULL,
    UNIQUE KEY uk_custo_funcao_codigo (codigo),
    KEY idx_custo_funcao_nome (nome),
    KEY idx_custo_funcao_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def ensure_custo_funcao_schema() -> None:
    """Cria tab_custo_funcao se não existir (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_FUNCAO_SQL)
        logger.info("Schema tab_custo_funcao garantido")
    except Exception as exc:
        logger.error("Erro ao migrar schema tab_custo_funcao: %s", exc)
        raise
