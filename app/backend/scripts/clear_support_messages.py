#!/usr/bin/env python3
"""Remove todos os tickets/mensagens do chat de suporte (somente tabSupport* + notificações relacionadas)."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def main() -> int:
    from database import db

    tickets = db.execute_query("SELECT COUNT(*) AS n FROM tabSupportMessages")
    threads = db.execute_query("SELECT COUNT(*) AS n FROM tabSupportThreadMessages")
    n_tickets = int(tickets[0]["n"]) if tickets else 0
    n_threads = int(threads[0]["n"]) if threads else 0

    print(f"Antes: {n_tickets} ticket(s), {n_threads} mensagem(ns) na thread")

    db.execute_query("DELETE FROM tabSupportThreadMessages")
    db.execute_query("DELETE FROM tabSupportMessages")

    n_notif = 0
    try:
        with db.cursor() as cur:
            cur.execute(
                """
                DELETE FROM tabNotificacoes
                WHERE DetalhesJson LIKE '%support_incoming%'
                   OR DetalhesJson LIKE '%support_reply%'
                   OR DetalhesJson LIKE '%cliente_support%'
                """
            )
            n_notif = cur.rowcount
    except Exception as exc:
        print(f"Aviso: limpeza de notificações falhou: {exc}")

    try:
        db.execute_query("ALTER TABLE tabSupportMessages AUTO_INCREMENT = 1")
        db.execute_query("ALTER TABLE tabSupportThreadMessages AUTO_INCREMENT = 1")
    except Exception as exc:
        print(f"Aviso: não foi possível resetar AUTO_INCREMENT: {exc}")

    after_t = db.execute_query("SELECT COUNT(*) AS n FROM tabSupportMessages")
    after_th = db.execute_query("SELECT COUNT(*) AS n FROM tabSupportThreadMessages")
    print(f"Depois: {int(after_t[0]['n'])} ticket(s), {int(after_th[0]['n'])} thread msg(s)")
    print(f"Notificações de suporte removidas: {n_notif}")
    print("OK — chat de suporte zerado para novos testes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
