#!/usr/bin/env python3
"""
Carga inicial de consumo de cotas por cliente (tabProtocolos -> tabCotaMovimento).

Uso (a partir da raiz do projeto):
  python deploy/scripts/backfill_cliente_cotas.py
  python deploy/scripts/backfill_cliente_cotas.py --force
  python deploy/scripts/backfill_cliente_cotas.py --data-inicio 2026-01-01
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from cliente_cota_schema import ensure_cliente_cota_schema
from services.cliente_cota_service import (
    BACKFILL_DATA_INICIO,
    backfill_consumo_cotas,
    ensure_semestre_aberto,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill de cotas por cliente")
    parser.add_argument(
        "--data-inicio",
        default=BACKFILL_DATA_INICIO.isoformat(),
        help="Data inicial de DataEntrada (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--data-fim",
        default=date.today().isoformat(),
        help="Data final de DataEntrada (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reprocessa mesmo se o backfill já existir no semestre",
    )
    args = parser.parse_args()

    data_inicio = date.fromisoformat(args.data_inicio)
    data_fim = date.fromisoformat(args.data_fim)

    ensure_cliente_cota_schema()
    semestre_id = ensure_semestre_aberto()
    result = backfill_consumo_cotas(
        semestre_id=semestre_id,
        data_inicio=data_inicio,
        data_fim=data_fim,
        force=args.force,
    )

    if result.skipped_existing:
        print(
            f"Semestre {result.semestre_id}: backfill já existente "
            f"({result.clientes_atualizados} clientes). Use --force para reprocessar."
        )
    else:
        print(
            f"Semestre {result.semestre_id}: "
            f"{result.protocolos_lidos} protocolos lidos, "
            f"{result.movimentos_inseridos} movimentos, "
            f"{result.clientes_atualizados} clientes agregados."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
