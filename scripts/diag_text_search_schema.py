#!/usr/bin/env python3
"""Diagnóstico engine/collation/FULLTEXT para filtros textuais."""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402


def main() -> int:
    out = {}
    for table in ("tabDetalhesServico", "tabProtocolos"):
        status = db.execute_query(f"SHOW TABLE STATUS LIKE '{table}'")
        out[table] = status[0] if status else None
        out[f"{table}_fulltext"] = db.execute_query(
            f"SHOW INDEX FROM {table} WHERE Index_type = 'FULLTEXT'"
        )
    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
