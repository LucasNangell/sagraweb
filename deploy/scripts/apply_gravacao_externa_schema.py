"""Aplica no MySQL (config/.env) o schema da funcionalidade Gravação Externa."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
SERVICES = BACKEND / "services"
if str(SERVICES) not in sys.path:
    sys.path.insert(0, str(SERVICES))

from gravacao_externa_schema import ensure_gravacao_externa_schema
from database import db
from ip_permissions_schema import ensure_ip_permissions_schema
from system_catalog_schema import ensure_system_catalog_schema
from user_auth_schema import ensure_user_auth_schema


def main() -> None:
    print("Aplicando schemas Gravação Externa...")
    ensure_system_catalog_schema()
    ensure_ip_permissions_schema()
    ensure_user_auth_schema()
    ensure_gravacao_externa_schema()
    print("Schemas aplicados.")

    for perm_table in ("ip_permissions", "user_permissions"):
        db.execute_query(
            f"""
            UPDATE {perm_table}
            SET sb_gravacao_externa_operador = 1
            WHERE sb_gravacao_externa = 1
              AND (sb_gravacao_externa_operador IS NULL OR sb_gravacao_externa_operador = 0)
            """
        )
    print("Migração sb_gravacao_externa -> sb_gravacao_externa_operador aplicada.")

    tables = (
        "tab_os_gravacao_externa",
        "tab_os_gravacao_externa_arquivo",
        "tab_os_gravacao_externa_mensagem",
    )
    for table in tables:
        rows = db.execute_query(f"SHOW TABLES LIKE '{table}'")
        print(f"  {table}: {'OK' if rows else 'FALTA'}")

    for perm_table in ("ip_permissions", "user_permissions"):
        for col in ("sb_gravacao_externa", "sb_gravacao_externa_operador"):
            rows = db.execute_query(
                """
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = %s
                  AND COLUMN_NAME = %s
                """,
                (perm_table, col),
            )
            print(f"  {perm_table}.{col}: {'OK' if rows else 'FALTA'}")

    cat = db.execute_query(
        """
        SELECT Id FROM tabSystemCatalog
        WHERE Categoria = 'situacao' AND Rotulo = 'Gravação Externa'
        LIMIT 1
        """
    )
    print(f"  catalogo situacao Gravação Externa: {'OK' if cat else 'FALTA'}")


if __name__ == "__main__":
    main()
