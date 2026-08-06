#!/usr/bin/env python3
"""Compara painel PCP (tabAndamento) com lista home (/api/os/search)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402
from services.andamento_table import get_andamento_table  # noqa: E402
from services.os_materialized_reconcile_service import (  # noqa: E402
    find_materialized_gaps,
    reconcile_gaps,
)
from services.os_search_service import execute_os_search  # noqa: E402
from services.os_ultimo_andamento_service import TABLE  # noqa: E402

def _pcp_sql() -> str:
    at = get_andamento_table()
    return f"""
SELECT p.NroProtocolo AS nr_os, p.AnoProtocolo AS ano,
       a.SituacaoLink AS situacao, a.SetorLink AS setor
FROM tabProtocolos AS p
LEFT JOIN {at} AS a
    ON a.CodStatus = (
        SELECT a2.CodStatus
        FROM {at} AS a2
        WHERE a2.NroProtocoloLink = p.NroProtocolo
          AND a2.AnoProtocoloLink = p.AnoProtocolo
          AND a2.UltimoStatus = 1
        ORDER BY a2.`Data` DESC, a2.CodStatus DESC
        LIMIT 1
    )
WHERE a.CodStatus IS NOT NULL
  AND a.SetorLink = %s
  AND a.SituacaoLink NOT IN ('Entregue', 'Cancelada', 'Cancelado')
"""


def _parse_situacoes(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--setor", default="SEFOC")
    parser.add_argument("--ano-from", type=int, default=None)
    parser.add_argument("--situacoes", default=None, help='Ex.: "Saída p/,Recebido"')
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--fix", action="store_true", help="Reconcilia gaps encontrados")
    args = parser.parse_args()

    setor = args.setor.strip()
    situacoes = _parse_situacoes(args.situacoes)
    pcp_rows = db.execute_query(_pcp_sql(), (setor,))

    search_kwargs: dict = {
        "include_finished": False,
        "setor": [setor],
        "limit": args.limit,
        "simple_pagination": True,
    }
    if args.ano_from is not None:
        search_kwargs["ano"] = args.ano_from
        search_kwargs["ano_mode"] = "from"
    if situacoes:
        search_kwargs["situacao"] = situacoes

    home = execute_os_search(**search_kwargs)
    home_keys = {(r["nr_os"], r["ano"]) for r in home["data"]}

    missing = []
    for r in pcp_rows:
        key = (r["nr_os"], r["ano"])
        if situacoes and (r.get("situacao") or "") not in situacoes:
            continue
        if args.ano_from is not None and int(r["ano"]) < args.ano_from:
            continue
        if key not in home_keys:
            mat = db.execute_query(
                f"SELECT situacao, setor FROM {TABLE} WHERE nro_protocolo=%s AND ano_protocolo=%s",
                (r["nr_os"], r["ano"]),
            )
            missing.append(
                {
                    "nr_os": r["nr_os"],
                    "ano": r["ano"],
                    "pcp_situacao": r.get("situacao"),
                    "pcp_setor": r.get("setor"),
                    "materialized": mat[0] if mat else None,
                    "action": "reconcile" if not mat else "refresh_or_fallback",
                }
            )

    report = {
        "setor": setor,
        "pcp_total": len(pcp_rows),
        "home_returned": len(home["data"]),
        "missing_in_home": len(missing),
        "missing": missing[:50],
        "filters": search_kwargs,
    }

    if args.fix and missing:
        gaps = find_materialized_gaps(
            max_rows=len(missing),
            setor=setor,
        )
        pairs = {(g["nro"], g["ano"]) for g in gaps}
        to_fix = [g for g in gaps if (g["nro"], g["ano"]) in {(m["nr_os"], m["ano"]) for m in missing}]
        if not to_fix:
            to_fix = [
                {
                    "nro": m["nr_os"],
                    "ano": m["ano"],
                    "situacao": m["pcp_situacao"],
                    "setor": m["pcp_setor"],
                    "gap_kind": "missing",
                }
                for m in missing
                if (m["nr_os"], m["ano"]) in pairs or m["materialized"] is None
            ]
        report["fix_result"] = reconcile_gaps(to_fix, source="diag_home_vs_panel")

    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    return 0 if not missing else 2


if __name__ == "__main__":
    raise SystemExit(main())
