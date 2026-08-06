"""Print row counts for analise-related tables."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "app" / "backend"))

from database import db  # noqa: E402

TABLES = [
    "tabProblemasPadrao",
    "tabAnalises",
    "tabAnaliseItens",
    "tabClientTokens",
]


def main() -> int:
    print("VERSION:", db.execute_query("SELECT VERSION() AS v")[0]["v"])
    datadir = db.execute_query("SHOW VARIABLES LIKE 'datadir'")[0]["Value"]
    print("DATADIR:", datadir)
    for table in TABLES:
        try:
            count = db.execute_query(f"SELECT COUNT(*) AS c FROM `{table}`")[0]["c"]
            status = db.execute_query(f"SHOW TABLE STATUS LIKE '{table}'")[0]
            print(
                f"{table}: rows={count} data_length={status['Data_length']} "
                f"auto_increment={status['Auto_increment']}"
            )
        except Exception as exc:
            print(f"{table}: ERROR {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
