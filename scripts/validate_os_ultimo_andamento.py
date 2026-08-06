#!/usr/bin/env python3
"""Validação somente leitura da tabela materializada de andamento operacional."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from services.os_ultimo_andamento_service import (  # noqa: E402
    audit_materialized_table,
    sample_divergences_vs_live,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audita tab_os_ultimo_andamento_operacional.")
    parser.add_argument("--sample-size", type=int, default=100)
    parser.add_argument("--ano", type=int, default=None)
    args = parser.parse_args()

    report = {
        "audit": audit_materialized_table(),
        "divergences": sample_divergences_vs_live(
            sample_size=args.sample_size,
            ano=args.ano,
        ),
    }
    print(json.dumps(report, indent=2, default=str))
    ok = report["audit"].get("populated") and report["divergences"]["divergence_count"] == 0
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
