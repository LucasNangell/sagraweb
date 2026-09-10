"""
Schema de autenticação por e-mail/senha (acesso via cgraf.online).
Estende tabUsuarios e cria user_permissions (RBAC por ponto).
"""
from __future__ import annotations

import logging

from database import Database

logger = logging.getLogger(__name__)

_TAB_USUARIOS_COLUMNS: tuple[tuple[str, str], ...] = (
    ("Email", "VARCHAR(255) NULL"),
    ("PasswordHash", "VARCHAR(255) NULL"),
    ("EmailVerified", "TINYINT(1) NOT NULL DEFAULT 0"),
    ("ActivationToken", "VARCHAR(64) NULL"),
    ("ActivationExpires", "DATETIME NULL"),
    ("PasswordResetToken", "VARCHAR(64) NULL"),
    ("PasswordResetExpires", "DATETIME NULL"),
    ("AuthAtivo", "TINYINT(1) NOT NULL DEFAULT 1"),
    ("Fornecedor", "TINYINT(1) NOT NULL DEFAULT 0"),
)

_CREATE_USER_PERMISSIONS_SQL = """
CREATE TABLE IF NOT EXISTS user_permissions (
    Ponto INT PRIMARY KEY,
    ctx_nova_os TINYINT(1) DEFAULT 0,
    ctx_duplicar_os TINYINT(1) DEFAULT 0,
    ctx_editar_os TINYINT(1) DEFAULT 0,
    ctx_vincular_os TINYINT(1) DEFAULT 0,
    ctx_abrir_pasta TINYINT(1) DEFAULT 0,
    ctx_mover_pastas TINYINT(1) DEFAULT 0,
    ctx_imprimir_ficha TINYINT(1) DEFAULT 0,
    ctx_detalhes_os TINYINT(1) DEFAULT 0,
    sb_inicio TINYINT(1) DEFAULT 0,
    sb_gerencia TINYINT(1) DEFAULT 0,
    sb_email TINYINT(1) DEFAULT 0,
    sb_analise TINYINT(1) DEFAULT 0,
    sb_papelaria TINYINT(1) DEFAULT 0,
    sb_usuario TINYINT(1) DEFAULT 0,
    sb_configuracoes TINYINT(1) DEFAULT 0,
    sb_relatorio TINYINT(1) DEFAULT 0,
    sb_dashboard_setor TINYINT(1) DEFAULT 0,
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
    sb_manipular_imagem TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_USER_PERMISSIONS_EXTRA_COLUMNS: tuple[tuple[str, str], ...] = (
    ("ctx_mover_pastas", "TINYINT(1) DEFAULT 0"),
    ("sb_cotas_graf", "TINYINT(1) DEFAULT 0"),
    ("sb_gravacao_externa", "TINYINT(1) DEFAULT 0"),
    ("sb_gravacao_pendente", "TINYINT(1) DEFAULT 0"),
    ("sb_gravacao_externa_operador", "TINYINT(1) DEFAULT 0"),
    ("sb_gravacao_pendente_excluir", "TINYINT(1) DEFAULT 0"),
    ("sb_gravacao_externa_entrega", "TINYINT(1) DEFAULT 0"),
    ("sb_gravacao_externa_lancar", "TINYINT(1) DEFAULT 0"),
    ("sb_estoque", "TINYINT(1) DEFAULT 0"),
    ("sb_estoque_gerente", "TINYINT(1) DEFAULT 0"),
    ("sb_lombada", "TINYINT(1) DEFAULT 0"),
    ("sb_dashboard_tablet", "TINYINT(1) DEFAULT 0"),
    ("sb_credenciais_depol", "TINYINT(1) DEFAULT 0"),
    ("sb_manipular_imagem", "TINYINT(1) DEFAULT 0"),
    ("ctx_prova_web", "TINYINT(1) DEFAULT 0"),
    ("ctx_orcamento", "TINYINT(1) DEFAULT 0"),
)


def ensure_user_auth_schema() -> None:
    """Adiciona colunas de auth em tabUsuarios e garante user_permissions."""
    db = Database()
    try:
        with db.cursor() as cursor:
            cursor.execute(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'tabUsuarios'
                """
            )
            existing = {row["COLUMN_NAME"] for row in cursor.fetchall()}

            for col_name, col_ddl in _TAB_USUARIOS_COLUMNS:
                if col_name in existing:
                    continue
                cursor.execute(
                    f"ALTER TABLE tabUsuarios ADD COLUMN {col_name} {col_ddl}"
                )
                logger.info("tabUsuarios: coluna adicionada — %s", col_name)

            if "Email" in existing or "Email" in {
                c for c, _ in _TAB_USUARIOS_COLUMNS
            }:
                cursor.execute(
                    """
                    SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'tabUsuarios'
                      AND INDEX_NAME = 'uq_tabUsuarios_email'
                    """
                )
                if not cursor.fetchone():
                    try:
                        cursor.execute(
                            """
                            CREATE UNIQUE INDEX uq_tabUsuarios_email
                            ON tabUsuarios (Email)
                            """
                        )
                    except Exception:
                        pass

            cursor.execute(_CREATE_USER_PERMISSIONS_SQL)

            cursor.execute(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'user_permissions'
                """
            )
            user_perm_cols = {row["COLUMN_NAME"] for row in cursor.fetchall()}
            for col_name, col_ddl in _USER_PERMISSIONS_EXTRA_COLUMNS:
                if col_name in user_perm_cols:
                    continue
                cursor.execute(
                    f"ALTER TABLE user_permissions ADD COLUMN {col_name} {col_ddl}"
                )
                logger.info("user_permissions: coluna adicionada — %s", col_name)
    except Exception as exc:
        logger.error("Erro ao migrar schema user_auth: %s", exc)
        raise
