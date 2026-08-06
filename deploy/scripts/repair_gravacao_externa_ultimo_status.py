"""Corrige OSs enviadas à Gravação Externa com andamento ausente ou UltimoStatus incorreto."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
for path in (BACKEND, BACKEND / "services"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from database import db
from gravacao_pendente_service import (
    repair_gravacao_externa_ultimo_status,
    repair_orphan_gravacao_externa_sessions,
)


def main() -> None:
    orphans = repair_orphan_gravacao_externa_sessions()
    if orphans:
        print(f"Recriados {len(orphans)} andamento(s) órfão(s):")
        for item in orphans:
            print(
                f"  OS {item['os_id']:05d}/{item['ano']}: "
                f"{item['cod_status']} (UltimoStatus={item['ultimo_status']})"
            )
    else:
        print("Nenhuma sessão externa órfã.")

    rows = db.execute_query(
        """
        SELECT ge.OsNro AS os_id, ge.OsAno AS ano, ge.CodStatus AS cod_status
        FROM tab_os_gravacao_externa ge
        INNER JOIN tabAndamento a
            ON a.CodStatus COLLATE utf8mb4_general_ci
             = ge.CodStatus COLLATE utf8mb4_general_ci
        WHERE ge.Status IN ('pendente', 'iniciada')
          AND (a.UltimoStatus IS NULL OR a.UltimoStatus = 0)
        ORDER BY ge.Id ASC
        """
    )
    if not rows:
        print("Nenhuma OS com UltimoStatus pendente de correção.")
        return

    print(f"Recalculando UltimoStatus em {len(rows)} OS(s)...")
    for row in rows:
        os_id = int(row["os_id"])
        ano = int(row["ano"])
        cod = repair_gravacao_externa_ultimo_status(ano, os_id)
        print(f"  OS {os_id:05d}/{ano}: UltimoStatus -> {cod}")


if __name__ == "__main__":
    main()
