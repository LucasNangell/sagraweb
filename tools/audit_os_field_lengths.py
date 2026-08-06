"""Auditoria de tamanhos de campos de texto da OS — somente SELECT.

Uso:
  python tools/audit_os_field_lengths.py
  python tools/audit_os_field_lengths.py --year 2024 --json

Gera avg / approx p50 / approx p90 / max de CHAR_LENGTH para calibrar a UI.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))

from config_manager import ConfigManager  # noqa: E402

# (table, column, form_key)
FIELDS: list[tuple[str, str, str]] = [
    ("tabProtocolos", "NomeUsuario", "req_solicitante"),
    ("tabProtocolos", "OrgInteressado", "req_orgao_interessado"),
    ("tabProtocolos", "Titular", "req_titular"),
    ("tabProtocolos", "SiglaOrgao", "req_sigla"),
    ("tabProtocolos", "GabSalaUsuario", "req_gabinete"),
    ("tabProtocolos", "Andar", "req_andar"),
    ("tabProtocolos", "Localizacao", "req_local"),
    ("tabProtocolos", "CodigoRequisic", "req_codigo"),
    ("tabProtocolos", "CategoriaLink", "req_categoria"),
    ("tabProtocolos", "ProcessoSolicit", "op_processo"),
    ("tabProtocolos", "CSnro", "op_cs"),
    ("tabProtocolos", "ContatoTrab", "txt_contato"),
    ("tabProtocolos", "EntregPrazoLink", "val_prioridade"),
    ("tabDetalhesServico", "Titulo", "val_titulo"),
    ("tabDetalhesServico", "TipoPublicacaoLink", "val_produto"),
    ("tabDetalhesServico", "FormatoLink", "val_formato"),
    ("tabDetalhesServico", "MaquinaLink", "val_maquina"),
    ("tabDetalhesServico", "PapelLink", "val_papel"),
    ("tabDetalhesServico", "PapelDescricao", "txt_papel_desc"),
    ("tabDetalhesServico", "Cores", "val_cores"),
    ("tabDetalhesServico", "CoresDescricao", "txt_cores_desc"),
    ("tabDetalhesServico", "DescAcabamento", "txt_acabamento"),
    ("tabDetalhesServico", "Observ", "txt_obs"),
    ("tabDetalhesServico", "InsumosFornecidos", "mat_insumos"),
]


def year_column(table: str) -> str:
    if table == "tabProtocolos":
        return "AnoProtocolo"
    return "AnoProtocoloLinkDet"


def length_stats(cur, table: str, column: str, year: int) -> dict:
    ycol = year_column(table)
    # AVG / MAX over non-empty values
    cur.execute(
        f"""
        SELECT
          COUNT(*) AS n,
          ROUND(AVG(CHAR_LENGTH(`{column}`)), 1) AS avg_len,
          MAX(CHAR_LENGTH(`{column}`)) AS max_len
        FROM `{table}`
        WHERE `{ycol}` >= %s
          AND `{column}` IS NOT NULL
          AND CHAR_LENGTH(TRIM(`{column}`)) > 0
        """,
        (year,),
    )
    base = cur.fetchone() or {}
    n = int(base.get("n") or 0)
    if n == 0:
        return {
            "n": 0,
            "avg": 0,
            "p50": 0,
            "p90": 0,
            "max": 0,
        }

    # Approx percentiles via ORDER BY + OFFSET (sampled cap for large tables)
    sample_limit = min(n, 50000)
    cur.execute(
        f"""
        SELECT CHAR_LENGTH(`{column}`) AS L
        FROM `{table}`
        WHERE `{ycol}` >= %s
          AND `{column}` IS NOT NULL
          AND CHAR_LENGTH(TRIM(`{column}`)) > 0
        ORDER BY CHAR_LENGTH(`{column}`)
        LIMIT %s
        """,
        (year, sample_limit),
    )
    lengths = [int(r["L"]) for r in cur.fetchall()]
    if not lengths:
        return {
            "n": n,
            "avg": float(base.get("avg_len") or 0),
            "p50": 0,
            "p90": 0,
            "max": int(base.get("max_len") or 0),
        }

    def pct(p: float) -> int:
        idx = min(len(lengths) - 1, max(0, int(round((p / 100.0) * (len(lengths) - 1)))))
        return lengths[idx]

    return {
        "n": n,
        "avg": float(base.get("avg_len") or 0),
        "p50": pct(50),
        "p90": pct(90),
        "max": int(base.get("max_len") or lengths[-1]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit OS text field lengths")
    parser.add_argument("--year", type=int, default=2024)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    cfg = ConfigManager().get_mysql_config()
    conn = pymysql.connect(
        host=cfg["host"],
        port=cfg.get("port", 3306),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=15,
        read_timeout=300,
    )

    results: dict[str, dict] = {}
    try:
        with conn.cursor() as cur:
            for table, column, form_key in FIELDS:
                try:
                    stats = length_stats(cur, table, column, args.year)
                    results[form_key] = {
                        "table": table,
                        "column": column,
                        **stats,
                    }
                except Exception as exc:  # noqa: BLE001
                    results[form_key] = {
                        "table": table,
                        "column": column,
                        "error": str(exc),
                    }
    finally:
        conn.close()

    if args.json:
        print(json.dumps({"year_from": args.year, "fields": results}, indent=2, ensure_ascii=False))
        return

    print(f"Field length audit (Ano >= {args.year})")
    print(f"{'form_key':28} {'n':>8} {'avg':>8} {'p50':>6} {'p90':>6} {'max':>6}")
    print("-" * 70)
    for key, row in results.items():
        if "error" in row:
            print(f"{key:28} ERROR: {row['error']}")
            continue
        print(
            f"{key:28} {row['n']:8d} {row['avg']:8.1f} {row['p50']:6d} {row['p90']:6d} {row['max']:6d}"
        )


if __name__ == "__main__":
    main()
