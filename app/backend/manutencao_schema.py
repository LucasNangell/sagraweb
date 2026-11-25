"""
Garante tabelas MySQL-only do módulo Manutenção (máquinas da Gráfica).
Não altera nem sincroniza MDB. Espelho manual: deploy/sql/create_manutencao.sql.
"""
from __future__ import annotations

import logging

from database import db

logger = logging.getLogger(__name__)

_schema_ready = False

# Máquinas iniciais da Gráfica (nome, setor). Seed só quando a tabela está vazia.
SEED_MAQUINAS: tuple[tuple[str, str], ...] = (
    ("CTP Impose", "Pré-impressão"),
    ("Guilhotina A", "Acabamento"),
    ("Guilhotina B", "Acabamento"),
    ("Komori", "Impressão"),
    ("PM 52", "Impressão"),
    ("Speed Master 74", "Impressão"),
    ("Trilateral Trim-tec 45i", "Acabamento"),
    ("Capeadeira", "Encadernação"),
    ("Alceadeira AM Graphics", "Acabamento"),
    ("Dobradeira Rotary", "Acabamento"),
    ("Dobradeira StahlTI52", "Acabamento"),
    ("Dobradeira Stahlfolder", "Acabamento"),
    ("Cintadeira", "Acabamento"),
    ("Encadernadora Perfecta Bookline", "Encadernação"),
    ("Laminadora", "Acabamento"),
    ("Corte e Vinco Feva", "Acabamento"),
    ("Capeadeira Capa Dura", "Encadernação"),
    ("Encadernadora Perfuramax 50", "Encadernação"),
    ("Encadernadora Perfuramax", "Encadernação"),
    ("Grampeador Miruna", "Encadernação"),
    ("Perfurador Universal 4 furos", "Encadernação"),
)

_DDL = (
    """
    CREATE TABLE IF NOT EXISTS tab_manutencao_maquina (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(32) NOT NULL,
        nome VARCHAR(160) NOT NULL,
        setor VARCHAR(80) NULL,
        fabricante VARCHAR(120) NULL,
        modelo VARCHAR(120) NULL,
        numero_serie VARCHAR(120) NULL,
        observacoes TEXT NULL,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        ordem INT NOT NULL DEFAULT 100,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
        atualizado_por VARCHAR(32) NULL,
        UNIQUE KEY uk_manut_maquina_codigo (codigo),
        KEY idx_manut_maquina_ativo (ativo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS tab_manutencao_recorrente (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        titulo VARCHAR(200) NOT NULL,
        descricao TEXT NULL,
        maquina_id BIGINT NULL,
        periodicidade_dias INT NULL,
        prioridade_padrao VARCHAR(16) NOT NULL DEFAULT 'normal',
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        criado_por VARCHAR(32) NULL,
        atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
        atualizado_por VARCHAR(32) NULL,
        KEY idx_manut_rec_maquina (maquina_id),
        KEY idx_manut_rec_ativo (ativo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS tab_manutencao_pedido (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        maquina_id BIGINT NOT NULL,
        recorrente_id BIGINT NULL,
        titulo VARCHAR(200) NOT NULL,
        descricao TEXT NULL,
        prioridade VARCHAR(16) NOT NULL DEFAULT 'normal',
        status VARCHAR(16) NOT NULL DEFAULT 'fila',
        posicao_fila INT NOT NULL DEFAULT 0,
        maquina_parada TINYINT(1) NOT NULL DEFAULT 0,
        solicitado_por VARCHAR(32) NOT NULL,
        solicitado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        iniciado_por VARCHAR(32) NULL,
        iniciado_em DATETIME NULL,
        diagnostico TEXT NULL,
        solucao_passos TEXT NULL,
        pausa_motivo VARCHAR(500) NULL,
        concluido_por VARCHAR(32) NULL,
        concluido_em DATETIME NULL,
        conclusao TEXT NULL,
        cancelado_por VARCHAR(32) NULL,
        cancelado_em DATETIME NULL,
        motivo_cancelamento VARCHAR(500) NULL,
        atualizado_em DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_manut_pedido_status (status, posicao_fila),
        KEY idx_manut_pedido_maquina (maquina_id, status),
        KEY idx_manut_pedido_recorrente (recorrente_id, maquina_id, status),
        KEY idx_manut_pedido_concluido (concluido_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
    """
    CREATE TABLE IF NOT EXISTS tab_manutencao_evento (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        pedido_id BIGINT NOT NULL,
        tipo VARCHAR(32) NOT NULL,
        ponto VARCHAR(32) NULL,
        texto TEXT NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_manut_evento_pedido (pedido_id, criado_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
)


def format_codigo_maquina(seq: int) -> str:
    """Código estável da máquina (base para QR Code): MAQ-0001."""
    return f"MAQ-{int(seq):04d}"


def _seed_maquinas(cursor) -> None:
    cursor.execute("SELECT COUNT(*) AS cnt FROM tab_manutencao_maquina")
    row = cursor.fetchone() or {}
    if int(row.get("cnt") or 0) > 0:
        return
    for idx, (nome, setor) in enumerate(SEED_MAQUINAS, start=1):
        cursor.execute(
            """
            INSERT INTO tab_manutencao_maquina (codigo, nome, setor, ordem, atualizado_por)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (format_codigo_maquina(idx), nome, setor, idx * 10, "seed"),
        )
    logger.info("Manutenção: %s máquinas iniciais cadastradas", len(SEED_MAQUINAS))


def ensure_manutencao_schema(force: bool = False) -> None:
    global _schema_ready
    if _schema_ready and not force:
        return
    with db.cursor() as cursor:
        for ddl in _DDL:
            cursor.execute(ddl)
        _seed_maquinas(cursor)
    _schema_ready = True
