"""Diagnóstico de setores por etapa da linha do tempo."""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import db  # noqa: E402


def main() -> None:
    rows = db.execute_query(
        """
        SELECT SetorLink, COUNT(*) AS c FROM tabAndamento
        WHERE SituacaoLink = 'Saída p/'
        GROUP BY SetorLink ORDER BY c DESC LIMIT 30
        """
    )
    print("=== Saída p/ setores ===")
    for r in rows:
        print(r)

    rows2 = db.execute_query(
        """
        SELECT Observaçao FROM tabAndamento
        WHERE SituacaoLink = 'Em Execução' AND SetorLink = 'SEFOC'
        LIMIT 30
        """
    )
    print("\n=== Em Execução SEFOC obs ===")
    for r in rows2:
        print(str(r.get("Observaçao") or "")[:120])

    rows3 = db.execute_query(
        """
        SELECT SetorLink, Observaçao FROM tabAndamento
        WHERE SituacaoLink = 'Pendência Usuário'
        LIMIT 25
        """
    )
    print("\n=== Pendência Usuário ===")
    for r in rows3:
        print(r.get("SetorLink"), "|", str(r.get("Observaçao") or "")[:100])

    # OS with skip example - find OS that went SIELT -> SEDIR directly
    rows4 = db.execute_query(
        """
        SELECT DISTINCT a.NroProtocoloLink, a.AnoProtocoloLink
        FROM tabAndamento a
        WHERE a.SetorLink = 'SEDIR' AND a.SituacaoLink IN ('Saída p/', 'Recebido', 'Em Execução')
        LIMIT 5
        """
    )
    print("\n=== OS com SEDIR ===")
    for r in rows4:
        nr, ano = int(r["NroProtocoloLink"]), int(r["AnoProtocoloLink"])
        steps = db.execute_query(
            """
            SELECT CodStatus, SituacaoLink, SetorLink, Observaçao
            FROM tabAndamento
            WHERE NroProtocoloLink=%s AND AnoProtocoloLink=%s
            ORDER BY CodStatus
            """,
            (nr, ano),
        )
        print(f"\nOS {nr}/{ano}:")
        for s in steps:
            obs = str(s.get("Observaçao") or "")[:60]
            print(f"  {s['SituacaoLink']} | {s['SetorLink']} | {obs}")


if __name__ == "__main__":
    main()
