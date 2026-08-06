"""Read-only MDB/Access audit helper. Does NOT modify anything."""
import json
import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from config_manager import config_manager

def load_config():
    return config_manager.config

SENSITIVE = ("senha", "password", "token", "secret", "cpf", "email", "telefone", "celular")


def mask(col, val):
    if val is None:
        return None
    if any(p in col.lower() for p in SENSITIVE):
        return "***MASCARADO***"
    s = str(val)
    return s[:117] + "..." if len(s) > 120 else s


def audit_mdb(label, path):
    info = {"label": label, "path": path, "accessible": False}
    p = Path(path)
    if not p.exists():
        info["error"] = "Arquivo não encontrado"
        try:
            info["parent_exists"] = p.parent.exists()
        except Exception:
            pass
        return info

    info["accessible"] = True
    st = p.stat()
    info["size_bytes"] = st.st_size
    info["size_mb"] = round(st.st_size / (1024 * 1024), 2)
    info["modified"] = datetime.fromtimestamp(st.st_mtime).isoformat()

    try:
        import pyodbc
    except ImportError as e:
        info["odbc_error"] = f"pyodbc não disponível: {e}"
        return info

    conn_str = (
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
        rf"DBQ={path};"
    )
    try:
        conn = pyodbc.connect(conn_str, readonly=True)
    except Exception as e:
        info["odbc_connect_error"] = str(e)
        return info

    cur = conn.cursor()
    tables = []
    for row in cur.tables(tableType="TABLE"):
        tname = row.table_name
        if tname.startswith("MSys"):
            continue
        tables.append(tname)

    info["tables"] = {}
    for tname in sorted(tables, key=str.lower):
        tinfo = {"columns": [], "indexes": [], "row_count": None, "sample_rows": []}
        try:
            cols = cur.columns(table=tname)
            for c in cols:
                tinfo["columns"].append({
                    "name": c.column_name,
                    "type": c.type_name,
                    "size": c.column_size,
                    "nullable": c.nullable,
                    "ordinal": c.ordinal_position,
                })
        except Exception as e:
            tinfo["columns_error"] = str(e)

        try:
            for idx in cur.statistics(table=tname):
                tinfo["indexes"].append({
                    "name": idx.index_name,
                    "column": idx.column_name,
                    "non_unique": idx.non_unique,
                    "type": idx.type,
                })
        except Exception:
            pass

        try:
            cur.execute(f"SELECT COUNT(*) FROM [{tname}]")
            tinfo["row_count"] = cur.fetchone()[0]
        except Exception as e:
            tinfo["row_count_error"] = str(e)

        try:
            cur.execute(f"SELECT TOP 3 * FROM [{tname}]")
            col_names = [d[0] for d in cur.description]
            for row in cur.fetchall():
                tinfo["sample_rows"].append(
                    {col_names[i]: mask(col_names[i], row[i]) for i in range(len(col_names))}
                )
        except Exception as e:
            tinfo["sample_error"] = str(e)

        info["tables"][tname] = tinfo

    conn.close()
    return info


def main():
    cfg = load_config()
    paths = {
        "OS Atual": cfg.get("mdb_os_atual_path"),
        "Papelaria Atual": cfg.get("mdb_papelaria_path"),
        "OS AntigaCore": cfg.get("mdb_os_antiga_path"),
        "Papelaria Antiga": cfg.get("mdb_papelaria_antiga_path"),
    }
    sat = r"\\redecamara\dfsdata\cgraf\ControleDeTrabalhos\BaseDeDados - SAGRA2\BaseDeDados - SAT\Base de dados SAT.accdb"
    paths["SAT ACCDB"] = sat

    result = {}
    for label, path in paths.items():
        if path:
            result[label] = audit_mdb(label, path)

    out = ROOT / "tools" / "_audit_mdb_output.json"
    out.write_text(json.dumps(result, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK -> {out}")


if __name__ == "__main__":
    main()
