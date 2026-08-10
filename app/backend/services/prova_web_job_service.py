"""
Fila em background para renderização da Prova WEB (PyMuPDF).

Roda dentro do processo da API (ThreadPoolExecutor), com status persistido
em tabProvaWeb — a request HTTP não bloqueia durante o raster.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Optional

from services.prova_web_record_service import (
    RENDER_CANCELLED,
    RENDER_ERROR,
    RENDER_PENDING,
    RENDER_READY,
    RENDER_RUNNING,
    claim_prova_web_render,
    finalize_prova_web_render,
    get_prova_web_record_by_versao,
    list_prova_web_render_jobs,
    mark_prova_web_render_pending,
    resolve_record_sources,
    set_prova_web_render_state,
    update_prova_web_render_progress,
)
from services.prova_web_render_service import (
    ProvaWebRenderCancelled,
    ensure_prova_web_pages,
    pasta_render_for_versao,
)

logger = logging.getLogger(__name__)

_DEFAULT_MAX_WORKERS = 1
_PROGRESS_MIN_INTERVAL_S = 0.75


def _max_workers() -> int:
    raw = (os.environ.get("SAGRA_PROVA_WEB_RENDER_WORKERS") or "").strip()
    if not raw:
        return _DEFAULT_MAX_WORKERS
    try:
        return max(1, min(4, int(raw)))
    except ValueError:
        return _DEFAULT_MAX_WORKERS


class _ProvaWebJobRuntime:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._executor: Optional[ThreadPoolExecutor] = None
        # Generation por versão: jobs com gen antigo abortam (replace/cancel).
        self._gen: dict[tuple[int, int, int], int] = {}
        self._inflight: dict[tuple[int, int, int], Future] = {}
        self._started = False

    def start(self) -> None:
        with self._lock:
            if self._executor is None:
                workers = _max_workers()
                self._executor = ThreadPoolExecutor(
                    max_workers=workers,
                    thread_name_prefix="prova-web-render",
                )
                logger.info(
                    "Prova WEB render worker iniciado (max_workers=%s)", workers
                )
            self._started = True

    def _ensure_executor(self) -> ThreadPoolExecutor:
        with self._lock:
            if self._executor is None:
                self.start()
            assert self._executor is not None
            return self._executor

    def _bump_gen(self, key: tuple[int, int, int]) -> int:
        nxt = self._gen.get(key, 0) + 1
        self._gen[key] = nxt
        return nxt

    def request_cancel(self, ano: int, os_id: int, versao: int) -> None:
        key = (int(ano), int(os_id), int(versao))
        with self._lock:
            self._bump_gen(key)

    def is_stale(self, ano: int, os_id: int, versao: int, job_gen: int) -> bool:
        key = (int(ano), int(os_id), int(versao))
        with self._lock:
            return self._gen.get(key, 0) != int(job_gen)

    def enqueue(self, ano: int, os_id: int, versao: int) -> bool:
        """Agenda um novo job; invalida job anterior da mesma versão."""
        key = (int(ano), int(os_id), int(versao))
        executor = self._ensure_executor()
        with self._lock:
            job_gen = self._bump_gen(key)
            future = executor.submit(
                self._run_job, int(ano), int(os_id), int(versao), job_gen
            )
            self._inflight[key] = future

            def _cleanup(fut: Future, k: tuple[int, int, int] = key) -> None:
                with self._lock:
                    cur = self._inflight.get(k)
                    if cur is fut:
                        self._inflight.pop(k, None)

            future.add_done_callback(_cleanup)
        return True

    def _run_job(self, ano: int, os_id: int, versao: int, job_gen: int) -> None:
        if self.is_stale(ano, os_id, versao, job_gen):
            logger.info(
                "Prova WEB: job stale antes do claim OS %s/%s v%s gen=%s",
                os_id,
                ano,
                versao,
                job_gen,
            )
            return

        if not claim_prova_web_render(ano, os_id, versao):
            record = get_prova_web_record_by_versao(ano, os_id, versao)
            status = (record or {}).get("renderStatus")
            logger.info(
                "Prova WEB: claim recusado OS %s/%s v%s (status=%s)",
                os_id,
                ano,
                versao,
                status,
            )
            return

        def _abort() -> bool:
            return self.is_stale(ano, os_id, versao, job_gen)

        if _abort():
            finalize_prova_web_render(
                ano,
                os_id,
                versao,
                render_status=RENDER_CANCELLED,
                clear_error=True,
                clear_progress=True,
            )
            return

        last_progress_at = 0.0

        def _on_progress(done: int, total: int) -> None:
            nonlocal last_progress_at
            if _abort():
                return
            now = time.monotonic()
            if done < total and (now - last_progress_at) < _PROGRESS_MIN_INTERVAL_S:
                return
            last_progress_at = now
            try:
                update_prova_web_render_progress(
                    ano, os_id, versao, done=done, total=total
                )
            except Exception as exc:
                logger.debug(
                    "Prova WEB: falha ao gravar progresso (%s/%s v%s): %s",
                    os_id,
                    ano,
                    versao,
                    exc,
                )

        try:
            record = get_prova_web_record_by_versao(ano, os_id, versao)
            if not record:
                finalize_prova_web_render(
                    ano,
                    os_id,
                    versao,
                    render_status=RENDER_ERROR,
                    render_error="Registro da prova não encontrado.",
                    clear_progress=True,
                )
                return

            from services.prova_web_record_service import require_os_folder

            folder = require_os_folder(ano, os_id)
            mode, sources = resolve_record_sources(ano, os_id, record)
            pasta = record.get("pastaRender") or pasta_render_for_versao(versao)

            ensure_prova_web_pages(
                ano,
                os_id,
                mode=mode,
                source_paths=sources,
                os_folder=folder,
                pasta_render=pasta,
                crop_json=record.get("cropJson"),
                progress_callback=_on_progress,
                should_abort=_abort,
            )

            if _abort():
                finalize_prova_web_render(
                    ano,
                    os_id,
                    versao,
                    render_status=RENDER_CANCELLED,
                    clear_error=True,
                    clear_progress=True,
                )
                return

            if finalize_prova_web_render(
                ano,
                os_id,
                versao,
                render_status=RENDER_READY,
                clear_error=True,
                clear_progress=True,
            ):
                logger.info(
                    "Prova WEB: render pronto OS %s/%s v%s", os_id, ano, versao
                )
            else:
                logger.info(
                    "Prova WEB: job obsoleto descartado OS %s/%s v%s",
                    os_id,
                    ano,
                    versao,
                )
        except ProvaWebRenderCancelled:
            finalize_prova_web_render(
                ano,
                os_id,
                versao,
                render_status=RENDER_CANCELLED,
                clear_error=True,
                clear_progress=True,
            )
            logger.info(
                "Prova WEB: render cancelado OS %s/%s v%s", os_id, ano, versao
            )
        except Exception as exc:
            logger.exception(
                "Prova WEB: falha no job OS %s/%s v%s: %s",
                os_id,
                ano,
                versao,
                exc,
            )
            if _abort():
                finalize_prova_web_render(
                    ano,
                    os_id,
                    versao,
                    render_status=RENDER_CANCELLED,
                    clear_error=True,
                    clear_progress=True,
                )
                return
            if isinstance(exc, (FileNotFoundError, ValueError)):
                client_msg = (str(exc).strip() or "Erro na prova.")[:512]
            else:
                client_msg = "Falha ao renderizar as páginas da prova."
            finalize_prova_web_render(
                ano,
                os_id,
                versao,
                render_status=RENDER_ERROR,
                render_error=client_msg,
                clear_progress=True,
            )


_runtime = _ProvaWebJobRuntime()


def enqueue_prova_web_render(ano: int, os_id: int, versao: int) -> bool:
    """Garante pending e agenda o worker. Retorna True se submeteu future."""
    record = get_prova_web_record_by_versao(ano, os_id, versao)
    if not record:
        raise ValueError("Prova WEB não encontrada.")
    if record.get("renderStatus") != RENDER_PENDING:
        mark_prova_web_render_pending(ano, os_id, versao)
    return _runtime.enqueue(ano, os_id, versao)


def cancel_prova_web_render(ano: int, os_id: int, versao: int) -> None:
    """Invalida job em andamento; se ainda pending, marca cancelled."""
    _runtime.request_cancel(ano, os_id, versao)
    record = get_prova_web_record_by_versao(ano, os_id, versao)
    if not record:
        return
    if record.get("renderStatus") == RENDER_PENDING:
        set_prova_web_render_state(
            ano,
            os_id,
            versao,
            render_status=RENDER_CANCELLED,
            clear_error=True,
            clear_progress=True,
            touch_finished=True,
        )


def recover_prova_web_render_jobs() -> dict[str, Any]:
    """
    No startup: running órfãos → pending; reenfileira pending.
    Deve ser chamado após ensure_prova_web_schema.
    """
    _runtime.start()
    reset = 0
    enqueued = 0
    try:
        orphan_running = list_prova_web_render_jobs(statuses=[RENDER_RUNNING])
        for job in orphan_running:
            ano = int(job["anoProtocolo"])
            os_id = int(job["nroProtocolo"])
            versao = int(job["versao"])
            mark_prova_web_render_pending(ano, os_id, versao)
            reset += 1
            logger.warning(
                "Prova WEB: reset render órfão OS %s/%s v%s (running→pending)",
                os_id,
                ano,
                versao,
            )

        pending = list_prova_web_render_jobs(statuses=[RENDER_PENDING])
        for job in pending:
            ano = int(job["anoProtocolo"])
            os_id = int(job["nroProtocolo"])
            versao = int(job["versao"])
            if _runtime.enqueue(ano, os_id, versao):
                enqueued += 1
    except Exception as exc:
        logger.error("Prova WEB: falha na recuperação de jobs: %s", exc, exc_info=True)
    return {"resetRunning": reset, "enqueued": enqueued}


def start_prova_web_job_runtime() -> None:
    _runtime.start()
