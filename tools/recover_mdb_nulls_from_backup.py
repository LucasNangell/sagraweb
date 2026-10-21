#!/usr/bin/env python3
"""Restaura no MDB atual valores que o dual-write apagou, usando um backup.

Só preenche colunas atualmente NULL/vazias. Nunca sobrescreve valor existente.

Exemplos:
  python tools/recover_mdb_nulls_from_backup.py --backup "D:\\bkp\\OS.mdb" --target os
  python tools/recover_mdb_nulls_from_backup.py --backup "D:\\bkp\\OS.mdb" --target os --apply --yes
"""
from __future__ import annotations

import argparse
import csv
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "app" / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config_manager import config_manager  # noqa: E402

TABLE_PKS = {
    "tabProtocolos": ("NroProtocolo", "AnoProtocolo"),
    "tabDetalhesServico": ("NroProtocoloLinkDet", "AnoProtocoloLinkDet"),
}
DEFAULT_COLUMNS = {
    "tabProtocolos": (),
    "tabDetalhesServico": (
        "CalcPgs1",
        "CalcQtdCores1",
        "CalcCor1",
        "CalcPgs2",
        "CalcQtdCores2",
        "CalcCor2",
        "CalcPgs3",
        "CalcQtdCores3",
        "CalcCor3",
    ),
}


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def row_key(row: Dict[str, Any], pk_fields: Sequence[str]) -> Tuple[Any, ...]:
    return tuple(row.get(field) for field in pk_fields)


def find_recoverable_cells(
    backup_rows: Iterable[Dict[str, Any]],
    current_rows: Iterable[Dict[str, Any]],
    pk_fields: Sequence[str],
    columns: Sequence[str],
) -> List[Dict[str, Any]]:
    current_by_key = {row_key(row, pk_fields): row for row in current_rows}
    hits: List[Dict[str, Any]] = []
    for backup_row in backup_rows:
        key = row_key(backup_row, pk_fields)
        if any(part is None for part in key):
            continue
        current_row = current_by_key.get(key)
        if current_row is None:
            continue
        for column in columns:
            backup_val = backup_row.get(column)
            if is_blank(backup_val):
                continue
            if not is_blank(current_row.get(column)):
                continue
            hits.append(
                {
                    "nro": key[0],
                    "ano": key[1],
                    "column": column,
                    "backup_value": backup_val,
                }
            )
    return hits


def _access_connect(path: str, readonly: bool):
    import pyodbc

    parts = [
        r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};",
        f"DBQ={path};",
    ]
    if readonly:
        parts.append("READONLY=1;")
    return pyodbc.connect("".join(parts), timeout=30)


def _read_table(conn, table: str, columns: Sequence[str], pk_fields: Sequence[str]) -> List[Dict[str, Any]]:
    wanted = list(dict.fromkeys([*pk_fields, *columns]))
    cursor = conn.cursor()
    try:
        cursor.execute(f"SELECT TOP 1 * FROM [{table}]")
        available = {desc[0] for desc in cursor.description if desc[0]}
        use_cols = [col for col in wanted if col in available]
        if any(pk not in use_cols for pk in pk_fields):
            raise RuntimeError(f"PK ausente em {table}: {pk_fields}")
        col_sql = ", ".join(f"[{col}]" for col in use_cols)
        cursor.execute(f"SELECT {col_sql} FROM [{table}]")
        return [dict(zip(use_cols, row)) for row in cursor.fetchall()]
    finally:
        cursor.close()


def _recent_web_writes(nro: int, ano: int) -> Optional[int]:
    try:
        from database import db

        found = db.execute_query(
            """
            SELECT COUNT(*) AS total
            FROM tab_os_audit_log
            WHERE nro_protocolo = %s AND ano_protocolo = %s
            """,
            (nro, ano),
        )
        if not found:
            return 0
        return int(found[0].get("total") or 0)
    except Exception:
        return None


