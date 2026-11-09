"""
Comparador visual de versões PDF — fachada da API sobre o motor compartilhado.

A implementação vive em ``app/services/pdf_compare_engine.py`` (também usada
pelo Folder Opener local).
"""
from __future__ import annotations

import sys
from pathlib import Path

_SERVICES_DIR = Path(__file__).resolve().parents[2] / "services"
_services_s = str(_SERVICES_DIR)
if _services_s not in sys.path:
    sys.path.insert(0, _services_s)

from pdf_compare_engine import (  # noqa: E402,F401
    DEFAULT_MAX_ACTIVE_COMPARE_JOBS,
    CancelCb,
    CompareBusyError,
    OperationCanceledError,
    PdfCompareBBox,
    PdfCompareOptions,
    PdfComparePageResult,
    PdfCompareResult,
    ProgressCb,
    SessionJob,
    build_report_pdf,
    cancel_job,
    cleanup_old_sessions,
    compare_pdfs,
    compare_root,
    count_active_jobs,
    get_job,
    resolve_asset_path,
    result_to_api_dict,
    severity_label,
    start_compare_job,
)

__all__ = [
    "DEFAULT_MAX_ACTIVE_COMPARE_JOBS",
    "CancelCb",
    "CompareBusyError",
    "OperationCanceledError",
    "PdfCompareBBox",
    "PdfCompareOptions",
    "PdfComparePageResult",
    "PdfCompareResult",
    "ProgressCb",
    "SessionJob",
    "build_report_pdf",
    "cancel_job",
    "cleanup_old_sessions",
    "compare_pdfs",
    "compare_root",
    "count_active_jobs",
    "get_job",
    "resolve_asset_path",
    "result_to_api_dict",
    "severity_label",
    "start_compare_job",
]
