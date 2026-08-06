"""Agendador em background da reconciliação incremental da materializada."""
from __future__ import annotations

import asyncio
import logging
import threading

from services.os_materialized_reconcile_service import reconcile_config, run_reconcile_cycle

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None
_started = False
_lock = threading.Lock()


async def _reconcile_loop() -> None:
    cfg = reconcile_config()
    interval = cfg["interval_seconds"]
    logger.info(
        "[OS MATERIALIZED RECONCILE] scheduler started interval=%ss enabled=%s",
        interval,
        cfg["enabled"],
    )
    while True:
        try:
            if cfg["enabled"]:
                await asyncio.to_thread(run_reconcile_cycle)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("[OS MATERIALIZED RECONCILE] cycle error: %s", exc, exc_info=True)
        await asyncio.sleep(interval)


def start_materialized_reconcile_scheduler() -> None:
    global _task, _started
    with _lock:
        if _started:
            return
        cfg = reconcile_config()
        if not cfg["enabled"]:
            logger.info("[OS MATERIALIZED RECONCILE] scheduler disabled")
            _started = True
            return

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning(
                "[OS MATERIALIZED RECONCILE] sem event loop — scheduler não iniciado"
            )
            return

        _task = loop.create_task(_reconcile_loop())
        _started = True


def stop_materialized_reconcile_scheduler() -> None:
    global _task, _started
    with _lock:
        if _task and not _task.done():
            _task.cancel()
        _task = None
        _started = False
