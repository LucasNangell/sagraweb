#!/usr/bin/env python
"""
One-shot: corrige UltimoStatus em tabAndamento (MySQL).
Garante exatamente 1 flag=1 por OS no maior CodStatus operacional.

Uso (na raiz do release / repo, com PYTHONPATH=app/backend):
  python scripts/heal_ultimo_status_andamentos.py
  python scripts/heal_ultimo_status_andamentos.py --dry-run
  python scripts/heal_ultimo_status_andamentos.py --limit 200
"""
from __future__ import annotations

import argparse
import os
import sys

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_BACKEND = os.path.join(_ROOT, "app", "backend")
for p in (_ROOT, _BACKEND):
    if p not in sys.path:
        sys.path.insert(0, p)


def main() -> int:
    parser = argparse.ArgumentParser(description="Heal UltimoStatus por OS")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--ano-min", type=int, default=2024)
    args = parser.parse_args()

    from database import db
    from services.andamento_operacional import (
        assert_or_fix_unico_ultimo_status,
        select_expected_ultimo_cod,
    )

    rows = db.execute_query(
        """
        SELECT NroProtocoloLink AS nro, AnoProtocoloLink AS ano,
               SUM(UltimoStatus = 1) AS flags
        FROM tabAndamento
        WHERE AnoProtocoloLink >= %s
        GROUP BY NroProtocoloLink, AnoProtocoloLink
        HAVING flags <> 1
        LIMIT %s
        """,
        (args.ano_min, args.limit),
    ) or []

    # Tambem OSs cujo UltimoStatus=1 nao e o maior CodStatus
    candidates = {(int(r["nro"]), int(r["ano"])) for r in rows}
    flagged = db.execute_query(
        """
        SELECT DISTINCT NroProtocoloLink AS nro, AnoProtocoloLink AS ano
        FROM tabAndamento
        WHERE AnoProtocoloLink >= %s AND UltimoStatus = 1
        LIMIT %s
        """,
        (args.ano_min, args.limit * 5),
    ) or []

    print(f"OSs com COUNT(UltimoStatus=1)<>1: {len(rows)}")
    fixed = 0
    checked = 0

    def _heal(nro: int, ano: int) -> None:
        nonlocal fixed, checked
        checked += 1

        def _txn(cur):
            expected = select_expected_ultimo_cod(cur, nro, ano)
            cur.execute(
                """
                SELECT CodStatus FROM tabAndamento
                WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
                  AND UltimoStatus = 1
                """,
                (nro, ano),
            )
            marked = []
            for row in cur.fetchall() or []:
                cod = row.get("CodStatus") if isinstance(row, dict) else row[0]
                if cod:
                    marked.append(str(cod))
            ok = expected is not None and len(marked) == 1 and marked[0] == expected
            if ok:
                return None
            if args.dry_run:
                print(f"  DRY OS {nro}/{ano} marked={marked} expected={expected}")
                return "dry"
            return assert_or_fix_unico_ultimo_status(cur, nro, ano)

        result = db.execute_transaction([_txn])[0]
        if result and result != "dry":
            fixed += 1
            print(f"  HEAL OS {nro}/{ano} -> {result}")
        elif result == "dry":
            fixed += 1

    for nro, ano in sorted(candidates):
        _heal(nro, ano)

    for r in flagged:
        key = (int(r["nro"]), int(r["ano"]))
        if key in candidates:
            continue
        # Verifica se o marcado e o esperado
        def _check(cur, nro=key[0], ano=key[1]):
            expected = select_expected_ultimo_cod(cur, nro, ano)
            cur.execute(
                """
                SELECT CodStatus FROM tabAndamento
                WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
                  AND UltimoStatus = 1
                LIMIT 1
                """,
                (nro, ano),
            )
            row = cur.fetchone()
            marked = None
            if row:
                marked = row.get("CodStatus") if isinstance(row, dict) else row[0]
            if expected and marked and str(marked) != str(expected):
                if args.dry_run:
                    print(f"  DRY OS {nro}/{ano} marked={marked} expected={expected}")
                    return "dry"
                return assert_or_fix_unico_ultimo_status(cur, nro, ano)
            return None

        result = db.execute_transaction([_check])[0]
        checked += 1
        if result and result != "dry":
            fixed += 1
            print(f"  HEAL OS {key[0]}/{key[1]} -> {result}")
        elif result == "dry":
            fixed += 1

    print(f"Checked={checked} fixed/would_fix={fixed} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
