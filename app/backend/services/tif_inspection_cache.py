"""Cache persistente de características, independente dos rótulos do aprendizado."""
from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)
MAX_ENTRIES = 10_000
MAX_PAYLOAD_BYTES = 64 * 1024
MAX_AGE_SECONDS = 30 * 24 * 3600
CACHE_VERSION = 1
_connection_setup_lock = Lock()


def cache_path() -> Path:
    from config_manager import PROJECT_ROOT
    override = os.getenv("SAGRA_TIF_INSPECTION_CACHE_DIR", "").strip()
    return (Path(override) if override else PROJECT_ROOT / "data" / "tif_graphics_cache") / "features.sqlite3"


def _connect():
    path = cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=0.25)
    try:
        # Duas primeiras analises podiam disputar a mudanca para WAL e perder
        # uma escrita. Serializa apenas a preparacao, nao a analise dos TIFFs.
        with _connection_setup_lock:
            if connection.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
                connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("""CREATE TABLE IF NOT EXISTS inspection_cache (
                token TEXT PRIMARY KEY, version INTEGER NOT NULL,
                created_at REAL NOT NULL, payload TEXT NOT NULL)""")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_inspection_age ON inspection_cache(created_at)")
    except Exception:
        connection.close()
        raise
    return connection


def _valid(result: dict, feature_version: str) -> bool:
    vector = result.get("features")
    digest = result.get("content_sha256", "")
    return (result.get("feature_version") == feature_version
            and result.get("graphics_status") in ("blank_graphics", "with_graphics")
            and type(result.get("blank_graphics")) is bool
            and result["blank_graphics"] == (result["graphics_status"] == "blank_graphics")
            and isinstance(vector, list) and len(vector) == 259
            and all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in vector)
            and isinstance(digest, str) and len(digest) == 64
            and all(c in "0123456789abcdef" for c in digest))


def read_inspection(token: str, feature_version: str) -> dict | None:
    try:
        if not cache_path().is_file():
            return None
        with closing(_connect()) as connection:
            row = connection.execute(
                "SELECT payload FROM inspection_cache WHERE token=? AND version=? AND created_at>?",
                (token, CACHE_VERSION, time.time() - MAX_AGE_SECONDS),
            ).fetchone()
        if not row or len(row[0]) > MAX_PAYLOAD_BYTES:
            return None
        result = json.loads(row[0])
        return result if isinstance(result, dict) and _valid(result, feature_version) else None
    except (OSError, sqlite3.Error, ValueError, TypeError):
        logger.debug("Cache de inspeção indisponível; usando análise do TIFF.", exc_info=True)
        return None


def write_inspection(token: str, result: dict, feature_version: str) -> None:
    if not _valid(result, feature_version):
        return
    payload = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if len(payload.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        return
    try:
        with closing(_connect()) as connection, connection:
            connection.execute("INSERT OR REPLACE INTO inspection_cache VALUES (?,?,?,?)",
                               (token, CACHE_VERSION, time.time(), payload))
            connection.execute("DELETE FROM inspection_cache WHERE created_at<?", (time.time()-MAX_AGE_SECONDS,))
            connection.execute("""DELETE FROM inspection_cache WHERE token IN (
                SELECT token FROM inspection_cache ORDER BY created_at DESC LIMIT -1 OFFSET ?)""", (MAX_ENTRIES,))
    except (OSError, sqlite3.Error):
        logger.debug("Não foi possível persistir o cache de inspeção.", exc_info=True)
