"""
Registro de verificações de pré-análise.

Validadores AnalisePDF: formato, sangria, colorcheck, checkimagem e raster.
"""
from __future__ import annotations

import concurrent.futures
import logging
from typing import Any, Callable, Dict, List, Optional

from services.pre_analise.checks.formato import run_formato_check
from services.pre_analise.checks.script_checks import (
    run_cores_colorcheck,
    run_imagens_checkimagem,
    run_raster_parcial,
    run_sangria_bleed,
)
from services.pre_analise.context import PreAnaliseContext
from services.pre_analise.result_helpers import timeout_result

logger = logging.getLogger(__name__)

CHECK_TIMEOUT_SEC = 8.0

CheckRunner = Callable[[str, Optional[PreAnaliseContext]], Dict[str, Any]]

CHECKS: Dict[str, Dict[str, Any]] = {
    "formato": {
        "id": "formato",
        "nome": "Formato e capa",
        "descricao": (
            "Marcas de corte, formato de impressão, orelhas e lombada "
            "(baseado em formato.py)."
        ),
        "run": run_formato_check,
        "timeout_sec": 30.0,
    },
    "sangria_bleed": {
        "id": "sangria_bleed",
        "nome": "Sangrias (mín. 4 mm)",
        "descricao": (
            "Sangria dos elementos em relação às marcas de corte — "
            "TrimBox virtual (checkbleed)."
        ),
        "run": run_sangria_bleed,
        "timeout_sec": 60.0,
        "timeout_per_page_sec": 0.18,
        "timeout_max_sec": 360.0,
    },
    "cores_colorcheck": {
        "id": "cores_colorcheck",
        "nome": "Cores — RGB e preto 4c",
        "descricao": "Imagem raster RGB, vetor/texto RGB e preto composto (colorcheck).",
        "run": run_cores_colorcheck,
        "timeout_sec": 25.0,
    },
    "imagens_baixa_resolucao": {
        "id": "imagens_baixa_resolucao",
        "nome": "Imagens < 300 dpi",
        "descricao": "Resolução efetiva das imagens e posição na página (checkimagem).",
        "run": run_imagens_checkimagem,
        "timeout_sec": 45.0,
        "timeout_per_page_sec": 0.12,
        "timeout_max_sec": 300.0,
    },
    "raster_parcial": {
        "id": "raster_parcial",
        "nome": "Raster parcial (OCR)",
        "descricao": "Texto em imagem detectado por OCR — requer Tesseract (raster).",
        "run": run_raster_parcial,
        "timeout_sec": 45.0,
    },
}


def _registered_check_ids() -> List[str]:
    return list(CHECKS.keys())


def _enabled_check_ids() -> List[str]:
    from services.pre_analise.check_settings import get_enabled_check_ids

    return get_enabled_check_ids(_registered_check_ids())


def list_checks() -> List[Dict[str, str]]:
    enabled = set(_enabled_check_ids())
    return [
        {
            "id": meta["id"],
            "nome": meta["nome"],
            "descricao": meta["descricao"],
        }
        for meta in CHECKS.values()
        if meta["id"] in enabled
    ]


def list_checks_config() -> List[Dict[str, object]]:
    from services.pre_analise.check_settings import get_disabled_check_ids

    disabled = get_disabled_check_ids()
    return [
        {
            "id": meta["id"],
            "nome": meta["nome"],
            "descricao": meta["descricao"],
            "enabled": meta["id"] not in disabled,
        }
        for meta in CHECKS.values()
    ]


def _resolve_check_timeout(
    meta: Dict[str, Any],
    context: Optional[PreAnaliseContext],
    default_sec: float,
) -> float:
    base = float(meta.get("timeout_sec", default_sec))
    per_page = float(meta.get("timeout_per_page_sec") or 0)
    cap = float(meta.get("timeout_max_sec") or 600.0)
    if per_page <= 0 or context is None:
        return base
    workload = context.workload or {}
    pages = max(1, int(workload.get("total_pages") or 1))
    pdfs = max(1, int(workload.get("pdf_count") or 1))
    scaled = base + pages * per_page * (1.0 + 0.08 * max(0, pdfs - 1))
    return min(cap, max(base, scaled))


