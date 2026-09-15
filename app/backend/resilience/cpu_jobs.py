"""Semáforo global de jobs CPU na API (pré-análise, render, ZIP, imagens)."""
from __future__ import annotations

import logging
import os
import threading
from contextlib import contextmanager

from fastapi import HTTPException

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_in_use = 0


def _max_slots() -> int:
    try:
        return max(1, min(4, int(os.getenv("SAGRA_CPU_JOB_SLOTS", "2"))))
    except (TypeError, ValueError):
        return 2


def snapshot() -> dict[str, int]:
    with _lock:
        return {"in_use": _in_use, "max": _max_slots()}


@contextmanager
def cpu_job_slot(
    *,
    wait: bool = True,
    timeout_sec: float = 45.0,
    label: str = "cpu",
    http_error: bool = True,
):
    """
    Reserva um slot de CPU. wait=False falha imediato.
    HTTP deve usar wait=True com timeout; workers de fila podem esperar mais.
    """
    global _in_use
    max_slots = _max_slots()
    acquired = False
    deadline = timeout_sec if wait else 0.0
    import time

    start = time.monotonic()
    while True:
        with _lock:
            if _in_use < max_slots:
                _in_use += 1
                acquired = True
                break
        if not wait or (time.monotonic() - start) >= deadline:
            break
        time.sleep(0.15)

    if not acquired:
        logger.warning(
            "CPU job recusado (%s): slots ocupados (max=%s)",
            label,
            max_slots,
        )
        if http_error:
            raise HTTPException(
                status_code=503,
                detail="Servidor ocupado com processamento pesado. Tente novamente em instantes.",
                headers={"Retry-After": "8"},
            )
        raise TimeoutError(f"CPU slot timeout ({label})")
    try:
        yield
    finally:
        with _lock:
            _in_use = max(0, _in_use - 1)
