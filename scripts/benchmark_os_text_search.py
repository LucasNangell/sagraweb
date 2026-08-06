#!/usr/bin/env python3
"""Benchmark filtros textuais — antes (LIKE) vs depois (FULLTEXT)."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List

BACKEND = Path(__file__).resolve().parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND))

from database import db  # noqa: E402
from os_text_search_indexes_schema import fulltext_text_search_indexes_ready  # noqa: E402
from services.os_search_service import execute_os_search  # noqa: E402


def _timed(label: str, fn: Callable[[], Any], runs: int = 5) -> Dict[str, Any]:
    times: List[float] = []
    rows = None
    for _ in range(runs):
        t0 = time.perf_counter()
        result = fn()
        times.append((time.perf_counter() - t0) * 1000)
        rows = len(result.get("data") or [])
    times.sort()
    p50 = times[len(times) // 2]
    return {
        "label": label,
        "runs": runs,
        "p50_ms": round(p50, 2),
        "min_ms": round(min(times), 2),
        "max_ms": round(max(times), 2),
        "rows": rows,
    }


def _explain_fragment(sql_fragment: str) -> List[Dict[str, Any]]:
    try:
        return list(
            db.execute_query(
                f"EXPLAIN SELECT 1 FROM tabProtocolos p WHERE 1=1 {sql_fragment} LIMIT 1"
            )
            or []
        )
    except Exception as exc:
        return [{"error": str(exc)}]


def main() -> int:
    scenarios = [
        ("titulo_relat", {"titulo": "relat", "include_finished": False}),
        ("titulo_cartao", {"titulo": "cartao", "include_finished": False}),
        ("produto_folder", {"produto": "folder", "include_finished": False}),
        ("produto_impresso", {"produto": "impresso", "include_finished": False}),
        ("solicitante_silva", {"solicitante": "Silva", "include_finished": False}),
        ("titulo_setor", {"titulo": "relat", "setor": ["SEFOC"], "include_finished": False}),
        ("produto_situacao", {"produto": "folder", "situacao": ["Em Execução"], "include_finished": False}),
        ("solicitante_prioridade", {
            "solicitante": "Gab",
            "prioridade": ["Normal"],
            "include_finished": False,
        }),
    ]

    mode = "fulltext" if fulltext_text_search_indexes_ready() else "no_fulltext"
    results = {"mode": mode, "fulltext_ready": fulltext_text_search_indexes_ready(), "benchmarks": []}

    for label, kwargs in scenarios:
        results["benchmarks"].append(
            _timed(
                label,
                lambda kw=kwargs: execute_os_search(simple_pagination=True, limit=20, **kw),
            )
        )

    # Modo LIKE lento (somente referência — não usar em produção)
    if os.environ.get("BENCHMARK_INCLUDE_SLOW_LIKE") == "1":
        os.environ["OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK"] = "1"
        from os_text_search_indexes_schema import invalidate_fulltext_ready_cache

        invalidate_fulltext_ready_cache()
        with __import__("unittest.mock").mock.patch(
            "services.os_search_service.fulltext_text_search_indexes_ready",
            return_value=False,
        ):
            slow = _timed(
                "titulo_relat_like_fallback",
                lambda: execute_os_search(
                    titulo="relat", simple_pagination=True, limit=20, include_finished=False
                ),
                runs=1,
            )
        results["slow_like_reference"] = slow
        os.environ.pop("OS_SEARCH_ALLOW_SLOW_TEXT_FALLBACK", None)

    print(json.dumps(results, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
