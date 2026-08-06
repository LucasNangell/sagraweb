#!/usr/bin/env python3
"""
Cria índices de performance para GET /os/search (idempotente).

Uso:
  python deploy/scripts/apply_os_search_indexes.py
  python deploy/scripts/apply_os_search_indexes.py --dry-run
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app" / "backend"))

import pymysql  # noqa: E402

from config_manager import config_manager  # noqa: E402

INDEXES: list[tuple[str, str, str]] = [
    (
        "tabAndamento",
        "idx_andamento_os_ultimo_data",
        "(NroProtocoloLink, AnoProtocoloLink, UltimoStatus, `Data`, CodStatus)",
    ),
    (
        "tabAndamento",
        "idx_andamento_filtros",
        "(SituacaoLink(64), SetorLink(32), UltimoStatus)",
    ),
    (
        "tabProtocolos",
        "idx_protocolos_data_prioridade",
        "(EntregData, EntregPrazoLink(32), AnoProtocolo, NroProtocolo)",
    ),
    (
        "tabProtocolos",
        "idx_protocolos_solicitante",
        "(NomeUsuario(64))",
    ),
    (
        "tabDetalhesServico",
        "idx_detalhes_join",
        "(NroProtocoloLinkDet, AnoProtocoloLinkDet)",
    ),
    (
        "tabDetalhesServico",
        "idx_detalhes_produto_titulo",
        "(TipoPublicacaoLink(64), Titulo(64))",
    ),
]


def _existing_indexes(conn, table: str) -> set[str]:
    db_name = config_manager.get("db_name", "sagrafulldb")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT INDEX_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
            """,
            (db_name, table),
        )
        rows = cur.fetchall()
    names: set[str] = set()
    for row in rows:
        if isinstance(row, dict):
            names.add(row["INDEX_NAME"])
        else:
            names.add(row[0])
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description="Aplica índices de busca de OS.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Apenas lista o que seria criado",
    )
    args = parser.parse_args()

    password = config_manager.get("db_password") or ""
    if not password:
        print("ERRO: db_password não configurada (config/.env ou SAGRA_DB_PASSWORD).")
        return 1

    host = config_manager.get("db_host", "127.0.0.1")
    port = int(config_manager.get("db_port", 3306))
    user = config_manager.get("db_user", "usr_sagraweb")
    db_name = config_manager.get("db_name", "sagrafulldb")

    print(f"Conectando em {host}:{port}/{db_name} como {user}...")

    conn = pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=db_name,
        charset="utf8mb4",
    )

    created = 0
    skipped = 0
    try:
        for table, index_name, columns in INDEXES:
            existing = _existing_indexes(conn, table)
            if index_name in existing:
                print(f"  OK já existe: {table}.{index_name}")
                skipped += 1
                continue

            ddl = f"CREATE INDEX {index_name} ON {table} {columns}"
            print(f"  + {ddl}")
            if args.dry_run:
                created += 1
                continue

            with conn.cursor() as cur:
                cur.execute(ddl)
            conn.commit()
            print(f"    criado.")
            created += 1
    finally:
        conn.close()

    mode = "DRY-RUN" if args.dry_run else "CONCLUÍDO"
    print(f"\n=== {mode}: {created} índice(s) novos, {skipped} já existentes ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
