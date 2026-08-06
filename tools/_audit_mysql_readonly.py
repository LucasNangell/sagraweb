"""Read-only MySQL audit helper. Does NOT modify anything."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

import pymysql
from config_manager import config_manager

def get_mysql_config():
    return config_manager.get_mysql_config()

def load_config():
    return config_manager.config

SENSITIVE_PATTERNS = (
    "senha", "password", "token", "secret", "cpf", "email", "telefone",
    "celular", "hash", "salt", "api_key",
)


def mask_value(col_name: str, val):
    if val is None:
        return None
    cn = col_name.lower()
    if any(p in cn for p in SENSITIVE_PATTERNS):
        return "***MASCARADO***"
    s = str(val)
    if len(s) > 120:
        return s[:117] + "..."
    return s


def main():
    cfg = get_mysql_config()
    conn = pymysql.connect(
        host=cfg["host"],
        port=int(cfg.get("port", 3306)),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        read_timeout=120,
        connect_timeout=15,
    )
    cur = conn.cursor()

    cur.execute("SELECT DATABASE() AS db, VERSION() AS version")
    meta = cur.fetchone()

    cur.execute("SHOW TABLES")
    tables = [list(r.values())[0] for r in cur.fetchall()]
    tables.sort(key=str.lower)

    result = {"meta": meta, "tables": {}}

    for table in tables:
        tinfo = {}

        cur.execute(f"SELECT COUNT(*) AS cnt FROM `{table}`")
        tinfo["row_count"] = cur.fetchone()["cnt"]

        cur.execute(f"SHOW FULL COLUMNS FROM `{table}`")
        tinfo["columns"] = cur.fetchall()

        cur.execute(f"SHOW INDEX FROM `{table}`")
        tinfo["indexes"] = cur.fetchall()

        cur.execute(
            """
            SELECT
                kcu.CONSTRAINT_NAME,
                kcu.COLUMN_NAME,
                kcu.REFERENCED_TABLE_NAME,
                kcu.REFERENCED_COLUMN_NAME,
                rc.UPDATE_RULE,
                rc.DELETE_RULE
            FROM information_schema.KEY_COLUMN_USAGE kcu
            LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
            WHERE kcu.TABLE_SCHEMA = %s AND kcu.TABLE_NAME = %s
              AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
            """,
            (cfg["database"], table),
        )
        tinfo["foreign_keys"] = cur.fetchall()

        cur.execute(
            """
            SELECT TABLE_COMMENT
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
            """,
            (cfg["database"], table),
        )
        row = cur.fetchone()
        tinfo["table_comment"] = row["TABLE_COMMENT"] if row else ""

        try:
            cur.execute(f"SELECT * FROM `{table}` LIMIT 5")
            samples = cur.fetchall()
            masked = []
            for row in samples:
                masked.append({k: mask_value(k, v) for k, v in row.items()})
            tinfo["sample_rows"] = masked
        except Exception as e:
            tinfo["sample_rows_error"] = str(e)

        result["tables"][table] = tinfo

    conn.close()
    out = ROOT / "tools" / "_audit_mysql_output.json"
    out.write_text(json.dumps(result, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(tables)} tables -> {out}")


if __name__ == "__main__":
    main()
