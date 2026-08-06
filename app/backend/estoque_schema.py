"""
Garante tabelas MySQL-only do módulo Estoque.
Não altera nem sincroniza MDB.
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_CREATE_CATEGORIA_SQL = """
CREATE TABLE IF NOT EXISTS tab_estoque_categoria (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(120) NOT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_estoque_categoria_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_SKU_SQL = """
CREATE TABLE IF NOT EXISTS tab_estoque_sku (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(64) NOT NULL,
    nome VARCHAR(200) NOT NULL,
    descricao TEXT NULL,
    categoria_id BIGINT NULL,
    unidade VARCHAR(32) NOT NULL DEFAULT 'un',
    papel_link VARCHAR(120) NULL,
    custo_medio DECIMAL(14,4) NOT NULL DEFAULT 0,
    ultimo_custo DECIMAL(14,4) NOT NULL DEFAULT 0,
    moeda VARCHAR(8) NOT NULL DEFAULT 'BRL',
    estoque_minimo DECIMAL(14,4) NOT NULL DEFAULT 0,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    criado_por VARCHAR(32) NULL,
    atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    atualizado_por VARCHAR(32) NULL,
    UNIQUE KEY uk_estoque_sku_codigo (codigo),
    KEY idx_estoque_sku_nome (nome),
    KEY idx_estoque_sku_ativo (ativo),
    KEY idx_estoque_sku_categoria (categoria_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_SALDO_SQL = """
CREATE TABLE IF NOT EXISTS tab_estoque_saldo (
    sku_id BIGINT NOT NULL PRIMARY KEY,
    quantidade DECIMAL(14,4) NOT NULL DEFAULT 0,
    reservado DECIMAL(14,4) NOT NULL DEFAULT 0,
    atualizado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_PEDIDO_SQL = """
CREATE TABLE IF NOT EXISTS tab_estoque_pedido (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'pendente',
    solicitante_ponto VARCHAR(32) NOT NULL,
    observacao TEXT NULL,
    os_nro INT NULL,
    os_ano INT NULL,
    atendido_por VARCHAR(32) NULL,
    atendido_em DATETIME NULL,
    motivo_recusa TEXT NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_estoque_pedido_status (status),
    KEY idx_estoque_pedido_solicitante (solicitante_ponto),
    KEY idx_estoque_pedido_criado (criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_PEDIDO_ITEM_SQL = """
CREATE TABLE IF NOT EXISTS tab_estoque_pedido_item (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    pedido_id BIGINT NOT NULL,
    sku_id BIGINT NOT NULL,
    qtd_solicitada DECIMAL(14,4) NOT NULL,
    qtd_atendida DECIMAL(14,4) NOT NULL DEFAULT 0,
    custo_unitario_snapshot DECIMAL(14,4) NULL,
    KEY idx_estoque_pedido_item_pedido (pedido_id),
    KEY idx_estoque_pedido_item_sku (sku_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_CREATE_MOVIMENTO_SQL = """
CREATE TABLE IF NOT EXISTS tab_estoque_movimento (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sku_id BIGINT NOT NULL,
    tipo VARCHAR(32) NOT NULL,
    quantidade DECIMAL(14,4) NOT NULL,
    custo_unitario DECIMAL(14,4) NOT NULL DEFAULT 0,
    custo_total DECIMAL(14,4) NOT NULL DEFAULT 0,
    saldo_apos DECIMAL(14,4) NOT NULL DEFAULT 0,
    motivo TEXT NULL,
    pedido_id BIGINT NULL,
    referencia_os_nro INT NULL,
    referencia_os_ano INT NULL,
    ponto VARCHAR(32) NULL,
    criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_estoque_mov_sku (sku_id),
    KEY idx_estoque_mov_tipo (tipo),
    KEY idx_estoque_mov_criado (criado_em),
    KEY idx_estoque_mov_pedido (pedido_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

_SEED_CATEGORIAS = (
    "Papel",
    "Película",
    "Tinta",
    "Chapa",
    "Insumo geral",
)


def ensure_estoque_schema() -> None:
    """Cria tabelas do Estoque se não existirem (idempotente)."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_CATEGORIA_SQL)
            cursor.execute(_CREATE_SKU_SQL)
            cursor.execute(_CREATE_SALDO_SQL)
            cursor.execute(_CREATE_PEDIDO_SQL)
            cursor.execute(_CREATE_PEDIDO_ITEM_SQL)
            cursor.execute(_CREATE_MOVIMENTO_SQL)
            for nome in _SEED_CATEGORIAS:
                cursor.execute(
                    """
                    INSERT IGNORE INTO tab_estoque_categoria (nome, ativo)
                    VALUES (%s, 1)
                    """,
                    (nome,),
                )
            try:
                from estoque_seed_materiais import seed_estoque_materiais_from_relatorio

                n = seed_estoque_materiais_from_relatorio(cursor)
                if n:
                    logger.info("Estoque: %s materiais do relatório inseridos (seed)", n)
            except Exception as seed_exc:
                logger.error("Estoque: falha no seed de materiais: %s", seed_exc)
        logger.info("Schema Estoque garantido")
    except Exception as exc:
        logger.error("Erro ao migrar schema Estoque: %s", exc)
        raise
