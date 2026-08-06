#!/usr/bin/env python3
"""Compara fila PCP SEFOC (painel) com GET /os/search (página inicial)."""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402
from services.os_search_service import execute_os_search  # noqa: E402

PCP_SQL = """
SELECT p.NroProtocolo AS nr_os, p.AnoProtocolo AS ano,
       a.SituacaoLink AS situacao, a.SetorLink AS setor
FROM tabProtocolos AS p
LEFT JOIN tabAndamento AS a
    ON a.CodStatus = (
        SELECT a2.CodStatus
        FROM tabAndamento AS a2
        WHERE a2.NroProtocoloLink = p.NroProtocolo
          AND a2.AnoProtocoloLink = p.AnoProtocolo
          AND a2.UltimoStatus = 1
        ORDER BY a2.`Data` DESC, a2.CodStatus DESC
        LIMIT 1
    )
WHERE a.CodStatus IS NOT NULL
  AND a.SetorLink = %s
  AND a.SituacaoLink NOT IN ('Entregue', 'Cancelada', 'Cancelado')
ORDER BY p.AnoProtocolo DESC, p.NroProtocolo DESC
"""


def main() -> int:
    pcp_rows = db.execute_query(PCP_SQL, ("SEFOC",))
    print("=== PCP SEFOC (tabAndamento UltimoStatus=1) ===")
    print(f"Total: {len(pcp_rows)}")

    cnt = Counter(r.get("situacao") for r in pcp_rows)
    print("Situacoes PCP:")
    for k, v in sorted(cnt.items(), key=lambda x: -x[1]):
        print(f"  {k}: {v}")

    gap = []
    stale = []
    for r in pcp_rows:
        mat = db.execute_query(
            "SELECT situacao, setor FROM tab_os_ultimo_andamento_operacional "
            "WHERE nro_protocolo=%s AND ano_protocolo=%s",
            (r["nr_os"], r["ano"]),
        )
        if not mat:
            gap.append(r)
        elif mat[0].get("situacao") != r.get("situacao") or mat[0].get("setor") != r.get("setor"):
            stale.append((r, mat[0]))

    print(f"\nGap materializada (PCP sem linha mat): {len(gap)}")
    for r in gap[:15]:
        print(f"  {r['nr_os']}/{r['ano']} sit={r.get('situacao')}")
    print(f"Stale materializada (sit/setor diferente): {len(stale)}")
    for r, m in stale[:15]:
        print(
            f"  {r['nr_os']}/{r['ano']} PCP={r.get('situacao')}/{r.get('setor')} "
            f"MAT={m.get('situacao')}/{m.get('setor')}"
        )

    pcp_keys = {(r["nr_os"], r["ano"]) for r in pcp_rows}
    scenarios = [
        (
            "home default (ano>=2025, setor SEFOC)",
            dict(
                ano=2025,
                ano_mode="from",
                include_finished=False,
                setor=["SEFOC"],
                limit=100,
                simple_pagination=True,
            ),
        ),
        (
            "setor SEFOC sem ano",
            dict(include_finished=False, setor=["SEFOC"], limit=100, simple_pagination=True),
        ),
        (
            "sit Saída p/+Recebido, setor SEFOC, sem ano",
            dict(
                include_finished=False,
                setor=["SEFOC"],
                situacao=["Saída p/", "Recebido"],
                limit=100,
                simple_pagination=True,
            ),
        ),
        (
            "sit Saída p/+Recebido, setor SEFOC, ano>=2025",
            dict(
                ano=2025,
                ano_mode="from",
                include_finished=False,
                setor=["SEFOC"],
                situacao=["Saída p/", "Recebido"],
                limit=100,
                simple_pagination=True,
            ),
        ),
        (
            "sem filtros (só exclui finalizadas)",
            dict(include_finished=False, limit=100, simple_pagination=True),
        ),
    ]

    print("\n=== execute_os_search (lista home) ===")
    for label, kwargs in scenarios:
        res = execute_os_search(**kwargs)
        rows = res["data"]
        keys = {(r["nr_os"], r["ano"]) for r in rows}
        missing = [r for r in pcp_rows if (r["nr_os"], r["ano"]) not in keys]
        extra = keys - pcp_keys
        print(f"\n{label}")
        print(f"  retornou: {len(rows)} | faltando do PCP: {len(missing)}/{len(pcp_rows)}")
        for r in missing:
            sit = r.get("situacao")
            if sit in ("Saída p/", "Recebido") or "Saída" in (sit or ""):
                print(f"    FALTA {r['nr_os']}/{r['ano']} sit={sit} ano={r['ano']}")
        if extra:
            print(f"  extras (na busca, não no PCP): {len(extra)}")

    print("\n=== OSs do painel sem materialização (detalhe) ===")
    from services.os_ultimo_andamento_service import fetch_operacional_row  # noqa: E402

    for r in gap:
        nr, ano = r["nr_os"], r["ano"]
        print(f"\n{nr}/{ano} PCP sit={r.get('situacao')} setor={r.get('setor')}")
        andamentos = db.execute_query(
            """
            SELECT CodStatus, SituacaoLink, SetorLink, UltimoStatus, `Data`
            FROM tabAndamento
            WHERE NroProtocoloLink=%s AND AnoProtocoloLink=%s
            ORDER BY UltimoStatus DESC, `Data` DESC, CodStatus DESC
            LIMIT 5
            """,
            (nr, ano),
        )
        for a in andamentos or []:
            print(
                f"  tabAndamento: sit={a.get('SituacaoLink')} setor={a.get('SetorLink')} "
                f"ult={a.get('UltimoStatus')} cod={a.get('CodStatus')}"
            )
        op = fetch_operacional_row(nr, ano)
        print(f"  fetch_operacional_row (regra materialização): {op}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
