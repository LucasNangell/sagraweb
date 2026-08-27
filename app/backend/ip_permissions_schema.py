"""
Garante que ip_permissions tenha todas as colunas usadas por ip_admin_routes.
CREATE TABLE IF NOT EXISTS não altera tabelas já existentes (ex.: restore do schema antigo).
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

# Colunas que podem faltar em dumps/restores antigos (schema_sagrafulldb.sql)
_EXTRA_COLUMNS: tuple[tuple[str, str], ...] = (
    ("ctx_mover_pastas", "TINYINT(1) NOT NULL DEFAULT 1"),
    ("sb_admin_ips", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_pcp", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_usuarios", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_active_computers", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_gravacao", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_cotas_graf", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_gravacao_externa", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_gravacao_pendente", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_gravacao_externa_operador", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_gravacao_pendente_excluir", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_gravacao_externa_entrega", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_gravacao_externa_lancar", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_estoque", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_estoque_gerente", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_lombada", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("sb_credenciais_depol", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("ctx_prova_web", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("ctx_orcamento", "TINYINT(1) NOT NULL DEFAULT 0"),
)

_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ip_permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip VARCHAR(45) NOT NULL UNIQUE,
    descricao VARCHAR(255),
    grupo VARCHAR(100) DEFAULT 'Sem Grupo',
    ativo TINYINT(1) DEFAULT 1,
    ctx_nova_os TINYINT(1) DEFAULT 1,
    ctx_duplicar_os TINYINT(1) DEFAULT 1,
    ctx_editar_os TINYINT(1) DEFAULT 1,
    ctx_vincular_os TINYINT(1) DEFAULT 1,
    ctx_abrir_pasta TINYINT(1) DEFAULT 1,
    ctx_mover_pastas TINYINT(1) DEFAULT 1,
    ctx_imprimir_ficha TINYINT(1) DEFAULT 1,
    ctx_detalhes_os TINYINT(1) DEFAULT 1,
    sb_inicio TINYINT(1) DEFAULT 1,
    sb_gerencia TINYINT(1) DEFAULT 1,
    sb_email TINYINT(1) DEFAULT 1,
    sb_analise TINYINT(1) DEFAULT 1,
    sb_papelaria TINYINT(1) DEFAULT 1,
    sb_usuario TINYINT(1) DEFAULT 1,
    sb_configuracoes TINYINT(1) DEFAULT 1,
    sb_relatorio TINYINT(1) DEFAULT 1,
    sb_dashboard_setor TINYINT(1) DEFAULT 1,
    sb_admin_ips TINYINT(1) DEFAULT 0,
    sb_pcp TINYINT(1) DEFAULT 0,
    sb_usuarios TINYINT(1) DEFAULT 0,
    sb_active_computers TINYINT(1) DEFAULT 0,
    sb_gravacao TINYINT(1) DEFAULT 0,
    sb_cotas_graf TINYINT(1) DEFAULT 0,
    sb_gravacao_externa TINYINT(1) DEFAULT 0,
    sb_gravacao_pendente TINYINT(1) DEFAULT 0,
    sb_gravacao_externa_operador TINYINT(1) DEFAULT 0,
    sb_gravacao_pendente_excluir TINYINT(1) DEFAULT 0,
    sb_gravacao_externa_entrega TINYINT(1) DEFAULT 0,
    sb_gravacao_externa_lancar TINYINT(1) DEFAULT 0,
    sb_estoque TINYINT(1) DEFAULT 0,
    sb_estoque_gerente TINYINT(1) DEFAULT 0,
    sb_lombada TINYINT(1) DEFAULT 0,
    sb_credenciais_depol TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def ensure_ip_permissions_schema() -> None:
    """Cria a tabela se não existir e adiciona colunas RBAC ausentes."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(_CREATE_TABLE_SQL)

            cursor.execute(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'ip_permissions'
                """
            )
            existing = {row["COLUMN_NAME"] for row in cursor.fetchall()}

            for col_name, col_ddl in _EXTRA_COLUMNS:
                if col_name in existing:
                    continue
                cursor.execute(
                    f"ALTER TABLE ip_permissions ADD COLUMN {col_name} {col_ddl}"
                )
                logger.info("ip_permissions: coluna adicionada — %s", col_name)
    except Exception as exc:
        logger.error("Erro ao migrar schema ip_permissions: %s", exc)
        raise
