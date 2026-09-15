"""Flag: jobs pesados (prova/lab/ZIP) no processo da API vs worker dedicado."""
from __future__ import annotations

import os


def inprocess_heavy_jobs() -> bool:
    """
    True (padrão): ThreadPoolExecutor dentro do uvicorn.
    False: API só persiste pending; `heavy_jobs_worker.py` processa.
    """
    raw = (os.getenv("SAGRA_INPROCESS_HEAVY_JOBS") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}