def _write_csv(path: Path, rows: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["table", "nro", "ano", "column", "backup_value", "web_audit_count"]
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _backup_target_mdb(target_path: str) -> str:
    src = Path(target_path)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = src.with_name(f"{src.stem}.pre-recover-{stamp}{src.suffix}")
    shutil.copy2(src, dest)
    return str(dest)


def _apply_fills(target_path: str, table: str, pk_fields: Sequence[str], hits: List[Dict[str, Any]]) -> int:
    conn = _access_connect(target_path, readonly=False)
    cursor = conn.cursor()
    applied = 0
    try:
        grouped: Dict[Tuple[Any, Any], List[Dict[str, Any]]] = {}
        for hit in hits:
            grouped.setdefault((hit["nro"], hit["ano"]), []).append(hit)
        for (nro, ano), cells in grouped.items():
            try:
                for cell in cells:
                    column = cell["column"]
                    sql = (
                        f"UPDATE [{table}] SET [{column}] = ? "
                        f"WHERE [{pk_fields[0]}] = ? AND [{pk_fields[1]}] = ? "
                        f"AND ([{column}] IS NULL OR [{column}] = '')"
                    )
                    cursor.execute(sql, (cell["backup_value"], nro, ano))
                    applied += cursor.rowcount if cursor.rowcount and cursor.rowcount > 0 else 0
                conn.commit()
            except Exception:
                conn.rollback()
                raise
        return applied
    finally:
        cursor.close()
        conn.close()


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recupera NULLs do MDB a partir de um backup.")
    parser.add_argument("--backup", required=True, help="Caminho do .mdb de backup")
    parser.add_argument("--target", required=True, choices=("os", "papelaria"))
    parser.add_argument(
        "--tables",
        default="tabDetalhesServico",
        help="Tabelas CSV (tabDetalhesServico,tabProtocolos)",
    )
    parser.add_argument(
        "--columns",
        default="",
        help="Colunas CSV. Vazio usa o padrão Calc* em tabDetalhesServico.",
    )
    parser.add_argument("--csv-out", default="", help="Caminho do CSV de revisão")
    parser.add_argument("--apply", action="store_true", help="Aplica os UPDATEs no MDB atual")
    parser.add_argument("--yes", action="store_true", help="Confirma --apply sem prompt")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Só lista (padrão)")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    paths = config_manager.get_mdb_paths()
    target_path = paths["os_atual"] if args.target == "os" else paths["papelaria"]
    if not target_path or not Path(target_path).exists():
        print(f"MDB atual não encontrado: {target_path}")
        return 1
    if not Path(args.backup).exists():
        print(f"Backup não encontrado: {args.backup}")
        return 1

    tables = [name.strip() for name in args.tables.split(",") if name.strip()]
    extra_columns = [name.strip() for name in args.columns.split(",") if name.strip()]
    report_rows: List[Dict[str, Any]] = []

    backup_conn = _access_connect(args.backup, readonly=True)
    current_conn = _access_connect(target_path, readonly=True)
    try:
        for table in tables:
            pk_fields = TABLE_PKS.get(table)
            if not pk_fields:
                print(f"Tabela não suportada: {table}")
                return 1
            columns = extra_columns or list(DEFAULT_COLUMNS.get(table) or ())
            if not columns:
                print(f"Nenhuma coluna para {table}. Use --columns.")
                return 1
            backup_rows = _read_table(backup_conn, table, columns, pk_fields)
            current_rows = _read_table(current_conn, table, columns, pk_fields)
            hits = find_recoverable_cells(backup_rows, current_rows, pk_fields, columns)
            for hit in hits:
                audit_count = _recent_web_writes(hit["nro"], hit["ano"])
                report_rows.append(
                    {
                        "table": table,
                        "nro": hit["nro"],
                        "ano": hit["ano"],
                        "column": hit["column"],
                        "backup_value": hit["backup_value"],
                        "web_audit_count": "" if audit_count is None else audit_count,
                    }
                )
    finally:
        backup_conn.close()
        current_conn.close()

    csv_path = Path(args.csv_out) if args.csv_out else ROOT / "logs" / "recover_mdb_nulls.csv"
    _write_csv(csv_path, report_rows)
    print(f"Células recuperáveis: {len(report_rows)}")
    print(f"CSV: {csv_path}")

    if not args.apply:
        print("Dry-run. Reexecute com --apply --yes para gravar (só preenche NULL).")
        return 0
    if not args.yes:
        print("Recusa: --apply exige --yes.")
        return 2

    safety_copy = _backup_target_mdb(target_path)
    print(f"Cópia de segurança: {safety_copy}")
    applied = 0
    for table in tables:
        pk_fields = TABLE_PKS[table]
        table_hits = [
            {
                "nro": row["nro"],
                "ano": row["ano"],
                "column": row["column"],
                "backup_value": row["backup_value"],
            }
            for row in report_rows
            if row["table"] == table
        ]
        applied += _apply_fills(target_path, table, pk_fields, table_hits)
    print(f"Células aplicadas (rowcount): {applied}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
