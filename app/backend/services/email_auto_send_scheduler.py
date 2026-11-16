"""Agendador que monitora MySQL por Encam. de Docum. para envio automático."""
from __future__ import annotations

import asyncio
import logging
import threading

from services.email_auto_send_service import run_auto_send_mysql_monitor_cycle
from services.email_template_service import get_auto_send_settings

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL_SEC = 15

_task: asyncio.Task | None = None
_started = False
_lock = threading.Lock()


def _interval_sec() -> int:
    return _DEFAULT_INTERVAL_SEC


async def _auto_send_monitor_loop() -> None:
    interval = _interval_sec()
    logger.info(
        "[EMAIL AUTO SEND MONITOR] scheduler started interval=%ss",
        interval,
    )
    while True:
        try:
            settings = get_auto_send_settings()
            if settings.get("enabled_os") or settings.get("enabled_sp"):
                await asyncio.to_thread(run_auto_send_mysql_monitor_cycle)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "[EMAIL AUTO SEND MONITOR] cycle error: %s",
                exc,
                exc_info=True,
            )
        await asyncio.sleep(interval)


def start_email_auto_send_scheduler() -> None:
    global _task, _started
    with _lock:
        if _started:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning(
                "[EMAIL AUTO SEND MONITOR] sem event loop — scheduler não iniciado"
            )
            return

        _task = loop.create_task(_auto_send_monitor_loop())
        _started = True


def stop_email_auto_send_scheduler() -> None:
    global _task, _started
    with _lock:
        if _task and not _task.done():
            _task.cancel()
        _task = None
        _started = False
