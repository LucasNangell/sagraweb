"""Aplica coluna ImposicaoConfigJson em DEV e PROD sem imprimir credenciais.

Uso (na raiz do repo):
  python deploy/scripts/apply_imposicao_config_dev_prod.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[2]
DDL = (
    "ALTER TABLE tabPapelariaModelos "
    "ADD COLUMN ImposicaoConfigJson JSON NULL"
)
COLUMN = "ImposicaoConfigJson"
TABLE = "tabPapelariaModelos"


def _load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def _column_exists(cur, column: str = COLUMN) -> bool:
    cur.execute(
        """
        SELECT COUNT(*) AS n
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
          AND COLUMN_NAME = %s
        """,
        (TABLE, column),
    )
    row = cur.fetchone()
    return bool(row and int(row[0] or 0) > 0)


def _apply(label: str, *, host: str, port: int, user: str, password: str, database: str) -> None:
    print(f"[{label}] host={host} db={database} user={user}")
    conn = pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password or "",
        database=database,
        connect_timeout=10,
        charset="utf8mb4",
        autocommit=True,
    )
    try:
        with conn.cursor() as cur:
            if _column_exists(cur):
                print(f"[{label}] {COLUMN} já existe — ok")
                return
            cur.execute(DDL)
            if not _column_exists(cur):
                raise RuntimeError(f"[{label}] ALTER executado, mas coluna não apareceu")
            print(f"[{label}] {COLUMN} criada")
    finally:
        conn.close()


def main() -> int:
    dev_env = _load_dotenv(ROOT / "config" / ".env")
    prod_env = _load_dotenv(ROOT / "config" / ".env.production.test")

    targets = [
        (
            "DEV",
            {
                "host": dev_env.get("DB_HOST") or "127.0.0.1",
                "port": int(dev_env.get("DB_PORT") or 3306),
                "user": dev_env.get("DB_USER") or "root",
                "password": dev_env.get("DB_PASSWORD") or "",
                "database": dev_env.get("DB_NAME") or "sagrafulldb",
            },
        ),
        (
            "PROD",
            {
                "host": prod_env.get("DB_HOST") or "10.1.1.73",
                "port": int(prod_env.get("DB_PORT") or 3306),
                "user": prod_env.get("DB_USER") or "usr_sagraweb",
                "password": prod_env.get("DB_PASSWORD")
                or os.environ.get("SAGRA_DB_PASSWORD")
                or "",
                "database": prod_env.get("DB_NAME") or "sagrafulldb",
            },
        ),
    ]

    errors: list[str] = []
    for label, cfg in targets:
        try:
            _apply(label, **cfg)
        except Exception as exc:  # noqa: BLE001
            msg = f"[{label}] FALHA: {exc}"
            print(msg, file=sys.stderr)
            errors.append(msg)

    if errors:
        print("Concluído com falhas.", file=sys.stderr)
        return 1
    print("Concluído: DEV e PROD ok.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
