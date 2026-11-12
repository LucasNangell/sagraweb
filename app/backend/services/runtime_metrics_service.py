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


def _rss_bytes() -> int | None:
    """Memória residente (RSS) do processo — best-effort, sem derrubar métricas.

    psutil (dev) → GetProcessMemoryInfo via ctypes (Windows, zero-dependência) → None.
    O fallback ctypes evita depender do psutil estar no pacote de produção.
    """
    try:
        import psutil  # type: ignore

        return int(psutil.Process().memory_info().rss)
    except Exception:
        pass
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class _PMC(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            counters = _PMC()
            counters.cb = ctypes.sizeof(_PMC)
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            if ctypes.windll.psapi.GetProcessMemoryInfo(
                handle, ctypes.byref(counters), counters.cb
            ):
                return int(counters.WorkingSetSize)
        except Exception:
            pass
    return None


def _process_snapshot() -> dict[str, Any]:
    global _cpu_sample
    now_cpu, now_wall = time.process_time(), time.perf_counter()
    prev_cpu, prev_wall = _cpu_sample
    dt = now_wall - prev_wall
    cpu_pct = round(100.0 * (now_cpu - prev_cpu) / dt, 1) if dt > 0.05 else None
    _cpu_sample = (now_cpu, now_wall)
    rss = _rss_bytes()
    return {
        "pid": os.getpid(),
        "threads": threading.active_count(),
        "cpu_percent": cpu_pct,
        "rss_bytes": rss,
        "rss_mb": round(rss / (1024 * 1024), 1) if rss is not None else None,
    }


def _mdb_snapshot() -> dict[str, Any]:
    try:
        from routers.mdb_writer import get_mdb_sync_snapshot

        return get_mdb_sync_snapshot()
    except Exception as exc:
        logger.debug("runtime-metrics mdb: %s", exc)
        return {"error": "unavailable"}


# Limitador de threads do Starlette/anyio (concorrência de handlers sync + to_thread).
# É ligado ao event loop (RunVar), então guardamos a referência no startup para
# poder lê-la de qualquer thread (métricas rodam fora do loop).
_thread_limiter: Any = None


def register_thread_limiter(limiter: Any) -> None:
    global _thread_limiter
    _thread_limiter = limiter


def _threadpool_snapshot() -> dict[str, Any]:
    limiter = _thread_limiter
    if limiter is None:
        return {"configured": False}
    try:
        total = limiter.total_tokens
        borrowed = limiter.borrowed_tokens
        return {
            "configured": True,
            "total": total,
            "in_use": borrowed,
            "available": (total - borrowed) if isinstance(total, (int, float)) else None,
        }
    except Exception as exc:
        logger.debug("runtime-metrics threadpool: %s", exc)
        return {"error": "unavailable"}


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
        "threadpool": _threadpool_snapshot(),
        "mdb_sync": _mdb_snapshot(),
        "websocket": _websocket_snapshot(),
        "os_search": _fetch_all_snapshot(),
        "papelaria": _papelaria_snapshot(),
        "heavy_jobs": {
            "inprocess": inprocess_heavy_jobs(),
            **cpu_snapshot(),
        },
    }


# --- Logger periódico (Fase 0: detectar vazamento/exaustão antes da queda) ---

_metrics_logger = logging.getLogger("sagra.runtime_metrics")
_metrics_thread: threading.Thread | None = None
_metrics_thread_lock = threading.Lock()


def _metrics_log_interval() -> float:
    """Intervalo do log periódico (s). 0 (ou inválido) desliga."""
    try:
        return max(0.0, min(3600.0, float(os.getenv("SAGRA_RUNTIME_METRICS_LOG_SEC", "60"))))
    except (TypeError, ValueError):
        return 60.0


def _rss_warn_mb() -> float:
    try:
        return max(0.0, float(os.getenv("SAGRA_RUNTIME_METRICS_RSS_WARN_MB", "1500")))
    except (TypeError, ValueError):
        return 1500.0


