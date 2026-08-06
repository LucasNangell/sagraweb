"""Aplica schemas Gravação Pendente + extensões v2."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
SERVICES = BACKEND / "services"
for path in (BACKEND, SERVICES):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from database import db
from gravacao_externa_schema import ensure_gravacao_externa_schema
from gravacao_pendente_schema import ensure_gravacao_pendente_schema
from ip_permissions_schema import ensure_ip_permissions_schema
from system_catalog_schema import ensure_system_catalog_schema
from user_auth_schema import ensure_user_auth_schema


def main() -> None:
    print("Aplicando schemas Gravação Pendente v2...")
    ensure_system_catalog_schema()
    ensure_ip_permissions_schema()
    ensure_user_auth_schema()
    ensure_gravacao_externa_schema()
    ensure_gravacao_pendente_schema()
    print("Schemas aplicados.")

    tables = (
        "tab_os_gravacao_pendente",
        "tab_os_gravacao_pendente_arquivo",
        "tab_os_gravacao_pendente_chapa",
        "tab_os_gravacao_externa",
        "tab_os_gravacao_externa_arquivo",
    )
    for table in tables:
        rows = db.execute_query(f"SHOW TABLES LIKE '{table}'")
        print(f"  {table}: {'OK' if rows else 'FALTA'}")

    for perm_table in ("ip_permissions", "user_permissions"):
        for col in ("sb_gravacao_externa", "sb_gravacao_pendente"):
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


if __name__ == "__main__":
    main()
