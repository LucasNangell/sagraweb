#!/usr/bin/env python3
"""Reconciliação das fontes MySQL da lista home (materializada + auxiliares)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from services.andamento_table import ensure_andamento_table  # noqa: E402
from services.os_materialized_reconcile_service import (  # noqa: E402
    diagnostics,
    find_materialized_gaps,
    reconcile_gaps,
    reconcile_os,
    run_reconcile_cycle,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Diagnóstico/correção tabAndamento ↔ tab_os_ultimo_andamento_operacional."
    )
    parser.add_argument("--setor", default=None, help="Restringe a um setor (ex.: SEFOC)")
    parser.add_argument("--os", "--nro", dest="nro", type=int, default=None)
    parser.add_argument("--ano", type=int, default=None)
    parser.add_argument(
        "--recent-minutes",
        "--lookback-minutes",
        dest="lookback_minutes",
        type=int,
        default=None,
        help="Janela recente em minutos (default: env ou 30)",
    )
    parser.add_argument("--max-rows", type=int, default=None)
    parser.add_argument(
        "--full",
        action="store_true",
        help="Scan amplo (usa --max-rows como limite; default 10000 se omitido)",
    )
    parser.add_argument("--limit", type=int, default=None, help="Alias de --max-rows")
    parser.add_argument("--diagnostics", action="store_true", help="Somente diagnóstico")
    parser.add_argument("--list-gaps", action="store_true", help="Lista gaps sem corrigir")
    parser.add_argument("--fix", action="store_true", help="Corrige gaps encontrados")
    args = parser.parse_args()

    ensure_andamento_table()

    max_rows = args.max_rows or args.limit
    if args.full and max_rows is None:
        max_rows = 10000

    lookback = args.lookback_minutes
    if args.full and lookback is None:
        lookback = 60 * 24 * 365

    if args.diagnostics:
        print(json.dumps(diagnostics(setor=args.setor), indent=2, default=str))
        return 0

    if args.nro is not None and args.ano is not None:
        if args.fix:
            result = reconcile_os(args.nro, args.ano, source="cli", notify=True)
            print(json.dumps(result, indent=2, default=str))
            return 0 if result.get("reconciled") else 1
        gaps = find_materialized_gaps(nro=args.nro, ano=args.ano, max_rows=1)
        print(json.dumps(gaps, indent=2, default=str))
        return 0

    gaps = find_materialized_gaps(
        lookback_minutes=lookback,
        max_rows=max_rows or 500,
        setor=args.setor,
    )
    if args.list_gaps or not args.fix:
        print(json.dumps({"gaps": gaps, "count": len(gaps)}, indent=2, default=str))
        if not args.fix:
            return 0 if not gaps else 2

    if args.fix:
        if not gaps:
            print(json.dumps({"fixed": 0, "message": "sem gaps"}, indent=2))
            return 0
        result = reconcile_gaps(gaps, source="reconcile_cli")
        print(json.dumps(result, indent=2, default=str))
        return 0 if not result.get("errors") else 1

    result = run_reconcile_cycle(
        lookback_minutes=lookback,
        max_rows=max_rows,
        setor=args.setor,
    )
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
