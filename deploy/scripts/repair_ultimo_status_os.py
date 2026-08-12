"""Repara UltimoStatus inconsistente em MySQL e MDB (único e no último operacional).

Uso:
  python deploy/scripts/repair_ultimo_status_os.py --dry-run
  python deploy/scripts/repair_ultimo_status_os.py --apply
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "app" / "backend"
for path in (str(ROOT), str(BACKEND)):
    if path not in sys.path:
        sys.path.insert(0, path)

from database import db  # noqa: E402
from services.andamento_operacional import (  # noqa: E402
    MIRROR_EXCLUDE_CLAUSE,
    ULTIMO_ORDER_BY_SQL,
    align_ultimo_status_mysql_then_mdb,
    get_ultimo_operacional_cod_mysql,
)


def _find_inconsistent_os(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """OS com 0 ou >1 UltimoStatus=1, ou flag no andamento espelho."""
    sql = f"""
        SELECT a.NroProtocoloLink AS nro, a.AnoProtocoloLink AS ano,
               SUM(CASE WHEN a.UltimoStatus = 1 THEN 1 ELSE 0 END) AS qtd_ultimo,
               SUM(
                 CASE
                   WHEN a.UltimoStatus = 1
                    AND EXISTS (
                        SELECT 1 FROM tab_os_sub_os_andamento m
                        WHERE m.cod_status_espelho IS NOT NULL
                          AND m.cod_status_espelho != ''
                          AND m.cod_status_espelho COLLATE utf8mb4_general_ci
                              = a.CodStatus COLLATE utf8mb4_general_ci
                    )
                   THEN 1 ELSE 0
                 END
               ) AS qtd_ultimo_espelho
        FROM tabAndamento a
        GROUP BY a.NroProtocoloLink, a.AnoProtocoloLink
        HAVING SUM(CASE WHEN a.UltimoStatus = 1 THEN 1 ELSE 0 END) <> 1
            OR SUM(
                 CASE
                   WHEN a.UltimoStatus = 1
                    AND EXISTS (
                        SELECT 1 FROM tab_os_sub_os_andamento m
                        WHERE m.cod_status_espelho IS NOT NULL
                          AND m.cod_status_espelho != ''
                          AND m.cod_status_espelho COLLATE utf8mb4_general_ci
                              = a.CodStatus COLLATE utf8mb4_general_ci
                    )
                   THEN 1 ELSE 0
                 END
               ) > 0
        ORDER BY a.AnoProtocoloLink DESC, a.NroProtocoloLink DESC
    """
    if limit and limit > 0:
        sql += f" LIMIT {int(limit)}"
    return list(db.execute_query(sql) or [])


def _expected_ultimo(nro: int, ano: int) -> Optional[str]:
    rows = db.execute_query(
        f"""
        SELECT a.CodStatus
        FROM tabAndamento a
        WHERE a.NroProtocoloLink = %s AND a.AnoProtocoloLink = %s
          AND {MIRROR_EXCLUDE_CLAUSE}
        {ULTIMO_ORDER_BY_SQL}
        LIMIT 1
        """,
        (nro, ano),
    )
    if not rows:
        return None
    cod = rows[0].get("CodStatus")
    return str(cod) if cod else None


def repair_one(nro: int, ano: int, *, push_mdb: bool) -> Tuple[Optional[str], Optional[str]]:
    before = get_ultimo_operacional_cod_mysql(nro, ano)
    after = align_ultimo_status_mysql_then_mdb(nro, ano, push_mdb=push_mdb)
    return before, after


def main() -> int:
    parser = argparse.ArgumentParser(description="Repara UltimoStatus MySQL+MDB")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Somente lista inconsistências")
    mode.add_argument("--apply", action="store_true", help="Recalcula e espelha no MDB")
    parser.add_argument("--limit", type=int, default=0, help="Limite de OS a processar")
    parser.add_argument(
        "--skip-mdb",
        action="store_true",
        help="Só MySQL (não espelha MDB)",
    )
    args = parser.parse_args()

    rows = _find_inconsistent_os(limit=args.limit or None)
    print(f"OS inconsistentes: {len(rows)}")
    if not rows:
        return 0

    fixed = 0
    for row in rows:
        nro = int(row["nro"])
        ano = int(row["ano"])
        qtd = int(row.get("qtd_ultimo") or 0)
        expected = _expected_ultimo(nro, ano)
        current = get_ultimo_operacional_cod_mysql(nro, ano)
        print(
            f"  OS {nro:05d}/{ano}: qtd_ultimo={qtd} atual={current} esperado={expected}"
        )
        if args.dry_run:
            continue
        before, after = repair_one(nro, ano, push_mdb=not args.skip_mdb)
        print(f"    -> promovido {before} => {after}")
        fixed += 1

    if args.apply:
        print(f"Reparadas: {fixed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
