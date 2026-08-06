#!/usr/bin/env python3
"""
Importação idempotente: tabRegistroPT (Access SAT) -> tabAnalises / tabAnaliseItens.

Somente registros cujo Código (SAT) ainda não consta em tabMigracaoSatRegistroPT.

Exemplos:
  python deploy/scripts/migrate_sat_registro_pt.py --dry-run
  python deploy/scripts/migrate_sat_registro_pt.py --apply
  python deploy/scripts/migrate_sat_registro_pt.py --apply --limit 50
  python deploy/scripts/migrate_sat_registro_pt.py --apply --no-copy-pdf
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from services.sat_registro_pt_migration import (  # noqa: E402
    DEFAULT_SAT_ACCDB,
    MigrationStats,
    migrate_sat_registro_pt,
)


def _print_stats(stats: MigrationStats, *, dry_run: bool) -> None:
    mode = "DRY-RUN" if dry_run else "APLICADO"
    print(f"\n=== Migração SAT ({mode}) ===")
    print(f"Lidos no Access:        {stats.scanned}")
    print(f"Já importados (skip):   {stats.skipped_existing}")
    print(f"Ignorados (inválidos):  {stats.skipped_invalid}")
    print(f"Inseridos/simulados:    {stats.inserted}")
    print(f"Vínculo biblioteca:     {stats.padrao_linked} (só ID_ProblemaPadrao)")
    print(f"PDF para HTML:          {stats.pdf_converted}")
    print(f"PDF cópia storage:      {stats.pdf_copy}")
    print(f"PDF ausente:            {stats.pdf_missing}")
    print(f"Falha conversão PDF:    {stats.pdf_convert_failed}")
    if stats.errors:
        print(f"Erros ({len(stats.errors)}):")
        for err in stats.errors[:20]:
            print(f"  - {err}")
        if len(stats.errors) > 20:
            print(f"  ... e mais {len(stats.errors) - 20}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Migra tabRegistroPT (SAT) para MySQL.")
    parser.add_argument(
        "--accdb",
        default=DEFAULT_SAT_ACCDB,
        help="Caminho da base Access SAT (.accdb)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Grava no MySQL (padrão: apenas simulação)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Força simulação (não grava)",
    )
    parser.add_argument("--min-ano", type=int, default=2024, help="Ano mínimo a importar")
    parser.add_argument("--limit", type=int, default=None, help="Máximo de linhas processadas")
    parser.add_argument(
        "--no-copy-pdf",
        action="store_true",
        help="Não copia PDFs para storage/legacy_sat_pt",
    )
    args = parser.parse_args()

    dry_run = not args.apply or args.dry_run
    if not dry_run:
        print("ATENÇÃO: modo --apply ativo. Serão inseridos apenas registros SAT ainda não migrados.")
    else:
        print("Modo simulação (sem gravação). Use --apply para executar.")

    stats = migrate_sat_registro_pt(
        accdb_path=args.accdb,
        dry_run=dry_run,
        min_ano=args.min_ano,
        copy_pdf=not args.no_copy_pdf,
        limit=args.limit,
    )
    _print_stats(stats, dry_run=dry_run)
    return 1 if stats.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
