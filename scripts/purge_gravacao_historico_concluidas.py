#!/usr/bin/env python3
"""
Remove do MySQL as sessões de Gravação Externa concluídas (histórico da aba
Gravação Pendente) e dados vinculados (mensagens, arquivos, sessão pendente origem).

NÃO altera tabAndamento, tabProtocolos nem sessões ativas (pendente/iniciada).

Usa config/ (.env + config.json) — em produção, execute no servidor com o .env de prod.

Uso:
  python scripts/purge_gravacao_historico_concluidas.py
  python scripts/purge_gravacao_historico_concluidas.py --execute --yes
  python scripts/purge_gravacao_historico_concluidas.py --execute --yes --ano 2024 --os 1857

Script temporário para testes — apague após usar.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from config_manager import config_manager  # noqa: E402
from database import db  # noqa: E402


def _where_clause(ano: int | None, os_nro: int | None) -> tuple[str, list]:
    clauses = ["ge.Status = 'concluida'"]
    params: list = []
    if ano is not None:
        clauses.append("ge.OsAno = %s")
        params.append(ano)
    if os_nro is not None:
        clauses.append("ge.OsNro = %s")
        params.append(os_nro)
    return " AND ".join(clauses), params


def _count(sql: str, params: list | None = None) -> int:
    rows = db.execute_query(sql, params or None)
    return int(rows[0]["c"]) if rows else 0


def print_connection_info() -> None:
    host = config_manager.get("db_host", "?")
    port = config_manager.get("db_port", "?")
    name = config_manager.get("db_name", "?")
    env = config_manager.get("env", "?")
    print(f"Banco: {name} @ {host}:{port} (env={env})")
    print()


def print_counts(ano: int | None, os_nro: int | None) -> None:
    where, params = _where_clause(ano, os_nro)
    base = f"FROM tab_os_gravacao_externa ge WHERE {where}"

    checks = [
        ("Sessões externa concluídas", f"SELECT COUNT(*) c {base}"),
        (
            "Mensagens vinculadas",
            f"""
            SELECT COUNT(*) c
            FROM tab_os_gravacao_externa_mensagem m
            INNER JOIN tab_os_gravacao_externa ge ON ge.Id = m.GravacaoExternaId
            WHERE {where}
            """,
        ),
        (
            "Arquivos externa vinculados",
            f"""
            SELECT COUNT(*) c
            FROM tab_os_gravacao_externa_arquivo a
            INNER JOIN tab_os_gravacao_externa ge ON ge.Id = a.GravacaoExternaId
            WHERE {where}
            """,
        ),
        (
            "Sessões pendente origem",
            f"""
            SELECT COUNT(*) c
            FROM tab_os_gravacao_pendente gp
            INNER JOIN tab_os_gravacao_externa ge ON ge.OrigemPendenteId = gp.Id
            WHERE {where} AND ge.OrigemPendenteId IS NOT NULL
            """,
        ),
        (
            "Arquivos pendente origem",
            f"""
            SELECT COUNT(*) c
            FROM tab_os_gravacao_pendente_arquivo pa
            INNER JOIN tab_os_gravacao_externa ge ON ge.OrigemPendenteId = pa.GravacaoPendenteId
            WHERE {where} AND ge.OrigemPendenteId IS NOT NULL
            """,
        ),
        (
            "Chapas pendente origem",
            f"""
            SELECT COUNT(*) c
            FROM tab_os_gravacao_pendente_chapa pc
            INNER JOIN tab_os_gravacao_externa ge ON ge.OrigemPendenteId = pc.GravacaoPendenteId
            WHERE {where} AND ge.OrigemPendenteId IS NOT NULL
            """,
        ),
        (
            "Sessões externa NÃO concluídas (não serão apagadas)",
            """
            SELECT COUNT(*) c FROM tab_os_gravacao_externa ge
            WHERE ge.Status IN ('pendente', 'iniciada')
            """,
        ),
    ]

    print("=== Contagens (alvo do purge) ===")
    for label, sql in checks:
        try:
            p = params if "WHERE ge.Status" in sql or "OrigemPendenteId" in sql else None
            if label.startswith("Sessões externa NÃO"):
                p = None
            print(f"  {label}: {_count(sql, p):,}")
        except Exception as exc:
            print(f"  {label}: ERRO {exc}")

    print()
    rows = db.execute_query(
        f"""
        SELECT ge.OsAno, ge.OsNro, ge.Id, ge.IniciadoEm
        {base}
        ORDER BY ge.IniciadoEm DESC, ge.Id DESC
        LIMIT 20
        """,
        params,
    )
    if rows:
        print("Amostra (até 20):")
        for row in rows:
            os_label = f"{int(row['OsNro']):05d}/{str(row['OsAno'])[-2:]}"
            print(f"  OS {os_label}  externa_id={row['Id']}  iniciado={row.get('IniciadoEm')}")
    else:
        print("Nenhuma sessão concluída encontrada com os filtros informados.")
    print()


def purge(ano: int | None, os_nro: int | None) -> None:
    where, params = _where_clause(ano, os_nro)

    def tx(cursor):
        steps = [
            (
                "mensagens externa",
                f"""
                DELETE m FROM tab_os_gravacao_externa_mensagem m
                INNER JOIN tab_os_gravacao_externa ge ON ge.Id = m.GravacaoExternaId
                WHERE {where}
                """,
            ),
            (
                "arquivos externa",
                f"""
                DELETE a FROM tab_os_gravacao_externa_arquivo a
                INNER JOIN tab_os_gravacao_externa ge ON ge.Id = a.GravacaoExternaId
                WHERE {where}
                """,
            ),
            (
                "arquivos pendente origem",
                f"""
                DELETE pa FROM tab_os_gravacao_pendente_arquivo pa
                INNER JOIN tab_os_gravacao_externa ge ON ge.OrigemPendenteId = pa.GravacaoPendenteId
                WHERE {where} AND ge.OrigemPendenteId IS NOT NULL
                """,
            ),
            (
                "chapas pendente origem",
                f"""
                DELETE pc FROM tab_os_gravacao_pendente_chapa pc
                INNER JOIN tab_os_gravacao_externa ge ON ge.OrigemPendenteId = pc.GravacaoPendenteId
                WHERE {where} AND ge.OrigemPendenteId IS NOT NULL
                """,
            ),
            (
                "sessões pendente origem",
                f"""
                DELETE gp FROM tab_os_gravacao_pendente gp
                INNER JOIN tab_os_gravacao_externa ge ON ge.OrigemPendenteId = gp.Id
                WHERE {where} AND ge.OrigemPendenteId IS NOT NULL
                """,
            ),
            (
                "sessões externa concluídas",
                f"DELETE FROM tab_os_gravacao_externa ge WHERE {where}",
            ),
        ]
        totals: dict[str, int] = {}
        for label, sql in steps:
            cursor.execute(sql, params)
            totals[label] = cursor.rowcount
        return totals

    totals = db.execute_transaction([tx])[0]
    print("=== Removido ===")
    for label, count in totals.items():
        print(f"  {label}: {count:,}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apaga histórico de gravações externas concluídas (MySQL).",
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
    parser.add_argument("--ano", type=int, default=None, help="Filtrar por OsAno.")
    parser.add_argument("--os", type=int, default=None, dest="os_nro", help="Filtrar por OsNro.")
    args = parser.parse_args()

    print_connection_info()
    print_counts(args.ano, args.os_nro)

    if not args.execute:
        print("Dry-run. Use --execute --yes para apagar.")
        return 0

    if not args.yes:
        answer = input("Confirma exclusão permanente no banco acima? [digite APAGAR]: ").strip()
        if answer != "APAGAR":
            print("Cancelado.")
            return 1

    purge(args.ano, args.os_nro)
    print("Concluído. Contagens após purge:")
    print_counts(args.ano, args.os_nro)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
