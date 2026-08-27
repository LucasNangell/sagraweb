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
    quantidade INT NOT NULL DEFAULT 1,
    alocacao VARCHAR(16) NOT NULL DEFAULT 'etapa',
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

HORAS_MES_SEED = 176.0

# Postos da folha (custo mensal por empregado). custo_hora = mensal / 176.
_SEED_FUNCOES: tuple[tuple[str, str, int, float, str, str], ...] = (
    ("IMP_OFF", "Impressor de Offset", 6, 19140.13, "etapa", "Com adicional de insalubridade"),
    ("PRE", "Operador de pré-impressão", 8, 18211.27, "etapa", ""),
    ("DIG", "Operador de impressão eletrônica", 9, 18244.92, "etapa", ""),
    ("ACAB", "Operador de acabamento", 12, 15166.24, "etapa", "Com adicional de insalubridade"),
    ("GRAV", "Gravador de chapas", 3, 12232.58, "etapa", "Com adicional de insalubridade"),
    ("AUX_OFF", "Auxiliar de impressão Offset", 6, 12233.97, "etapa", "Com adicional de insalubridade"),
    ("AUX", "Auxiliar de produção gráfica", 9, 8252.94, "etapa", ""),
    ("AUX_INS", "Auxiliar de produção gráfica (insalubridade)", 19, 9144.64, "etapa", "Com adicional de insalubridade"),
    ("GER", "Gerente gráfico", 2, 25386.44, "overhead", "Com adicional de insalubridade"),
    ("MEC", "Mecânico em equipamento gráfico", 2, 28102.60, "overhead", "Com adicional de insalubridade"),
)


def _ensure_column(cursor, name: str, ddl: str) -> None:
    cursor.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'tab_custo_funcao'
          AND COLUMN_NAME = %s
        """,
        (name,),
    )
    if not cursor.fetchone():
        cursor.execute(f"ALTER TABLE tab_custo_funcao ADD COLUMN {ddl}")
        logger.info("tab_custo_funcao: coluna %s adicionada", name)


def ensure_custo_funcao_schema() -> None:
    """Cria tab_custo_funcao se não existir e faz seed idempotente por código."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_FUNCAO_SQL)
            _ensure_column(
                cursor,
                "quantidade",
                "quantidade INT NOT NULL DEFAULT 1",
            )
            _ensure_column(
                cursor,
                "alocacao",
                "alocacao VARCHAR(16) NOT NULL DEFAULT 'etapa'",
            )
            for codigo, nome, qtd, mensal, alocacao, desc in _SEED_FUNCOES:
                custo_hora = round(mensal / HORAS_MES_SEED + 1e-12, 4)
                cursor.execute(
                    """
                    INSERT INTO tab_custo_funcao (
                        nome, codigo, descricao, custo_mensal, custo_hora, horas_mes,
                        quantidade, alocacao, moeda, ativo
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'BRL', 1)
                    ON DUPLICATE KEY UPDATE codigo = codigo
                    """,
                    (
                        nome,
                        codigo,
                        desc or None,
                        mensal,
                        custo_hora,
                        HORAS_MES_SEED,
                        qtd,
                        alocacao,
                    ),
                )
        logger.info("Schema tab_custo_funcao garantido")
    except Exception as exc:
        logger.error("Erro ao migrar schema tab_custo_funcao: %s", exc)
        raise
