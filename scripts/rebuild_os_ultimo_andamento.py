#!/usr/bin/env python3
"""Rebuild idempotente de tab_os_ultimo_andamento_operacional + validação opcional."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from services.os_ultimo_andamento_service import (  # noqa: E402
    audit_materialized_table,
    backfill_os_ultimo_andamento_operacional,
    count_materialized_rows,
    sample_divergences_vs_live,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reconstrói tab_os_ultimo_andamento_operacional a partir de tabAndamento."
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Somente audita a tabela (sem TRUNCATE/backfill).",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=50,
        help="Tamanho da amostra para comparar materializada vs live.",
    )
    parser.add_argument(
        "--ano",
        type=int,
        default=None,
        help="Restringe amostra de divergências a um ano.",
    )
    args = parser.parse_args()

    if args.validate_only:
        report = {
            "audit": audit_materialized_table(),
            "divergences": sample_divergences_vs_live(
                sample_size=args.sample_size,
                ano=args.ano,
            ),
        }
        print(json.dumps(report, indent=2, default=str))
        return 0 if report["divergences"]["divergence_count"] == 0 else 2

    result = backfill_os_ultimo_andamento_operacional()
    result["final_count"] = count_materialized_rows()
    result["audit"] = audit_materialized_table()
    result["divergences"] = sample_divergences_vs_live(
        sample_size=args.sample_size,
        ano=args.ano,
    )
    print(json.dumps(result, indent=2, default=str))
    return 0 if result["divergences"]["divergence_count"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
