"""Dump MySQL remoto (produção) para SQL e importa no MariaDB local (XAMPP).

Uso (somente máquina DEV):
  python tools/dump_mysql_prod_to_xampp.py

Não altera o servidor remoto — somente SELECT / SHOW.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

import pymysql
from pymysql.cursors import SSCursor

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = Path(r"C:\_sagra") / "sagrafulldb_dev_from_prod.sql"


def _sql_literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    if isinstance(value, datetime):
        return "'" + value.strftime("%Y-%m-%d %H:%M:%S") + "'"
    text = str(value)
    text = (
        text.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\x00", "\\0")
    )
    return "'" + text + "'"


def dump_database(
    *,
    host: str,
    user: str,
    password: str,
    database: str,
    out_path: Path,
    port: int = 3306,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    conn = pymysql.connect(
        host=host,
        user=user,
        password=password,
        database=database,
        port=port,
        charset="utf8mb4",
        connect_timeout=30,
        read_timeout=600,
        cursorclass=SSCursor,
    )
    try:
        with out_path.open("w", encoding="utf-8", newline="\n") as fh:
            fh.write("-- SAGRA DEV dump (read-only from production)\n")
            fh.write(f"-- Generated: {datetime.now().isoformat(timespec='seconds')}\n")
            fh.write("SET NAMES utf8mb4;\n")
            fh.write("SET FOREIGN_KEY_CHECKS=0;\n")
            fh.write("SET UNIQUE_CHECKS=0;\n")
            fh.write("SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n")
            fh.write(f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n")
            fh.write(f"USE `{database}`;\n\n")

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema=%s AND table_type='BASE TABLE' "
                    "ORDER BY table_name",
                    (database,),
                )
                tables = [r[0] for r in cur.fetchall()]

            print(f"Tabelas: {len(tables)} -> {out_path}", flush=True)

            for idx, table in enumerate(tables, 1):
                print(f"[{idx}/{len(tables)}] {table}", flush=True)
                with conn.cursor() as cur:
                    cur.execute(f"SHOW CREATE TABLE `{table}`")
                    row = cur.fetchone()
                    create_sql = row[1] if row else None
                if not create_sql:
                    continue
                # MySQL 8 collations → MariaDB 10.4 (XAMPP)
                create_sql = (
                    create_sql.replace("utf8mb4_0900_ai_ci", "utf8mb4_unicode_ci")
                    .replace("utf8mb4_0900_as_cs", "utf8mb4_bin")
                    .replace("utf8mb4_0900_as_ci", "utf8mb4_unicode_ci")
                )
                fh.write(f"DROP TABLE IF EXISTS `{table}`;\n")
                fh.write(create_sql + ";\n\n")

                with conn.cursor() as cur:
                    cur.execute(f"SELECT * FROM `{table}`")
                    batch: list[str] = []
                    batch_rows = 0
                    cols = None
                    while True:
                        rows = cur.fetchmany(500)
                        if not rows:
                            break
                        if cols is None:
                            cols = [d[0] for d in cur.description]
                            col_list = ",".join(f"`{c}`" for c in cols)
                        for row in rows:
                            values = ",".join(_sql_literal(v) for v in row)
                            batch.append(f"({values})")
                            batch_rows += 1
                            if len(batch) >= 50:
                                fh.write(
                                    f"INSERT INTO `{table}` ({col_list}) VALUES\n"
                                    + ",\n".join(batch)
                                    + ";\n"
                                )
                                batch.clear()
                    if batch:
                        fh.write(
                            f"INSERT INTO `{table}` ({col_list}) VALUES\n"
                            + ",\n".join(batch)
                            + ";\n"
                        )
                    fh.write("\n")
                    print(f"  rows≈{batch_rows}", flush=True)

            fh.write("SET FOREIGN_KEY_CHECKS=1;\n")
            fh.write("SET UNIQUE_CHECKS=1;\n")
    finally:
        conn.close()
    print(f"Dump OK: {out_path} ({out_path.stat().st_size / (1024*1024):.1f} MB)", flush=True)


def import_to_xampp(*, sql_path: Path, mysql_exe: Path, user: str = "root", password: str = "") -> None:
    import subprocess

    if not mysql_exe.exists():
        raise FileNotFoundError(mysql_exe)
    # MariaDB XAMPP: garantir pacote grande + collation MySQL 8 já normalizada no dump
    prep = [str(mysql_exe), "-u", user]
    if password:
        prep.append(f"-p{password}")
    prep.extend(
        [
            "-e",
            "SET GLOBAL max_allowed_packet=1073741824; "
            "DROP DATABASE IF EXISTS sagrafulldb; "
            "CREATE DATABASE sagrafulldb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
        ]
    )
    subprocess.run(prep, check=False)

    cmd = [
        str(mysql_exe),
        "-u",
        user,
        "--max-allowed-packet=1G",
        "--default-character-set=utf8mb4",
        "sagrafulldb",
    ]
    if password:
        cmd.insert(3, f"-p{password}")
    print(f"Importando em XAMPP via {mysql_exe} ...", flush=True)
    with sql_path.open("rb") as fh:
        proc = subprocess.run(cmd, stdin=fh, capture_output=True)
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", errors="replace")
        raise RuntimeError(f"Import falhou ({proc.returncode}): {err[:2000]}")
    print("Import OK", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="10.1.1.73")
    parser.add_argument("--user", default="usr_sagraweb")
    parser.add_argument(
        "--password",
        default="",
        help="Ou defina SAGRA_DUMP_PASSWORD / SAGRA_DB_PASSWORD",
    )
    parser.add_argument("--database", default="sagrafulldb")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--skip-dump", action="store_true")
    parser.add_argument("--skip-import", action="store_true")
    parser.add_argument(
        "--mysql-exe",
        type=Path,
        default=Path(r"C:\xampp\mysql\bin\mysql.exe"),
    )
    args = parser.parse_args()
    import os

    password = (
        args.password
        or os.environ.get("SAGRA_DUMP_PASSWORD")
        or os.environ.get("SAGRA_DB_PASSWORD")
        or ""
    )
    if not password and not args.skip_dump:
        print(
            "[ERRO] Informe --password ou SAGRA_DUMP_PASSWORD",
            file=sys.stderr,
        )
        return 2

    if not args.skip_dump:
        dump_database(
            host=args.host,
            user=args.user,
            password=password,
            database=args.database,
            out_path=args.out,
        )
    if not args.skip_import:
        import_to_xampp(sql_path=args.out, mysql_exe=args.mysql_exe)
        # sanity
        import subprocess

        check = subprocess.run(
            [str(args.mysql_exe), "-u", "root", "-e", f"USE {args.database}; SHOW TABLES;"],
            capture_output=True,
            text=True,
        )
        tables = [
            ln
            for ln in (check.stdout or "").splitlines()
            if ln and not ln.startswith("Tables_in_")
        ]
        print(f"Tabelas locais: {len(tables)}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"[ERRO] {exc}", file=sys.stderr)
        raise SystemExit(1)
