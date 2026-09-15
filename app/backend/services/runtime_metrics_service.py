"""Snapshot operacional para baseline de carga (home, pool, WS, fila, CPU)."""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from typing import Any

logger = logging.getLogger(__name__)

_FETCH_ALL_WINDOW_SEC = 60.0
_fetch_all_events: deque[dict[str, Any]] = deque(maxlen=200)
_fetch_all_lock = threading.Lock()
_cpu_sample = (time.process_time(), time.perf_counter())


def record_os_search_fetch_all(*, rows: int, elapsed_ms: float, bytes_out: int | None = None) -> None:
    event = {
        "ts": time.time(),
        "rows": int(rows),
        "elapsed_ms": round(float(elapsed_ms), 1),
        "bytes": int(bytes_out) if bytes_out is not None else None,
    }
    with _fetch_all_lock:
        _fetch_all_events.append(event)
    logger.info(
        "os_search fetch_all rows=%s elapsed_ms=%.0f bytes=%s",
        event["rows"],
        event["elapsed_ms"],
        event["bytes"],
    )


def _fetch_all_snapshot() -> dict[str, Any]:
    now = time.time()
    with _fetch_all_lock:
        recent = [e for e in _fetch_all_events if now - e["ts"] <= _FETCH_ALL_WINDOW_SEC]
        last = _fetch_all_events[-1] if _fetch_all_events else None
    return {
        "last_minute": len(recent),
        "last_rows": last["rows"] if last else 0,
        "last_elapsed_ms": last["elapsed_ms"] if last else 0,
        "last_bytes": last["bytes"] if last else None,
    }


def _process_snapshot() -> dict[str, Any]:
    global _cpu_sample
    now_cpu, now_wall = time.process_time(), time.perf_counter()
    prev_cpu, prev_wall = _cpu_sample
    dt = now_wall - prev_wall
    cpu_pct = round(100.0 * (now_cpu - prev_cpu) / dt, 1) if dt > 0.05 else None
    _cpu_sample = (now_cpu, now_wall)
    return {
        "pid": os.getpid(),
        "threads": threading.active_count(),
        "cpu_percent": cpu_pct,
    }


def _mysql_pool_snapshot() -> dict[str, Any]:
    try:
        from database import db

        return db.pool.snapshot()
    except Exception as exc:
        logger.debug("runtime-metrics pool: %s", exc)
        return {"error": "unavailable"}


def _websocket_snapshot() -> dict[str, Any]:
    try:
        from routers.realtime import manager

        return manager.stats()
    except Exception as exc:
        logger.debug("runtime-metrics ws: %s", exc)
        return {"error": "unavailable"}


def _papelaria_snapshot() -> dict[str, Any]:
    try:
        from services.papelaria_jobs_service import get_admin_worker_queue_snapshot

        snap = get_admin_worker_queue_snapshot(fila_limit=1, recentes_limit=1)
        totais = snap.get("totais") or {}
        return {
            "pending": int(totais.get("pending") or 0),
            "processing": int(totais.get("processing") or 0),
        }
    except Exception as exc:
        logger.debug("runtime-metrics papelaria: %s", exc)
        return {"error": "unavailable"}


def collect_runtime_metrics() -> dict[str, Any]:
    from resilience.cpu_jobs import snapshot as cpu_snapshot
    from resilience.heavy_jobs import inprocess_heavy_jobs

    return {
        "process": _process_snapshot(),
        "mysql_pool": _mysql_pool_snapshot(),
        "websocket": _websocket_snapshot(),
        "os_search": _fetch_all_snapshot(),
        "papelaria": _papelaria_snapshot(),
        "heavy_jobs": {
            "inprocess": inprocess_heavy_jobs(),
            **cpu_snapshot(),
        },
    }
