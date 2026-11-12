"""Agendador em background do recebimento automático de e-mails."""
from __future__ import annotations

import asyncio
import logging
import threading

from services.email_auto_receive_service import run_auto_receive_cycle
from services.email_template_service import get_auto_receive_settings

logger = logging.getLogger(__name__)

_DEFAULT_INTERVAL_SEC = 20

_task: asyncio.Task | None = None
_started = False
_lock = threading.Lock()


def _interval_sec() -> int:
    return _DEFAULT_INTERVAL_SEC


async def _auto_receive_loop() -> None:
    interval = _interval_sec()
    logger.info(
        "[EMAIL AUTO RECEIVE] scheduler started interval=%ss",
        interval,
    )
    while True:
        try:
            settings = get_auto_receive_settings()
            if settings.get("enabled_os") or settings.get("enabled_sp"):
                await asyncio.to_thread(run_auto_receive_cycle)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(
                "[EMAIL AUTO RECEIVE] cycle error: %s",
                exc,
                exc_info=True,
            )
        await asyncio.sleep(interval)


def start_email_auto_receive_scheduler() -> None:
    global _task, _started
    with _lock:
        if _started:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            logger.warning(
                "[EMAIL AUTO RECEIVE] sem event loop — scheduler não iniciado"
            )
            return

        _task = loop.create_task(_auto_receive_loop())
        _started = True


def stop_email_auto_receive_scheduler() -> None:
    global _task, _started
    with _lock:
        if _task and not _task.done():
            _task.cancel()
        _task = None
        _started = False
