"""
Sincroniza tabPapel.Espessura (e papéis da calculadora) a partir do CalcularLombada2010.mdb.

Uso:
  python -m scripts.sync_papel_espessura_lombada
  python -m scripts.sync_papel_espessura_lombada --dry-run
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Alinha Espessura de tabPapel com CalcularLombada2010.mdb"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Só lista divergências, sem gravar no MySQL",
    )
    parser.add_argument(
        "--mdb",
        default=None,
        help="Caminho do .mdb (default: config mdb_lombada_path ou Bancos Extras)",
    )
    args = parser.parse_args()

    from lookup_sync import sync_papel_espessura_from_lombada_mdb

    report = sync_papel_espessura_from_lombada_mdb(
        mdb_path=args.mdb,
        dry_run=args.dry_run,
        force=True,
    )
    print(report.format_text())
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
