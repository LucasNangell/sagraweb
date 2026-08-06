#!/usr/bin/env python3
"""
Remove OSs anteriores a 2024 do MySQL (tabAndamento, tabDetalhesServico, tabProtocolos
e tabelas auxiliares SAGRA Web).

NÃO altera MDB/Access.

Uso:
  python scripts/purge_os_pre_2024.py              # dry-run (contagens)
  python scripts/purge_os_pre_2024.py --execute --yes
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path
from typing import Callable, List, Tuple

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402

YEAR_CUTOFF = 2024
BATCH_SIZE = 50_000


def _count(sql: str) -> int:
    rows = db.execute_query(sql)
    return int(rows[0]["c"]) if rows else 0


def _batch_delete(label: str, sql: str, *, batch_size: int = BATCH_SIZE) -> int:
    """DELETE em lotes; retorna total removido."""
    total = 0
    batch = 0
    while True:
        with db.cursor() as cursor:
            cursor.execute(sql, (batch_size,))
            removed = cursor.rowcount
        if removed <= 0:
            break
        total += removed
        batch += 1
        print(f"    {label}: lote {batch}, -{removed:,} (acum. {total:,})")
        time.sleep(0.05)
    return total


def _delete_all(label: str, sql: str) -> int:
    with db.cursor() as cursor:
        cursor.execute(sql)
        removed = cursor.rowcount
    print(f"    {label}: -{removed:,}")
    return removed


def print_counts() -> None:
    checks: List[Tuple[str, str]] = [
        ("tabProtocolos (<2024)", f"SELECT COUNT(*) c FROM tabProtocolos WHERE AnoProtocolo < {YEAR_CUTOFF}"),
        ("tabProtocolos (>=2024)", f"SELECT COUNT(*) c FROM tabProtocolos WHERE AnoProtocolo >= {YEAR_CUTOFF}"),
        ("tabAndamento (<2024)", f"SELECT COUNT(*) c FROM tabAndamento WHERE AnoProtocoloLink < {YEAR_CUTOFF}"),
        ("tabAndamento (>=2024)", f"SELECT COUNT(*) c FROM tabAndamento WHERE AnoProtocoloLink >= {YEAR_CUTOFF}"),
        ("tabDetalhesServico (<2024)", f"SELECT COUNT(*) c FROM tabDetalhesServico WHERE AnoProtocoloLinkDet < {YEAR_CUTOFF}"),
        ("tab_os_ultimo_andamento (<2024)", f"SELECT COUNT(*) c FROM tab_os_ultimo_andamento_operacional WHERE ano_protocolo < {YEAR_CUTOFF}"),
        ("tab_os_audit_log (<2024)", f"SELECT COUNT(*) c FROM tab_os_audit_log WHERE ano_protocolo < {YEAR_CUTOFF}"),
        ("tab_pre_analise_snapshot (<2024)", f"SELECT COUNT(*) c FROM tab_pre_analise_snapshot WHERE AnoProtocolo < {YEAR_CUTOFF}"),
        ("tabProofTokens (<2024)", f"SELECT COUNT(*) c FROM tabProofTokens WHERE AnoProtocolo < {YEAR_CUTOFF}"),
        ("tab_pcp_fila (<2024)", f"SELECT COUNT(*) c FROM tab_pcp_fila WHERE ano < {YEAR_CUTOFF}"),
        ("tabMidiaDigital (<2024)", f"SELECT COUNT(*) c FROM tabMidiaDigital WHERE AnoProtocoloLinkMidia < {YEAR_CUTOFF}"),
    ]
    print(f"=== Contagens (ano < {YEAR_CUTOFF}) ===")
    for label, sql in checks:
        try:
            print(f"  {label}: {_count(sql):,}")
        except Exception as exc:
            print(f"  {label}: ERRO {exc}")


def execute_purge(*, rebuild_materialized: bool = True) -> dict:
    t0 = time.perf_counter()
    stats: dict = {}

    print(f"\n=== PURGE ano < {YEAR_CUTOFF} ===\n")

    # Satélites (pequenas) — ordem antes das principais
    satellite: List[Tuple[str, str]] = [
        ("tab_pcp_fila", f"DELETE FROM tab_pcp_fila WHERE ano < {YEAR_CUTOFF}"),
        ("tabMidiaDigital", f"DELETE FROM tabMidiaDigital WHERE AnoProtocoloLinkMidia < {YEAR_CUTOFF}"),
        ("tabProofTokens", f"DELETE FROM tabProofTokens WHERE AnoProtocolo < {YEAR_CUTOFF}"),
        ("tab_pre_analise_snapshot", f"DELETE FROM tab_pre_analise_snapshot WHERE AnoProtocolo < {YEAR_CUTOFF}"),
        ("tab_os_audit_log", f"DELETE FROM tab_os_audit_log WHERE ano_protocolo < {YEAR_CUTOFF}"),
        ("tab_os_ultimo_andamento_operacional", f"DELETE FROM tab_os_ultimo_andamento_operacional WHERE ano_protocolo < {YEAR_CUTOFF}"),
    ]
    print("Satélites:")
    for label, sql in satellite:
        try:
            stats[label] = _delete_all(label, sql)
        except Exception as exc:
            print(f"    {label}: PULADO ({exc})")
            stats[label] = 0

    # Principais — lotes
    print("\ntabAndamento:")
    stats["tabAndamento"] = _batch_delete(
        "tabAndamento",
        f"DELETE FROM tabAndamento WHERE AnoProtocoloLink < {YEAR_CUTOFF} LIMIT %s",
    )

    print("\ntabDetalhesServico:")
    stats["tabDetalhesServico"] = _batch_delete(
        "tabDetalhesServico",
        f"DELETE FROM tabDetalhesServico WHERE AnoProtocoloLinkDet < {YEAR_CUTOFF} LIMIT %s",
    )

    print("\ntabProtocolos:")
    stats["tabProtocolos"] = _batch_delete(
        "tabProtocolos",
        f"DELETE FROM tabProtocolos WHERE AnoProtocolo < {YEAR_CUTOFF} LIMIT %s",
    )

    if rebuild_materialized:
        print("\nRebuild tab_os_ultimo_andamento_operacional:")
        from services.os_ultimo_andamento_service import (  # noqa: E402
            backfill_os_ultimo_andamento_operacional,
        )

        bf = backfill_os_ultimo_andamento_operacional()
        stats["materialized_rebuild"] = bf
        print(f"    materialized: {bf.get('rows', 0):,} linhas em {bf.get('elapsed_seconds', 0)}s")

    stats["elapsed_seconds"] = round(time.perf_counter() - t0, 2)
    print(f"\nConcluído em {stats['elapsed_seconds']}s")
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=f"Remove OSs com ano < {YEAR_CUTOFF} do MySQL.")
    parser.add_argument("--execute", action="store_true", help="Executa DELETE (padrão: dry-run).")
    parser.add_argument("--yes", action="store_true", help="Confirma operação destrutiva.")
    parser.add_argument(
        "--skip-rebuild",
        action="store_true",
        help="Não reconstrói tab_os_ultimo_andamento_operacional após purge.",
    )
    args = parser.parse_args()

    print_counts()

    if not args.execute:
        print("\nDry-run. Para executar: python scripts/purge_os_pre_2024.py --execute --yes")
        return 0

    if not args.yes:
        print("\nERRO: use --yes para confirmar operação IRREVERSÍVEL.")
        return 1

    stats = execute_purge(rebuild_materialized=not args.skip_rebuild)
    print("\n=== Pós-purge ===")
    print_counts()
    print("\nResumo removido:", {k: v for k, v in stats.items() if k != "materialized_rebuild"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
