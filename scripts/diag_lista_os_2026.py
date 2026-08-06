#!/usr/bin/env python3
"""Diagnóstico comparativo: tabProtocolos vs materializada vs andamento (ano 2026)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402
from services.os_search_service import execute_os_search  # noqa: E402


def main() -> int:
    ano = 2026
    print("=== 1. MAX NroProtocolo tabProtocolos 2026 ===")
    max_row = db.execute_query(
        "SELECT MAX(NroProtocolo) AS max_os FROM tabProtocolos WHERE AnoProtocolo = %s",
        (ano,),
    )
    print(max_row)

    print("\n=== 2. Top 15 tabProtocolos 2026 ===")
    protos = db.execute_query(
        """
        SELECT NroProtocolo, AnoProtocolo, DataEntrada, NomeUsuario
        FROM tabProtocolos
        WHERE AnoProtocolo = %s
        ORDER BY NroProtocolo DESC
        LIMIT 15
        """,
        (ano,),
    )
    for r in protos or []:
        print(r)

    print("\n=== 3. Top 15 materializada 2026 ===")
    mat = db.execute_query(
        """
        SELECT nro_protocolo, ano_protocolo, situacao, setor, data, cod_status, atualizado_em
        FROM tab_os_ultimo_andamento_operacional
        WHERE ano_protocolo = %s
        ORDER BY nro_protocolo DESC
        LIMIT 15
        """,
        (ano,),
    )
    for r in mat or []:
        print(r)

    print("\n=== 4. tabProtocolos sem materializada (top 30) ===")
    gap = db.execute_query(
        """
        SELECT p.NroProtocolo, p.AnoProtocolo
        FROM tabProtocolos p
        LEFT JOIN tab_os_ultimo_andamento_operacional m
          ON m.nro_protocolo = p.NroProtocolo AND m.ano_protocolo = p.AnoProtocolo
        WHERE p.AnoProtocolo = %s AND m.nro_protocolo IS NULL
        ORDER BY p.NroProtocolo DESC
        LIMIT 30
        """,
        (ano,),
    )
    print(f"count shown: {len(gap or [])}")
    for r in gap or []:
        print(r)

    print("\n=== 5. OS 5954-5962 comparativo ===")
    for nro in range(5954, 5963):
        p = db.execute_query(
            "SELECT 1 AS ok FROM tabProtocolos WHERE NroProtocolo=%s AND AnoProtocolo=%s",
            (nro, ano),
        )
        live = db.execute_query(
            """
            SELECT SituacaoLink, SetorLink, Data, UltimoStatus, CodStatus
            FROM tabAndamento
            WHERE NroProtocoloLink=%s AND AnoProtocoloLink=%s
            ORDER BY UltimoStatus DESC, Data DESC, CodStatus DESC
            LIMIT 1
            """,
            (nro, ano),
        )
        m = db.execute_query(
            """
            SELECT situacao, setor, data, cod_status, atualizado_em
            FROM tab_os_ultimo_andamento_operacional
            WHERE nro_protocolo=%s AND ano_protocolo=%s
            """,
            (nro, ano),
        )
        search = execute_os_search(
            nr_os=nro,
            ano=ano,
            include_finished=True,
            exact_os_lookup=True,
            simple_pagination=True,
            limit=5,
        )
        hit = search.get("data") or []
        print(
            json.dumps(
                {
                    "nr_os": nro,
                    "in_protocolos": bool(p),
                    "live": live[0] if live else None,
                    "materialized": m[0] if m else None,
                    "search_situacao": hit[0].get("situacao") if hit else None,
                    "search_found": bool(hit),
                },
                default=str,
            )
        )

    print("\n=== 6. /os/search nr_os desc include_finished ===")
    res = execute_os_search(
        ano=ano,
        include_finished=True,
        include_os=True,
        include_sp=True,
        page=1,
        limit=20,
        sort_by="nr_os",
        sort_dir="desc",
        simple_pagination=True,
    )
    print([{"nr_os": r.get("nr_os"), "situacao": r.get("situacao")} for r in res.get("data", [])])

    print("\n=== 7. /os/search default (include_finished=false) ===")
    res2 = execute_os_search(
        page=1,
        limit=20,
        simple_pagination=True,
    )
    max_nr = max((r.get("nr_os") or 0) for r in res2.get("data", [])) if res2.get("data") else None
    print(f"max nr_os in default page: {max_nr}")
    print([{"nr_os": r.get("nr_os"), "ano": r.get("ano"), "situacao": r.get("situacao")} for r in res2.get("data", [])])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