def _log_metrics_once() -> None:
    """Uma linha compacta; WARNING se algum limiar de alerta precoce for atingido."""
    m = collect_runtime_metrics()
    proc = m.get("process") or {}
    pool = m.get("mysql_pool") or {}
    tp = m.get("threadpool") or {}
    mdb = m.get("mdb_sync") or {}

    in_use = pool.get("in_use")
    pool_max = pool.get("max")
    tp_in_use = tp.get("in_use")
    tp_total = tp.get("total")
    rss_mb = proc.get("rss_mb")
    threads = proc.get("threads")
    q_size = mdb.get("queue_size")
    q_max = mdb.get("queue_max")
    circuit_open = bool(mdb.get("circuit_open"))
    overflow_dropped = mdb.get("overflow_dropped_total")

    alerts: list[str] = []
    if isinstance(in_use, int) and isinstance(pool_max, int) and pool_max > 0:
        if in_use >= max(1, int(pool_max * 0.8)):
            alerts.append(f"pool {in_use}/{pool_max}")
    if isinstance(tp_in_use, int) and isinstance(tp_total, int) and tp_total > 0:
        if tp_in_use >= max(1, int(tp_total * 0.8)):
            alerts.append(f"threadpool {tp_in_use}/{tp_total}")
    if isinstance(rss_mb, (int, float)) and rss_mb >= _rss_warn_mb():
        alerts.append(f"rss {rss_mb}MB")
    if circuit_open:
        alerts.append(f"mdb_circuit {mdb.get('circuit_seconds_left')}s")
    if isinstance(q_size, int) and isinstance(q_max, int) and q_max > 0:
        if q_size >= max(1, int(q_max * 0.8)):
            alerts.append(f"mdb_queue {q_size}/{q_max}")
    if isinstance(overflow_dropped, int) and overflow_dropped > 0:
        alerts.append(f"mdb_dropped {overflow_dropped}")

    line = (
        "runtime pid=%s rss_mb=%s threads=%s cpu=%s pool=%s/%s threadpool=%s/%s "
        "mdb_queue=%s/%s mdb_circuit=%s mdb_dropped=%s ws=%s os_search_1min=%s"
    )
    args = (
        proc.get("pid"),
        rss_mb,
        threads,
        proc.get("cpu_percent"),
        in_use,
        pool_max,
        tp_in_use,
        tp_total,
        q_size,
        q_max,
        circuit_open,
        overflow_dropped,
        (m.get("websocket") or {}).get("connections"),
        (m.get("os_search") or {}).get("last_minute"),
    )
    if alerts:
        _metrics_logger.warning(line + " ALERTA=[%s]", *args, "; ".join(alerts))
    else:
        _metrics_logger.info(line, *args)


def _metrics_loop(interval: float) -> None:
    while True:
        time.sleep(interval)
        try:
            _log_metrics_once()
        except Exception as exc:  # pragma: no cover - nunca derruba o processo
            _metrics_logger.debug("runtime-metrics loop: %s", exc)


def start_runtime_metrics_logging() -> bool:
    """Inicia o logger periódico de métricas (daemon). Idempotente."""
    global _metrics_thread
    interval = _metrics_log_interval()
    if interval <= 0:
        _metrics_logger.info("Logger de runtime-metrics desligado (SAGRA_RUNTIME_METRICS_LOG_SEC=0)")
        return False
    with _metrics_thread_lock:
        if _metrics_thread is not None and _metrics_thread.is_alive():
            return True
        _metrics_thread = threading.Thread(
            target=_metrics_loop,
            args=(interval,),
            name="sagra-runtime-metrics",
            daemon=True,
        )
        _metrics_thread.start()
    _metrics_logger.info("Logger de runtime-metrics iniciado (intervalo=%.0fs)", interval)
    return True
