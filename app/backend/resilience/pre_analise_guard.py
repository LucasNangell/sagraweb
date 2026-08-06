"""
Limites de concorrência e carga para pré-análise PDF/OCR.
Evita saturar o worker Uvicorn com jobs simultâneos ou pastas enormes.
"""
from __future__ import annotations

import os
import os
import threading
from contextlib import contextmanager
from typing import Any

from fastapi import HTTPException

_lock = threading.Lock()
_active_jobs = 0


def _max_concurrent_jobs() -> int:
    try:
        return max(1, int(os.getenv("SAGRA_PREANALISE_MAX_JOBS", "2")))
    except (TypeError, ValueError):
        return 2


def _max_pdf_files() -> int:
    try:
        return max(1, int(os.getenv("SAGRA_PREANALISE_MAX_PDF_FILES", "30")))
    except (TypeError, ValueError):
        return 30


def _max_pdf_mb() -> int:
    try:
        return max(10, int(os.getenv("SAGRA_PREANALISE_MAX_PDF_MB", "200")))
    except (TypeError, ValueError):
        return 200


def _max_total_pages() -> int:
    try:
        return max(50, int(os.getenv("SAGRA_PREANALISE_MAX_PAGES", "600")))
    except (TypeError, ValueError):
        return 600


def _acquire_timeout_sec() -> float:
    try:
        return max(1.0, float(os.getenv("SAGRA_PREANALISE_ACQUIRE_TIMEOUT", "8")))
    except (TypeError, ValueError):
        return 8.0


@contextmanager
def pre_analise_job_slot():
    """Reserva slot de execução; libera ao terminar."""
    global _active_jobs
    max_jobs = _max_concurrent_jobs()
    acquired = False
    deadline = _acquire_timeout_sec()
    import time

    start = time.monotonic()
    while time.monotonic() - start < deadline:
        with _lock:
            if _active_jobs < max_jobs:
                _active_jobs += 1
                acquired = True
                break
        time.sleep(0.25)

    if not acquired:
        raise HTTPException(
            status_code=503,
            detail="Servidor ocupado com pré-análises. Tente novamente em instantes.",
            headers={"Retry-After": "10"},
        )
    try:
        yield
    finally:
        with _lock:
            _active_jobs = max(0, _active_jobs - 1)


def validate_pre_analise_folder(folder_path: str) -> dict[str, Any]:
    """
    Valida quantidade/tamanho de PDFs antes de processamento pesado.
    Retorna métricas (pdf_count, total_mb, total_pages).
    """
    from services.pre_analise.pdf_utils import list_pdfs, pdf_info

    pdf_names = list_pdfs(folder_path)
    if not pdf_names:
        raise HTTPException(status_code=404, detail="Nenhum PDF encontrado na pasta da versão.")

    max_files = _max_pdf_files()
    if len(pdf_names) > max_files:
        raise HTTPException(
            status_code=400,
            detail=f"Muitos PDFs na pasta (máx. {max_files}). Divida a versão ou reduza arquivos.",
        )

    total_bytes = 0
    total_pages = 0
    max_bytes = _max_pdf_mb() * 1024 * 1024

    for name in pdf_names:
        full = os.path.join(folder_path, name)
        try:
            size = os.path.getsize(full)
        except OSError as exc:
            raise HTTPException(status_code=400, detail="Erro ao ler arquivo PDF na pasta.") from exc
        total_bytes += size
        if total_bytes > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"PDFs excedem o limite de {_max_pdf_mb()} MB por versão.",
            )
        try:
            info = pdf_info(full)
            total_pages += int(info.get("pages") or 0)
        except Exception:
            pass

    max_pages = _max_total_pages()
    if total_pages > max_pages:
        raise HTTPException(
            status_code=400,
            detail=f"Muitas páginas para pré-análise (máx. {max_pages}).",
        )

    return {
        "pdf_count": len(pdf_names),
        "total_mb": round(total_bytes / (1024 * 1024), 2),
        "total_pages": total_pages,
    }
