#!/usr/bin/env python
"""
Varredura em tabAndamento no MySQL de PRODUÇÃO: garante exatamente 1 UltimoStatus=1
por OS/ano, no andamento operacional de maior CodStatus (sufixo numérico).

Rodar na VM de produção (release atual), NÃO no DEV local:

  cd "C:\\Sistemas CGraf\\Sagra Web\\current"
  python scripts/heal_ultimo_status_andamentos.py --dry-run
  python scripts/heal_ultimo_status_andamentos.py --apply --yes
  python scripts/heal_ultimo_status_andamentos.py --apply --yes --push-mdb

O script força ENV=production e aborta se o MySQL for localhost (XAMPP/dev),
salvo com --allow-dev (só para teste local).
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_BACKEND = os.path.join(_ROOT, "app", "backend")
for p in (_ROOT, _BACKEND):
    if p not in sys.path:
        sys.path.insert(0, p)

# Antes de importar database/config_manager: evita overlay DEV (XAMPP).
os.environ["ENV"] = "production"
os.environ["SAGRA_ENV"] = "production"

OsKey = Tuple[int, int]

_LOOPBACK = frozenset({"127.0.0.1", "localhost", "::1", "0.0.0.0"})


def _is_loopback(host: str) -> bool:
    return str(host or "").strip().lower() in _LOOPBACK


def _bootstrap_db(*, allow_dev: bool) -> Any:
    """Importa pool MySQL e valida que o alvo não é o banco local de DEV."""
    from config_manager import config_manager
    from database import db

    host = str(config_manager.get("db_host") or db.host or "")
    port = int(config_manager.get("db_port") or db.port or 3306)
    user = str(config_manager.get("db_user") or db.user or "")
    name = str(config_manager.get("db_name") or db.db or "")
    env = str(config_manager.get("env") or os.getenv("ENV") or "")

    print(f"Alvo MySQL: {user}@{host}:{port}/{name} (ENV={env})")

    if _is_loopback(host) and not allow_dev:
        print(
            "ERRO: host MySQL é local (DEV). Este heal deve rodar na produção.\n"
            "  1) Na VM: cd \"C:\\Sistemas CGraf\\Sagra Web\\current\"\n"
            "  2) python scripts/heal_ultimo_status_andamentos.py --dry-run\n"
            "  Ou, só para teste no XAMPP: acrescente --allow-dev"
        )
        raise SystemExit(2)

    if allow_dev and _is_loopback(host):
        print("AVISO: --allow-dev ativo — operando no MySQL LOCAL, não produção.")

    # Smoke: confirma que conecta e mostra DATABASE()
    meta = db.execute_query("SELECT DATABASE() AS db, @@hostname AS host") or []
    if meta:
        print(f"Conectado: database={meta[0].get('db')} server={meta[0].get('host')}")
    return db


def _find_inconsistent(
    db: Any,
    *,
    ano_min: int,
    limit: int,
    nro: Optional[int],
    ano: Optional[int],
) -> List[Dict[str, Any]]:
    """
    OS com COUNT(UltimoStatus=1) <> 1, ou flag no CodStatus que não é o maior
    operacional (exclui espelhos Sub OS).
    """
    from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE

    where = ["a.AnoProtocoloLink >= %s"]
    params: List[Any] = [ano_min]
    if nro is not None:
        where.append("a.NroProtocoloLink = %s")
        params.append(nro)
    if ano is not None:
        where.append("a.AnoProtocoloLink = %s")
        params.append(ano)
    where_sql = " AND ".join(where)

    sql = f"""
        SELECT
            a.NroProtocoloLink AS nro,
            a.AnoProtocoloLink AS ano,
            SUM(CASE WHEN a.UltimoStatus = 1 THEN 1 ELSE 0 END) AS flags,
            MAX(
                CASE
                    WHEN a.UltimoStatus = 1
                    THEN CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED)
                    ELSE NULL
                END
            ) AS flagged_seq,
            MAX(
                CASE
                    WHEN ({MIRROR_EXCLUDE_CLAUSE})
                    THEN CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED)
                    ELSE NULL
                END
            ) AS max_op_seq,
            GROUP_CONCAT(
                CASE WHEN a.UltimoStatus = 1 THEN a.CodStatus ELSE NULL END
                ORDER BY CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED) DESC
                SEPARATOR ','
            ) AS marked_codes
        FROM tabAndamento a
        WHERE {where_sql}
        GROUP BY a.NroProtocoloLink, a.AnoProtocoloLink
        HAVING
            SUM(CASE WHEN a.UltimoStatus = 1 THEN 1 ELSE 0 END) <> 1
            OR (
                MAX(
                    CASE
                        WHEN ({MIRROR_EXCLUDE_CLAUSE})
                        THEN CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED)
                        ELSE NULL
                    END
                ) IS NOT NULL
                AND (
                    MAX(
                        CASE
                            WHEN a.UltimoStatus = 1
                            THEN CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED)
                            ELSE NULL
                        END
                    ) IS NULL
                    OR MAX(
                        CASE
                            WHEN a.UltimoStatus = 1
                            THEN CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED)
                            ELSE NULL
                        END
                    ) <> MAX(
                        CASE
                            WHEN ({MIRROR_EXCLUDE_CLAUSE})
                            THEN CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED)
                            ELSE NULL
                        END
                    )
                )
            )
            OR (
                MAX(
                    CASE
                        WHEN ({MIRROR_EXCLUDE_CLAUSE})
                        THEN CAST(SUBSTRING_INDEX(a.CodStatus, '-', -1) AS UNSIGNED)
                        ELSE NULL
                    END
                ) IS NULL
                AND SUM(CASE WHEN a.UltimoStatus = 1 THEN 1 ELSE 0 END) > 0
            )
        ORDER BY a.AnoProtocoloLink DESC, a.NroProtocoloLink DESC
    """
    if limit and limit > 0:
        sql += " LIMIT %s"
        params.append(limit)

    return list(db.execute_query(sql, tuple(params)) or [])


def _heal_one(db: Any, nro: int, ano: int, *, push_mdb: bool) -> Optional[str]:
    from services.andamento_operacional import (
        align_ultimo_status_mysql_then_mdb,
        assert_or_fix_unico_ultimo_status,
    )

    if push_mdb:
        return align_ultimo_status_mysql_then_mdb(nro, ano, push_mdb=True)

    def _txn(cur):
        return assert_or_fix_unico_ultimo_status(cur, nro, ano)

    return db.execute_transaction([_txn])[0]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Produção: varre tabAndamento e corrige UltimoStatus "
            "(1 por OS/ano no maior CodStatus)"
        )
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help="Só lista inconsistências (não grava)",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Corrige no MySQL de produção (exige --yes)",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirma gravação em produção (obrigatório com --apply)",
    )
    parser.add_argument("--ano-min", type=int, default=2024, help="Ano mínimo (default 2024)")
    parser.add_argument("--limit", type=int, default=0, help="Limite de OS (0 = sem limite)")
    parser.add_argument("--nro", type=int, default=None, help="Filtrar uma OS")
    parser.add_argument("--ano", type=int, default=None, help="Filtrar um ano")
    parser.add_argument(
        "--push-mdb",
        action="store_true",
        help="Após corrigir MySQL, espelha UltimoStatus no Access/MDB",
    )
    parser.add_argument(
        "--allow-dev",
        action="store_true",
        help="Permite MySQL localhost (só teste; NÃO use em produção)",
    )
    args = parser.parse_args()

    if (args.nro is None) ^ (args.ano is None):
        print("Erro: use --nro e --ano juntos (ou nenhum dos dois).")
        return 2

    if args.apply and not args.yes:
        print("ERRO: --apply exige --yes (gravação em produção).")
        return 2

    db = _bootstrap_db(allow_dev=args.allow_dev)

    rows = _find_inconsistent(
        db,
        ano_min=args.ano_min,
        limit=args.limit,
        nro=args.nro,
        ano=args.ano,
    )
    print(f"OS inconsistentes: {len(rows)} (ano_min={args.ano_min})")
    if not rows:
        return 0

    seen: Set[OsKey] = set()
    fixed = 0
    for row in rows:
        nro = int(row["nro"])
        ano = int(row["ano"])
        key = (nro, ano)
        if key in seen:
            continue
        seen.add(key)

        flags = int(row.get("flags") or 0)
        flagged_seq = row.get("flagged_seq")
        max_op_seq = row.get("max_op_seq")
        marked = row.get("marked_codes") or ""
        print(
            f"  OS {nro:05d}/{ano}: flags={flags} "
            f"flagged_seq={flagged_seq} max_op_seq={max_op_seq} marked=[{marked}]"
        )

        if args.dry_run:
            continue

        promoted = _heal_one(db, nro, ano, push_mdb=args.push_mdb)
        print(f"    -> UltimoStatus -> {promoted}")
        fixed += 1

    if args.apply:
        print(f"Corrigidas: {fixed}")
    else:
        print(f"Would fix: {len(seen)} (dry-run)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
