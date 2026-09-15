"""Timeouts para I/O em DFS/UNC — evita thread da API presa indefinidamente."""
from __future__ import annotations

import concurrent.futures
import logging
import os
from typing import Callable, TypeVar

logger = logging.getLogger(__name__)

DEFAULT_FS_TIMEOUT_SEC = 30.0
T = TypeVar("T")


class FsTimeoutError(TimeoutError):
    """Operação de filesystem excedeu o tempo limite."""


def _timeout_sec() -> float:
    try:
        raw = os.getenv("SAGRA_FS_TIMEOUT_SEC", "").strip()
        if not raw:
            return DEFAULT_FS_TIMEOUT_SEC
        return max(3.0, min(120.0, float(raw)))
    except (TypeError, ValueError):
        return DEFAULT_FS_TIMEOUT_SEC


def run_with_timeout(fn: Callable[[], T], *, timeout_sec: float | None = None, label: str = "fs") -> T:
    """Executa fn em thread isolada e aborta com FsTimeoutError."""
    limit = _timeout_sec() if timeout_sec is None else timeout_sec
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(fn)
        try:
            return future.result(timeout=limit)
        except concurrent.futures.TimeoutError as exc:
            logger.warning("Timeout (%.0fs) em operação DFS (%s)", limit, label)
            raise FsTimeoutError(f"Pasta de rede indisponível (timeout {int(limit)}s).") from exc


def listdir_with_timeout(folder: str, *, timeout_sec: float | None = None) -> list[str]:
    return list(run_with_timeout(lambda: os.listdir(folder), timeout_sec=timeout_sec, label=f"listdir:{folder}"))


def path_exists_with_timeout(path: str, *, timeout_sec: float | None = None) -> bool:
    return bool(run_with_timeout(lambda: os.path.exists(path), timeout_sec=timeout_sec, label=f"exists:{path}"))


def isdir_with_timeout(path: str, *, timeout_sec: float | None = None) -> bool:
    return bool(run_with_timeout(lambda: os.path.isdir(path), timeout_sec=timeout_sec, label=f"isdir:{path}"))


def glob_with_timeout(pattern: str, *, timeout_sec: float | None = None) -> list[str]:
    import glob

    return list(run_with_timeout(lambda: glob.glob(pattern), timeout_sec=timeout_sec, label=f"glob:{pattern}"))
