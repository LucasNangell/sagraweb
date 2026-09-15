"""
Worker dedicado de jobs pesados (Prova WEB, Análise Lab, ZIP Gravação Externa).

Uso: rode em processo separado da API HTTP quando SAGRA_INPROCESS_HEAVY_JOBS=0
no uvicorn. Não use `uvicorn --workers` na API — WS e caches são in-memory.
"""
from __future__ import annotations

import logging
import os
import signal
import sys
import time
import traceback

import bootstrap_paths  # noqa: F401

_shutdown = False
_POLL_SEC = 5.0

logger = logging.getLogger("sagra.heavy_jobs")


def _handle_signal(signum, _frame) -> None:
    global _shutdown
    _shutdown = True
    logger.info("Heavy jobs worker: sinal %s, encerrando.", signum)


def _poll_sec() -> float:
    try:
        return max(2.0, min(30.0, float(os.getenv("SAGRA_HEAVY_JOBS_POLL_SEC", "5"))))
    except (TypeError, ValueError):
        return _POLL_SEC


def recover_all() -> dict[str, object]:
    from services.analise_lab_job_service import recover_analise_lab_render_jobs
    from services.gravacao_externa_zip_job_service import recover_zip_jobs
    from services.prova_web_job_service import recover_prova_web_render_jobs

    return {
        "prova_web": recover_prova_web_render_jobs(),
        "analise_lab": recover_analise_lab_render_jobs(),
        "zip": recover_zip_jobs(),
    }


def main(argv: list[str] | None = None) -> int:
    del argv
    os.environ["SAGRA_INPROCESS_HEAVY_JOBS"] = "1"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    logger.info(
        "Heavy jobs worker iniciado (pid=%s). Não execute uvicorn --workers na API.",
        os.getpid(),
    )
    try:
        recover_all()
    except Exception:
        logger.exception("Falha na recuperação inicial de jobs pesados")

    interval = _poll_sec()
    while not _shutdown:
        time.sleep(interval)
        if _shutdown:
            break
        try:
            recover_all()
        except Exception:
            logger.exception("Falha ao recuperar jobs pesados")
    logger.info("Heavy jobs worker encerrado.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception:
        traceback.print_exc()
        sys.exit(1)
