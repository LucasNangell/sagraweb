"""
Fila em background para renderização do Análise Lab (PyMuPDF).

Executor separado da Prova WEB para não competir pela mesma fila.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Optional

from services import analise_lab_service as lab
from services.prova_web_render_service import (
    LAB_PASTA_RENDER,
    ProvaWebRenderCancelled,
    ensure_prova_web_pages,
    ensure_web_render_dir,
    resolve_web_render_dir,
)

logger = logging.getLogger(__name__)

_DEFAULT_MAX_WORKERS = 1
_PROGRESS_MIN_INTERVAL_S = 0.75
_DIRTY_PAGES_NAME = "render_dirty.json"


def _dirty_pages_path(os_folder: str, pasta: str) -> str:
    cache_dir = ensure_web_render_dir(os_folder, pasta)
    return os.path.join(cache_dir, _DIRTY_PAGES_NAME)


def _load_dirty_pages(os_folder: str, pasta: str) -> list[int]:
    import json

    try:
        cache_dir = resolve_web_render_dir(os_folder, pasta)
    except (FileNotFoundError, ValueError, OSError):
        return []
    path = os.path.join(cache_dir, _DIRTY_PAGES_NAME)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        pages = data.get("pages") if isinstance(data, dict) else data
        if not isinstance(pages, list):
            return []
        out: list[int] = []
        for item in pages:
            try:
                n = int(item)
            except (TypeError, ValueError):
                continue
            if n >= 1:
                out.append(n)
        return sorted(set(out))
    except (OSError, json.JSONDecodeError, TypeError):
        return []


def write_dirty_pages(os_folder: str, pasta: str, pages: list[int]) -> None:
    import json

    path = _dirty_pages_path(os_folder, pasta)
    payload = {"pages": sorted({int(p) for p in pages if int(p) >= 1})}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)


def _clear_dirty_pages(os_folder: str, pasta: str) -> None:
    try:
        cache_dir = resolve_web_render_dir(os_folder, pasta)
    except (FileNotFoundError, ValueError, OSError):
        return
    path = os.path.join(cache_dir, _DIRTY_PAGES_NAME)
    if os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _max_workers() -> int:
    raw = (os.environ.get("SAGRA_ANALISE_LAB_RENDER_WORKERS") or "").strip()
    if not raw:
        return _DEFAULT_MAX_WORKERS
    try:
        return max(1, min(4, int(raw)))
    except ValueError:
        return _DEFAULT_MAX_WORKERS


class _LabJobRuntime:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._executor: Optional[ThreadPoolExecutor] = None
        self._gen: dict[tuple[int, int], int] = {}
        self._inflight: dict[tuple[int, int], Future] = {}

    def start(self) -> None:
        with self._lock:
            if self._executor is None:
                workers = _max_workers()
                self._executor = ThreadPoolExecutor(
                    max_workers=workers,
                    thread_name_prefix="analise-lab-render",
                )
                logger.info(
                    "Análise Lab render worker iniciado (max_workers=%s)", workers
                )

    def _ensure_executor(self) -> ThreadPoolExecutor:
        with self._lock:
            if self._executor is None:
                self.start()
            assert self._executor is not None
            return self._executor

    def _bump_gen(self, key: tuple[int, int]) -> int:
        nxt = self._gen.get(key, 0) + 1
        self._gen[key] = nxt
        return nxt

    def request_cancel(self, ano: int, os_id: int) -> None:
        key = (int(ano), int(os_id))
        with self._lock:
            self._bump_gen(key)

    def is_stale(self, ano: int, os_id: int, job_gen: int) -> bool:
        key = (int(ano), int(os_id))
        with self._lock:
            return self._gen.get(key, 0) != int(job_gen)

    def enqueue(self, ano: int, os_id: int) -> bool:
        from resilience.heavy_jobs import inprocess_heavy_jobs

        if not inprocess_heavy_jobs():
            return False
        key = (int(ano), int(os_id))
        executor = self._ensure_executor()
        with self._lock:
            job_gen = self._bump_gen(key)
            future = executor.submit(self._run_job_cpu, int(ano), int(os_id), job_gen)
            self._inflight[key] = future

            def _cleanup(fut: Future, k: tuple[int, int] = key) -> None:
                with self._lock:
                    cur = self._inflight.get(k)
                    if cur is fut:
                        self._inflight.pop(k, None)

            future.add_done_callback(_cleanup)
        return True

    def _run_job_cpu(self, ano: int, os_id: int, job_gen: int) -> None:
        from resilience.cpu_jobs import cpu_job_slot

        try:
            with cpu_job_slot(label="analise-lab", timeout_sec=600.0, http_error=False):
                self._run_job(ano, os_id, job_gen)
        except TimeoutError:
            logger.warning("Análise Lab: sem slot CPU OS %s/%s", os_id, ano)

    def _run_job(self, ano: int, os_id: int, job_gen: int) -> None:
        if self.is_stale(ano, os_id, job_gen):
            return
        if not lab.claim_render(ano, os_id):
            return

        def _abort() -> bool:
            return self.is_stale(ano, os_id, job_gen)

        if _abort():
            lab.finalize_render(
                ano,
                os_id,
                render_status=lab.RENDER_CANCELLED,
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
                lab.update_render_progress(ano, os_id, done=done, total=total)
            except Exception:
                logger.debug("Análise Lab: progresso falhou", exc_info=True)

        try:
            session = lab.get_session(ano, os_id)
            if not session:
                lab.finalize_render(
                    ano,
                    os_id,
                    render_status=lab.RENDER_ERROR,
                    render_error="Sessão do laboratório não encontrada.",
                    clear_progress=True,
                )
                return

            from routers.os_routes import _get_os_folder_path

            folder = _get_os_folder_path(ano, os_id)
            if not folder or not os.path.isdir(folder):
                raise FileNotFoundError("Pasta da OS não encontrada na rede.")
            from services.analise_lab_sources_service import (
                prepare_lab_render,
                write_page_map,
            )

            pasta = session.get("pastaRender") or LAB_PASTA_RENDER
            dirty_pages = _load_dirty_pages(folder, pasta)

            if dirty_pages:
                from services.analise_lab_sources_service import (
                    build_source_page_map,
                    fontes_from_session,
                    load_page_map,
                    rerender_lab_pages,
                    write_page_map,
                )

                page_map = load_page_map(folder, pasta)
                if not page_map:
                    try:
                        page_map = build_source_page_map(
                            fontes_from_session(session), folder
                        )
                        write_page_map(folder, pasta, page_map)
                    except Exception:
                        logger.warning(
                            "Análise Lab: falha ao montar pageMap parcial (%s/%s)",
                            os_id,
                            ano,
                            exc_info=True,
                        )
                        page_map = {"byComponent": {}}
                prepared = {
                    "mode": (session.get("modo") or "unico"),
                    "source_paths": [],
                    "crop_json": session.get("cropJson")
                    if isinstance(session.get("cropJson"), dict)
                    else None,
                    "page_map": page_map,
                    "concatenated": False,
                }
                try:
                    rerender_lab_pages(
                        session=session,
                        os_folder=folder,
                        pasta_render=pasta,
                        page_numbers=dirty_pages,
                        prepared=prepared,
                        progress_callback=_on_progress,
                        should_abort=_abort,
                    )
                    _clear_dirty_pages(folder, pasta)
                except ValueError as exc:
                    if "REGEN_FULL_REQUIRED" not in str(exc):
                        raise
                    logger.info(
                        "Análise Lab: regen parcial indisponível, full (%s/%s)",
                        os_id,
                        ano,
                    )
                    _clear_dirty_pages(folder, pasta)
                    prepared = prepare_lab_render(session, folder)
                    try:
                        write_page_map(folder, pasta, prepared["page_map"])
                    except Exception:
                        logger.warning(
                            "Análise Lab: falha ao gravar pageMap (%s/%s)",
                            os_id,
                            ano,
                            exc_info=True,
                        )
                    ensure_prova_web_pages(
                        ano,
                        os_id,
                        mode=prepared["mode"],
                        source_paths=prepared["source_paths"],
                        os_folder=folder,
                        pasta_render=pasta,
                        crop_json=prepared["crop_json"],
                        progress_callback=_on_progress,
                        should_abort=_abort,
                        progressive_publish=True,
                    )
            else:
                prepared = prepare_lab_render(session, folder)
                try:
                    write_page_map(folder, pasta, prepared["page_map"])
                except Exception:
                    logger.warning(
                        "Análise Lab: falha ao gravar pageMap (%s/%s)",
                        os_id,
                        ano,
                        exc_info=True,
                    )
                ensure_prova_web_pages(
                    ano,
                    os_id,
                    mode=prepared["mode"],
                    source_paths=prepared["source_paths"],
                    os_folder=folder,
                    pasta_render=pasta,
                    crop_json=prepared["crop_json"],
                    progress_callback=_on_progress,
                    should_abort=_abort,
                    progressive_publish=True,
                )

            if _abort():
                lab.finalize_render(
                    ano,
                    os_id,
                    render_status=lab.RENDER_CANCELLED,
                    clear_error=True,
                    clear_progress=True,
                )
                return

            if lab.finalize_render(
                ano,
                os_id,
                render_status=lab.RENDER_READY,
                clear_error=True,
                clear_progress=True,
            ):
                logger.info("Análise Lab: render pronto OS %s/%s", os_id, ano)
        except ProvaWebRenderCancelled:
            lab.finalize_render(
                ano,
                os_id,
                render_status=lab.RENDER_CANCELLED,
                clear_error=True,
                clear_progress=True,
            )
        except Exception as exc:
            logger.exception(
                "Análise Lab: falha no job OS %s/%s: %s", os_id, ano, exc
            )
            if _abort():
                lab.finalize_render(
                    ano,
                    os_id,
                    render_status=lab.RENDER_CANCELLED,
                    clear_error=True,
                    clear_progress=True,
                )
                return
            if isinstance(exc, (FileNotFoundError, ValueError)):
                client_msg = (str(exc).strip() or "Erro no laboratório.")[:512]
            else:
                client_msg = "Falha ao renderizar as páginas do laboratório."
            lab.finalize_render(
                ano,
                os_id,
                render_status=lab.RENDER_ERROR,
                render_error=client_msg,
                clear_progress=True,
            )


_runtime = _LabJobRuntime()


def enqueue_analise_lab_render(ano: int, os_id: int) -> bool:
    session = lab.get_session(ano, os_id)
    if not session:
        raise ValueError("Sessão do Análise Lab não encontrada.")
    if session.get("renderStatus") != lab.RENDER_PENDING:
        lab.mark_render_pending(ano, os_id)
    return _runtime.enqueue(ano, os_id)


def cancel_analise_lab_render(ano: int, os_id: int) -> None:
    _runtime.request_cancel(ano, os_id)
    session = lab.get_session(ano, os_id)
    if not session:
        return
    if session.get("renderStatus") == lab.RENDER_PENDING:
        # Pending → cancelled via direct update (not finalize, which requires running).
        from database import db

        db.execute_query(
            """
            UPDATE tabAnaliseLabSessao
            SET RenderStatus = %s, RenderError = NULL, RenderProgress = NULL,
                RenderFinishedAt = NOW()
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND RenderStatus = %s
            """,
            (lab.RENDER_CANCELLED, os_id, ano, lab.RENDER_PENDING),
        )


def recover_analise_lab_render_jobs() -> dict[str, Any]:
    from resilience.heavy_jobs import inprocess_heavy_jobs

    start_runtime = inprocess_heavy_jobs()
    if start_runtime:
        _runtime.start()
    reset = 0
    enqueued = 0
    try:
        jobs = lab.list_pending_or_running_jobs()
        for job in jobs:
            ano = int(job["anoProtocolo"])
            os_id = int(job["nroProtocolo"])
            if job.get("renderStatus") == lab.RENDER_RUNNING:
                lab.mark_render_pending(ano, os_id)
                reset += 1
            if _runtime.enqueue(ano, os_id):
                enqueued += 1
    except Exception as exc:
        logger.error("Análise Lab: falha na recuperação de jobs: %s", exc, exc_info=True)
    return {"resetRunning": reset, "enqueued": enqueued}
