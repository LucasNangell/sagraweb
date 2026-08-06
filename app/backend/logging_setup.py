"""
Configuração central de logs rotativos (10 MB × 5 arquivos).
"""
from __future__ import annotations

import logging
import sys
import tempfile
from logging.handlers import RotatingFileHandler
from pathlib import Path

DEFAULT_MAX_BYTES = 10 * 1024 * 1024
DEFAULT_BACKUP_COUNT = 5


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _make_rotating_handler(
    log_path: Path,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    backup_count: int = DEFAULT_BACKUP_COUNT,
) -> RotatingFileHandler:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    return RotatingFileHandler(
        log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )


def _safe_rotating_handler(
    log_path: Path,
    *,
    max_bytes: int = DEFAULT_MAX_BYTES,
    backup_count: int = DEFAULT_BACKUP_COUNT,
) -> RotatingFileHandler | None:
    """Cria handler em disco; em falha de permissão usa %TEMP% e avisa no stderr."""
    try:
        return _make_rotating_handler(
            log_path, max_bytes=max_bytes, backup_count=backup_count
        )
    except (PermissionError, OSError) as exc:
        fallback = Path(tempfile.gettempdir()) / "sagra_web" / log_path.name
        try:
            handler = _make_rotating_handler(
                fallback, max_bytes=max_bytes, backup_count=backup_count
            )
            print(
                f"[AVISO] Sem permissao para gravar em {log_path} ({exc}). "
                f"Log em {fallback}",
                file=sys.stderr,
            )
            return handler
        except (PermissionError, OSError):
            print(
                f"[AVISO] Logging em arquivo desativado ({log_path}): {exc}",
                file=sys.stderr,
            )
            return None


def setup_rotating_logger(
    name: str,
    log_filename: str,
    *,
    log_subdir: str = "api",
    level: int = logging.INFO,
    max_bytes: int = DEFAULT_MAX_BYTES,
    backup_count: int = DEFAULT_BACKUP_COUNT,
    also_console: bool = True,
) -> logging.Logger:
    log_dir = _project_root() / "logs" / log_subdir
    log_path = log_dir / log_filename

    logger = logging.getLogger(name)
    logger.setLevel(level)

    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    rotating = _safe_rotating_handler(
        log_path, max_bytes=max_bytes, backup_count=backup_count
    )
    if rotating:
        rotating.setFormatter(formatter)
        if not any(
            isinstance(h, RotatingFileHandler)
            and getattr(h, "baseFilename", "") == rotating.baseFilename
            for h in logger.handlers
        ):
            logger.addHandler(rotating)

    if also_console and not any(isinstance(h, logging.StreamHandler) for h in logger.handlers):
        console = logging.StreamHandler()
        console.setFormatter(formatter)
        logger.addHandler(console)

    return logger


def configure_root_api_logging() -> None:
    """Aplica RotatingFileHandler ao logger raiz da API."""
    log_path = _project_root() / "logs" / "api" / "sagra_api.log"

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    if any(
        isinstance(h, RotatingFileHandler) and "sagra_api.log" in getattr(h, "baseFilename", "")
        for h in root.handlers
    ):
        return

    handler = _safe_rotating_handler(log_path)
    if handler:
        handler.setFormatter(formatter)
        root.addHandler(handler)
