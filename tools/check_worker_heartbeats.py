"""Consulta tabPapelariaWorkerHeartbeat no MySQL (DEV)."""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(ROOT))

from database import db  # noqa: E402

STALE_SEC = 75


def main() -> int:
    tables = db.execute_query(
        "SHOW TABLES LIKE 'tabPapelariaWorkerHeartbeat'"
    )
    if not tables:
        print("Tabela tabPapelariaWorkerHeartbeat NAO existe no banco.")
        return 1

    rows = db.execute_query(
        """
        SELECT WorkerID, HeartbeatEm, MetaJson
        FROM tabPapelariaWorkerHeartbeat
        ORDER BY HeartbeatEm DESC
        """
    )
    rows = rows or []
    now = datetime.now()
    print(f"Total registros: {len(rows)}")
    print(f"Online (heartbeat <= {STALE_SEC}s):", end=" ")
    online_count = 0
    for r in rows:
        hb = r.get("HeartbeatEm")
        if isinstance(hb, datetime):
            age = int((now - hb).total_seconds())
            online = age <= STALE_SEC
        else:
            age = "?"
            online = False
        if online:
            online_count += 1
        status = "ONLINE" if online else "offline"
        print(f"\n  [{status}] {r.get('WorkerID')} | {hb} | ha {age}s")
    print(f"\nResumo: {online_count} online de {len(rows)} registrados")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
