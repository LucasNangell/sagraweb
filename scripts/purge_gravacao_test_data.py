#!/usr/bin/env python3
"""
Limpa dados de teste do módulo Gravação Pendente / Externa no MySQL.

Remove sessões (pendente, externa, concluídas, entrega), arquivos, chapas e chat.
Por padrão NÃO apaga configs (cota, preços, cotas por fornecedor).
NÃO altera tabAndamento / MDB.

Usa config/ (.env + config.json). Confira o banco impresso antes de executar.

Uso:
  py -3 scripts/purge_gravacao_test_data.py
  py -3 scripts/purge_gravacao_test_data.py --execute --yes
  py -3 scripts/purge_gravacao_test_data.py --execute --yes --ano 2026 --os 1857
  py -3 scripts/purge_gravacao_test_data.py --execute --yes --include-config
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from config_manager import config_manager  # noqa: E402
from database import db  # noqa: E402

SESSION_TABLES = (
    "tab_os_gravacao_externa_mensagem",
    "tab_os_gravacao_externa_arquivo",
    "tab_os_gravacao_externa",
    "tab_os_gravacao_pendente_arquivo",
    "tab_os_gravacao_pendente_chapa",
    "tab_os_gravacao_pendente",
)

CONFIG_TABLES = (
    "tab_gravacao_pendente_cota_ajuste_log",
    "tab_gravacao_pendente_fornecedor_cota",
)


def _count(sql: str, params: list | None = None) -> int:
    rows = db.execute_query(sql, params or None)
    return int(rows[0]["c"]) if rows else 0


def _table_exists(table: str) -> bool:
    rows = db.execute_query(
        """
        SELECT 1 AS ok
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
        LIMIT 1
        """,
        (table,),
    )
    return bool(rows)


def print_connection_info() -> None:
    host = config_manager.get("db_host", "?")
    port = config_manager.get("db_port", "?")
    name = config_manager.get("db_name", "?")
    env = config_manager.get("env", "?")
    print(f"Banco: {name} @ {host}:{port} (env={env})")
    print()


def _os_filter(ano: int | None, os_nro: int | None) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []
    if ano is not None:
        clauses.append("OsAno = %s")
        params.append(ano)
    if os_nro is not None:
        clauses.append("OsNro = %s")
        params.append(os_nro)
    if not clauses:
        return "", []
    return " WHERE " + " AND ".join(clauses), params


def print_counts(ano: int | None, os_nro: int | None, *, include_config: bool) -> None:
    where, params = _os_filter(ano, os_nro)
    filtered = bool(where)

    print("=== Contagens (sessões) ===")
    for table in SESSION_TABLES:
        if not _table_exists(table):
            print(f"  {table}: (não existe)")
            continue
        if filtered and table.endswith(("_mensagem", "_arquivo", "_chapa")):
            parent = (
                "tab_os_gravacao_externa"
                if "externa" in table
                else "tab_os_gravacao_pendente"
            )
            fk = (
                "GravacaoExternaId"
                if "externa" in table
                else "GravacaoPendenteId"
            )
            sql = f"""
                SELECT COUNT(*) c
                FROM {table} child
                INNER JOIN {parent} parent ON parent.Id = child.{fk}
                {where.replace("OsAno", "parent.OsAno").replace("OsNro", "parent.OsNro")}
            """
            print(f"  {table}: {_count(sql, params):,}")
        elif filtered and table in (
            "tab_os_gravacao_externa",
            "tab_os_gravacao_pendente",
        ):
            print(f"  {table}: {_count(f'SELECT COUNT(*) c FROM {table}{where}', params):,}")
        else:
            print(f"  {table}: {_count(f'SELECT COUNT(*) c FROM {table}'):,}")

    if include_config:
        print()
        print("=== Contagens (config — serão limpas) ===")
        for table in CONFIG_TABLES:
            if not _table_exists(table):
                print(f"  {table}: (não existe)")
                continue
            print(f"  {table}: {_count(f'SELECT COUNT(*) c FROM {table}'):,}")
        if _table_exists("tab_gravacao_pendente_config"):
            rows = db.execute_query(
                """
                SELECT CotaInicialChapas, ControleListDesde, ControleListEpoch
                FROM tab_gravacao_pendente_config
                WHERE Id = 1
                """
            )
            row = rows[0] if rows else {}
            print(
                "  tab_gravacao_pendente_config: "
                f"cota={row.get('CotaInicialChapas')} "
                f"desde={row.get('ControleListDesde')} "
                f"epoch={row.get('ControleListEpoch')}"
            )
        if _table_exists("tab_gravacao_pendente_maquina_config"):
            print(
                "  tab_gravacao_pendente_maquina_config: "
                f"{_count('SELECT COUNT(*) c FROM tab_gravacao_pendente_maquina_config'):,} "
                "(preços/cotas de máquina NÃO são apagados; só log/fornecedor)"
            )
    print()


def purge_all(*, include_config: bool) -> dict[str, int]:
    def tx(cursor):
        totals: dict[str, int] = {}
        for table in SESSION_TABLES:
            cursor.execute(f"DELETE FROM {table}")
            totals[table] = cursor.rowcount
        if include_config:
            for table in CONFIG_TABLES:
                cursor.execute(f"DELETE FROM {table}")
                totals[table] = cursor.rowcount
            cursor.execute(
                """
                UPDATE tab_gravacao_pendente_config
                SET ControleListDesde = NULL
                WHERE Id = 1
                """
            )
            totals["tab_gravacao_pendente_config.ControleListDesde"] = cursor.rowcount
        return totals

    return db.execute_transaction([tx])[0]


def purge_filtered(
    ano: int | None,
    os_nro: int | None,
    *,
    include_config: bool,
) -> dict[str, int]:
    where, params = _os_filter(ano, os_nro)
    if not where:
        raise ValueError("Filtro vazio")

    def tx(cursor):
        totals: dict[str, int] = {}
        steps = [
            (
                "tab_os_gravacao_externa_mensagem",
                f"""
                DELETE m FROM tab_os_gravacao_externa_mensagem m
                INNER JOIN tab_os_gravacao_externa ge ON ge.Id = m.GravacaoExternaId
                {where.replace("OsAno", "ge.OsAno").replace("OsNro", "ge.OsNro")}
                """,
            ),
            (
                "tab_os_gravacao_externa_arquivo",
                f"""
                DELETE a FROM tab_os_gravacao_externa_arquivo a
                INNER JOIN tab_os_gravacao_externa ge ON ge.Id = a.GravacaoExternaId
                {where.replace("OsAno", "ge.OsAno").replace("OsNro", "ge.OsNro")}
                """,
            ),
            (
                "tab_os_gravacao_externa",
                f"DELETE FROM tab_os_gravacao_externa{where}",
            ),
            (
                "tab_os_gravacao_pendente_arquivo",
                f"""
                DELETE pa FROM tab_os_gravacao_pendente_arquivo pa
                INNER JOIN tab_os_gravacao_pendente gp ON gp.Id = pa.GravacaoPendenteId
                {where.replace("OsAno", "gp.OsAno").replace("OsNro", "gp.OsNro")}
                """,
            ),
            (
                "tab_os_gravacao_pendente_chapa",
                f"""
                DELETE pc FROM tab_os_gravacao_pendente_chapa pc
                INNER JOIN tab_os_gravacao_pendente gp ON gp.Id = pc.GravacaoPendenteId
                {where.replace("OsAno", "gp.OsAno").replace("OsNro", "gp.OsNro")}
                """,
            ),
            (
                "tab_os_gravacao_pendente",
                f"DELETE FROM tab_os_gravacao_pendente{where}",
            ),
        ]
        for label, sql in steps:
            cursor.execute(sql, params)
            totals[label] = cursor.rowcount

        if include_config:
            print(
                "AVISO: --include-config com --ano/--os limpa configs globais "
                "(não filtradas por OS).",
                file=sys.stderr,
            )
            for table in CONFIG_TABLES:
                cursor.execute(f"DELETE FROM {table}")
                totals[table] = cursor.rowcount
            cursor.execute(
                """
                UPDATE tab_gravacao_pendente_config
                SET ControleListDesde = NULL
                WHERE Id = 1
                """
            )
            totals["tab_gravacao_pendente_config.ControleListDesde"] = cursor.rowcount
        return totals

    return db.execute_transaction([tx])[0]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Limpa sessões de Gravação Pendente/Externa no MySQL (dados de teste)."
        ),
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Executa o DELETE (sem isso, apenas mostra contagens).",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirma execução sem prompt interativo.",
    )
    parser.add_argument(
        "--include-config",
        action="store_true",
        help=(
            "Também apaga log de cota, cotas por fornecedor e zera ControleListDesde. "
            "Mantém cota inicial e preços por máquina."
        ),
    )
    parser.add_argument("--ano", type=int, default=None, help="Filtrar por OsAno.")
    parser.add_argument(
        "--os",
        type=int,
        default=None,
        dest="os_nro",
        help="Filtrar por OsNro.",
    )
    args = parser.parse_args()

    print_connection_info()
    print(
        "Escopo: sessões MySQL (pendente/externa/arquivos/chapas/chat). "
        "Andamentos (tabAndamento) NÃO são alterados."
    )
    if args.include_config:
        print("Config: log de cota + cotas fornecedor + ControleListDesde serão limpos.")
    else:
        print("Config: preservada (use --include-config para limpar log/cotas fornecedor).")
    print()

    print_counts(args.ano, args.os_nro, include_config=args.include_config)

    if not args.execute:
        print("Dry-run. Use --execute --yes para apagar.")
        return 0

    if not args.yes:
        answer = input(
            "Confirma exclusão permanente no banco acima? [digite APAGAR]: "
        ).strip()
        if answer != "APAGAR":
            print("Cancelado.")
            return 1

    if args.ano is not None or args.os_nro is not None:
        totals = purge_filtered(
            args.ano, args.os_nro, include_config=args.include_config
        )
    else:
        totals = purge_all(include_config=args.include_config)

    print("=== Removido ===")
    for label, count in totals.items():
        print(f"  {label}: {count:,}")
    print()
    print("Concluído. Contagens após purge:")
    print_counts(args.ano, args.os_nro, include_config=args.include_config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
