"""Cancela sessões Gravação Externa órfãs (último andamento não é Gravação Externa)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
for path in (BACKEND, BACKEND / "services"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from gravacao_externa_service import cleanup_stale_externa_sessions


def main() -> None:
    cleaned = cleanup_stale_externa_sessions()
    if not cleaned:
        print("Nenhuma sessão externa obsoleta.")
        return
    print(f"Canceladas {len(cleaned)} sessão(ões):")
    for item in cleaned:
        print(
            f"  OS {item['os_id']:05d}/{item['ano']} "
            f"(sessão {item['gravacao_externa_id']}, cod {item['cod_status']})"
        )


if __name__ == "__main__":
    main()
