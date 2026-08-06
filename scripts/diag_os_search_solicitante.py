#!/usr/bin/env python3
"""Diagnóstico rápido: busca por solicitante (performance + colunas vazias)."""
from __future__ import annotations

import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402
from services.os_search_service import execute_os_search  # noqa: E402


def main() -> int:
    print("=== Índices tabProtocolos (solicitante/search) ===")
    idx = db.execute_query(
        "SHOW INDEX FROM tabProtocolos WHERE Key_name LIKE '%solicit%' "
        "OR Key_name LIKE '%search%' OR Key_name LIKE '%protocol%'"
    )
    for r in idx or []:
        print(f"  {r['Key_name']}: {r['Column_name']}")

    print("\n=== Contagens ===")
    for label, sql in [
        ("tabAndamento", "SELECT COUNT(*) c FROM tabAndamento"),
        ("tabProtocolos", "SELECT COUNT(*) c FROM tabProtocolos"),
        ("materialized", "SELECT COUNT(*) c FROM tab_os_ultimo_andamento_operacional"),
    ]:
        print(f"  {label}: {db.execute_query(sql)[0]['c']}")

    q_gap = """
        SELECT COUNT(*) AS c FROM tabProtocolos p
        LEFT JOIN tab_os_ultimo_andamento_operacional a
          ON a.nro_protocolo = p.NroProtocolo AND a.ano_protocolo = p.AnoProtocolo
        WHERE p.NomeUsuario LIKE %s
          AND (a.situacao IS NULL OR a.situacao NOT IN ('Entregue','Cancelada','Cancelado'))
          AND a.nro_protocolo IS NULL
    """
    for term in ["%Dep%", "%Gab%", "%Silva%"]:
        c = db.execute_query(q_gap, (term,))[0]["c"]
        print(f"  matches {term} sem linha materializada (filtro ativo): {c}")

    print("\n=== Benchmark execute_os_search ===")
    for term in ["Dep", "Gab", "Silva", None]:
        label = term or "default"
        t0 = time.perf_counter()
        kwargs = {"limit": 20, "simple_pagination": True}
        if term:
            kwargs["solicitante"] = term
        result = execute_os_search(**kwargs)
        dt = (time.perf_counter() - t0) * 1000
        rows = result["data"]
        blank_sit = sum(1 for x in rows if not x.get("situacao"))
        blank_prod = sum(1 for x in rows if not x.get("produto"))
        blank_tit = sum(1 for x in rows if not x.get("titulo"))
        print(
            f"  {label:8s}: {dt:7.0f}ms rows={len(rows)} "
            f"blank(sit={blank_sit}, prod={blank_prod}, tit={blank_tit})"
        )
        if rows:
            s = rows[0]
            print(
                "    1st:",
                {
                    "nr_os": s.get("nr_os"),
                    "ano": s.get("ano"),
                    "solicitante": (s.get("solicitante") or "")[:30],
                    "situacao": s.get("situacao"),
                    "setor": s.get("setor"),
                    "produto": s.get("produto"),
                    "titulo": (s.get("titulo") or "")[:30],
                },
            )

    print("\n=== EXPLAIN solicitante Dep (primeiras linhas) ===")
    explain = db.execute_query(
        """
        EXPLAIN
        SELECT p.NroProtocolo, p.AnoProtocolo, p.NomeUsuario, a.situacao, a.setor
        FROM tabProtocolos p
        LEFT JOIN tab_os_ultimo_andamento_operacional a
          ON a.nro_protocolo = p.NroProtocolo AND a.ano_protocolo = p.AnoProtocolo
        WHERE p.NomeUsuario LIKE %(s)s
          AND (a.situacao IS NULL OR a.situacao NOT IN ('Entregue','Cancelada','Cancelado'))
        ORDER BY COALESCE(p.EntregData, p.DataEntrada) ASC
        LIMIT 20
        """,
        {"s": "%Dep%"},
    )
    for row in explain or []:
        print(
            f"  {row.get('table')}: type={row.get('type')} rows={row.get('rows')} "
            f"key={row.get('key')} Extra={row.get('Extra')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
