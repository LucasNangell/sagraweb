#!/usr/bin/env python3
"""Benchmark GET /api/os/search — mede cenários comuns antes/depois da otimização."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402
from services.os_search_service import execute_os_search  # noqa: E402


def _timed(label: str, fn: Callable[[], Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()
    result = fn()
    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    row_count = len(result.get("data") or []) if isinstance(result, dict) else None
    return {"label": label, "elapsed_ms": elapsed_ms, "rows": row_count}


def _explain(sql_hint: str) -> List[Dict[str, Any]]:
    try:
        rows = db.execute_query(f"EXPLAIN {sql_hint}")
        return list(rows or [])
    except Exception as exc:
        return [{"error": str(exc)}]


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark da busca de OSs.")
    parser.add_argument("--ano", type=int, default=None)
    parser.add_argument("--nr-os", type=int, default=None)
    parser.add_argument("--setor", type=str, default=None)
    parser.add_argument("--situacao", type=str, default=None)
    parser.add_argument("--explain", action="store_true")
    args = parser.parse_args()

    scenarios: List[tuple[str, dict]] = [
        ("abertura_inicial", {"include_finished": False, "limit": 20}),
        (
            "abertura_com_ano",
            {"include_finished": False, "limit": 20, "ano": args.ano},
        ),
        (
            "nr_os_exact",
            {
                "nr_os": args.nr_os,
                "ano": args.ano,
                "exact_os_lookup": True,
                "include_finished": True,
                "limit": 5,
            },
        ),
        (
            "filtro_setor",
            {
                "include_finished": False,
                "setor": [args.setor] if args.setor else ["SEFOC"],
                "limit": 20,
            },
        ),
        (
            "filtro_situacao",
            {
                "include_finished": False,
                "situacao": [args.situacao] if args.situacao else ["Em Execução"],
                "limit": 20,
            },
        ),
        ("pagina_2", {"include_finished": False, "page": 2, "limit": 20}),
        (
            "titulo_like",
            {"include_finished": False, "titulo": "relat", "limit": 20},
        ),
    ]

    results = []
    for label, kwargs in scenarios:
        if kwargs.get("nr_os") is None and label == "nr_os_exact":
            continue
        if kwargs.get("ano") is None and "ano" in kwargs and label == "abertura_com_ano":
            continue
        results.append(
            _timed(
                label,
                lambda kw=kwargs: execute_os_search(simple_pagination=True, **kw),
            )
        )

    report: Dict[str, Any] = {"benchmarks": results}
    if args.explain:
        report["explain_note"] = (
            "Execute EXPLAIN manualmente na SQL gerada por execute_os_search nos testes."
        )

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
