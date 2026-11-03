"""Catálogo de MP3 do letreiro: upload no servidor, download pelos clients."""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from config_manager import PROJECT_ROOT

logger = logging.getLogger(__name__)

SOUNDS_DIR = PROJECT_ROOT / "data" / "letreiro_sounds"
INDEX_NAME = "index.json"
MAX_BYTES = 2 * 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


def ensure_dir() -> Path:
    SOUNDS_DIR.mkdir(parents=True, exist_ok=True)
    return SOUNDS_DIR


def _index_path() -> Path:
    return ensure_dir() / INDEX_NAME


def _read_index() -> list[dict[str, Any]]:
    path = _index_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Índice de sons do letreiro inválido: %s", exc)
        return []
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict) and row.get("id")]


def _write_index(rows: list[dict[str, Any]]) -> None:
    path = _index_path()
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def _file_path(sound_id: str) -> Path:
    return ensure_dir() / f"{sound_id}.mp3"


def list_sounds() -> list[dict[str, Any]]:
    rows = _read_index()
    out: list[dict[str, Any]] = []
    for row in rows:
        sound_id = str(row.get("id") or "").strip()
        if not ID_RE.match(sound_id):
            continue
        path = _file_path(sound_id)
        if not path.is_file():
            continue
        out.append(
            {
                "id": sound_id,
                "name": str(row.get("name") or sound_id),
                "originalName": str(row.get("originalName") or row.get("name") or ""),
                "size": int(row.get("size") or path.stat().st_size),
                "updatedAt": row.get("updatedAt"),
            }
        )
    return out


def get_sound_meta(sound_id: str) -> Optional[dict[str, Any]]:
    sound_id = (sound_id or "").strip()
    if not ID_RE.match(sound_id):
        return None
    for row in list_sounds():
        if row["id"] == sound_id:
            return row
    return None


def resolve_file(sound_id: str) -> Optional[Path]:
    meta = get_sound_meta(sound_id)
    if meta is None:
        return None
    path = _file_path(meta["id"])
    return path if path.is_file() else None


def _safe_display_name(filename: str | None) -> str:
    raw = Path(filename or "som.mp3").name.strip() or "som.mp3"
    raw = re.sub(r"[^\w.\- ()\[\]]+", "_", raw, flags=re.UNICODE)
    if not raw.lower().endswith(".mp3"):
        raw = f"{raw}.mp3"
    return raw[:120]


def _looks_like_mp3(content: bytes) -> bool:
    if len(content) < 3:
        return False
    # ID3v2 no início, ou frame MPEG em qualquer offset inicial (alguns MP3 têm padding).
    probe = content[: min(len(content), 64 * 1024)]
    if probe[:3] == b"ID3":
        return True
    for i in range(0, max(0, len(probe) - 1)):
        if probe[i] == 0xFF and (probe[i + 1] & 0xE0) == 0xE0:
            return True
    return False


def save_upload(filename: str | None, content: bytes) -> dict[str, Any]:
    if not content:
        raise ValueError("Arquivo vazio.")
    if len(content) > MAX_BYTES:
        raise ValueError(f"Arquivo maior que {MAX_BYTES // (1024 * 1024)} MB.")
    name = _safe_display_name(filename)
    if not name.lower().endswith(".mp3"):
        raise ValueError("Apenas arquivos .mp3.")
    if not _looks_like_mp3(content):
        raise ValueError("Conteúdo não parece um MP3 válido.")

    sound_id = uuid.uuid4().hex[:12]
    path = _file_path(sound_id)
    path.write_bytes(content)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    row = {
        "id": sound_id,
        "name": Path(name).stem[:80] or sound_id,
        "originalName": name,
        "size": len(content),
        "updatedAt": now,
    }
    rows = _read_index()
    rows.append(row)
    _write_index(rows)
    return row


def delete_sound(sound_id: str) -> bool:
    sound_id = (sound_id or "").strip()
    if not ID_RE.match(sound_id):
        return False
    rows = _read_index()
    kept = [row for row in rows if str(row.get("id") or "") != sound_id]
    if len(kept) == len(rows):
        path = _file_path(sound_id)
        if path.is_file():
            path.unlink(missing_ok=True)
        return False
    _write_index(kept)
    path = _file_path(sound_id)
    path.unlink(missing_ok=True)
    return True
