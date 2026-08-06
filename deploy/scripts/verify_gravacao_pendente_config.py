"""Verifica tab_gravacao_pendente_config no banco configurado em config/.env."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
for path in (BACKEND, BACKEND / "services"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from database import db


def main() -> None:
    rows = db.execute_query("SHOW TABLES LIKE 'tab_gravacao_pendente_config'")
    print(f"tab_gravacao_pendente_config: {'OK' if rows else 'FALTA'}")
    if rows:
        data = db.execute_query(
            "SELECT Id, CotaInicialChapas, AtualizadoEm, AtualizadoPorPonto "
            "FROM tab_gravacao_pendente_config WHERE Id = 1"
        )
        print("seed row:", data[0] if data else "AUSENTE")


if __name__ == "__main__":
    main()
