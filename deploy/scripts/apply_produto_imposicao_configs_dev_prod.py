"""Cria tabPapelariaProdutoImposicaoConfigs em DEV e PROD.

Uso (na raiz do repo):
  python deploy/scripts/apply_produto_imposicao_configs_dev_prod.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[2]
SQL_PATH = ROOT / "deploy" / "sql" / "create_papelaria_produto_imposicao_configs.sql"
TABLE = "tabPapelariaProdutoImposicaoConfigs"


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


def _table_exists(cur) -> bool:
    cur.execute(
        """
        SELECT COUNT(*) AS n
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
        """,
        (TABLE,),
    )
    row = cur.fetchone()
    return bool(row and int(row[0] or 0) > 0)


def _apply(label: str, *, host: str, port: int, user: str, password: str, database: str) -> None:
    print(f"[{label}] host={host} db={database} user={user}")
    ddl = SQL_PATH.read_text(encoding="utf-8")
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
            if _table_exists(cur):
                print(f"[{label}] {TABLE} já existe — ok")
                return
            for stmt in ddl.split(";"):
                s = stmt.strip()
                if s:
                    cur.execute(s)
            if not _table_exists(cur):
                raise RuntimeError(f"[{label}] DDL executado, mas tabela não apareceu")
            print(f"[{label}] {TABLE} criada")
    finally:
        conn.close()


def main() -> int:
    if not SQL_PATH.is_file():
        print(f"SQL não encontrado: {SQL_PATH}", file=sys.stderr)
        return 1

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