def run_check(
    check_id: str,
    folder_path: str,
    context: Optional[PreAnaliseContext] = None,
    timeout_sec: float = CHECK_TIMEOUT_SEC,
) -> Dict[str, Any]:
    meta = CHECKS.get(check_id)
    if not meta:
        raise ValueError(f"Verificação desconhecida: {check_id}")
    if check_id not in _enabled_check_ids():
        raise ValueError(f"Verificação desabilitada nas configurações: {check_id}")
    runner: CheckRunner = meta["run"]
    check_nome = meta["nome"]
    check_timeout = _resolve_check_timeout(meta, context, timeout_sec)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(runner, folder_path, context)
        try:
            result = future.result(timeout=check_timeout)
        except concurrent.futures.TimeoutError:
            logger.warning(
                "Pré-análise timeout (%ss): %s em %s",
                check_timeout,
                check_id,
                folder_path,
            )
            result = timeout_result(check_nome, check_timeout)
        except Exception as exc:
            logger.exception("Pré-análise falhou: %s em %s", check_id, folder_path)
            from services.pre_analise.result_helpers import achado, finalize_result

            result = finalize_result(
                [
                    achado(
                        "verificacao_erro",
                        check_nome,
                        f"Erro ao executar verificação: {exc}",
                        "error",
                    )
                ],
                pdf_count=0,
            )

    result["check_id"] = check_id
    result["check_nome"] = check_nome
    return result


def iter_all_checks(
    folder_path: str,
    context: Optional[PreAnaliseContext] = None,
    timeout_sec: float = CHECK_TIMEOUT_SEC,
):
    """
    Gera eventos de progresso por verificação (reutiliza PDFs abertos na pasta).

    Yields dicts: start | running | progress | done
    """
    from services.pre_analise.folder_session import attach_session, release_session

    ctx = context or PreAnaliseContext(folder_path=folder_path, ano=0, os_id=0)
    ctx.batch_mode = True
    check_ids = _enabled_check_ids()
    total = len(check_ids)
    from services.pre_analise.timing_store import RunTimer, workload_from_pdf_infos

    import time as _time

    sess = attach_session(ctx)
    timer: Optional[RunTimer] = None
    try:
        yield {
            "type": "running",
            "index": 0,
            "total": total,
            "check_nome": "Abrindo PDFs na pasta…",
            "check_id": None,
        }
        t_setup = _time.perf_counter()
        open_err, _ = sess.open_docs()
        if open_err:
            yield {
                "type": "error",
                "message": open_err,
            }
            return

        sess.load_pdf_infos()
        workload = workload_from_pdf_infos(sess.pdf_infos)
        ctx.workload = workload
        timer = RunTimer(check_ids, workload)
        timer.mark_setup_done(_time.perf_counter() - t_setup)
        yield {"type": "start", "total": total, **timer.timing_fields()}

        import threading

        for index, check_id in enumerate(check_ids):
            meta = CHECKS[check_id]
            check_nome = meta["nome"]
            yield {
                "type": "running",
                "index": index,
                "total": total,
                "check_id": check_id,
                "check_nome": check_nome,
                **timer.timing_fields(),
            }
            t_check = _time.perf_counter()
            result_box: Dict[str, Any] = {}
            error_box: List[BaseException] = []

            def _worker() -> None:
                try:
                    result_box["result"] = run_check(
                        check_id, folder_path, ctx, timeout_sec=timeout_sec
                    )
                except BaseException as exc:  # pragma: no cover
                    error_box.append(exc)

            timer.mark_check_start(check_id)
            worker = threading.Thread(target=_worker, daemon=True)
            worker.start()
            while worker.is_alive():
                worker.join(timeout=1.0)
                if worker.is_alive():
                    yield {
                        "type": "heartbeat",
                        "index": index,
                        "total": total,
                        "check_id": check_id,
                        "check_nome": check_nome,
                        **timer.timing_fields(),
                    }
            if error_box:
                exc = error_box[0]
                logger.exception(
                    "Pré-análise check %s falhou em %s", check_id, folder_path
                )
                from services.pre_analise.result_helpers import achado, finalize_result

                result = finalize_result(
                    [
                        achado(
                            "verificacao_erro",
                            check_nome,
                            "Erro ao executar verificação. Consulte o log do servidor.",
                            "error",
                        )
                    ],
                    pdf_count=int((ctx.workload or {}).get("pdf_count") or 0),
                )
            else:
                result = result_box["result"]
            timer.mark_check_done(check_id, _time.perf_counter() - t_check)
            yield {
                "type": "progress",
                "index": index,
                "total": total,
                "check_id": check_id,
                "check_nome": check_nome,
                "result": result,
                **timer.timing_fields(),
            }
        yield {"type": "done", "total": total, **(timer.timing_fields() if timer else {})}
    finally:
        release_session(folder_path)
        ctx.pdf_session = None
        ctx.batch_mode = False


def run_all_checks(
    folder_path: str,
    context: Optional[PreAnaliseContext] = None,
    timeout_sec: float = CHECK_TIMEOUT_SEC,
) -> List[Dict[str, Any]]:
    """Executa todas as verificações em sequência reutilizando PDFs abertos na pasta."""
    results: List[Dict[str, Any]] = []
    for event in iter_all_checks(folder_path, context, timeout_sec):
        if event.get("type") == "progress" and event.get("result"):
            results.append(event["result"])
    return results
