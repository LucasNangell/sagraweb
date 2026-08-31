"""Cadastro de foto do solicitante (arquivo em disco + tab_solicitante_foto)."""
from __future__ import annotations

import hashlib
import logging
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from database import db
from services.os_filter_options_service import normalize_label
from solicitante_foto_schema import solicitante_fotos_dir

logger = logging.getLogger(__name__)

MAX_BYTES = 8 * 1024 * 1024
_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _detect_image_kind(data: bytes) -> str:
    if data.startswith(_JPEG_MAGIC):
        return "jpeg"
    if data.startswith(_PNG_MAGIC):
        return "png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise ValueError("Arquivo não é uma imagem JPEG, PNG ou WebP.")


def _file_stem(normalized: str) -> str:
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def _to_jpeg_bytes(data: bytes) -> bytes:
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("Arquivo de imagem inválido.") from exc

    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")

    out = BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


def _row_for_nome(nome: str) -> dict | None:
    normalized = normalize_label(nome)
    if not normalized:
        return None
    rows = db.execute_query(
        """
        SELECT solicitante, solicitante_normalizado, image_path, content_type
        FROM tab_solicitante_foto
        WHERE solicitante_normalizado = %s
        LIMIT 1
        """,
        (normalized,),
    )
    return rows[0] if rows else None


def _safe_file(stored: str) -> Path | None:
    root = solicitante_fotos_dir().resolve()
    try:
        candidate = Path(stored).resolve()
        candidate.relative_to(root)
    except (OSError, ValueError):
        return None
    if not candidate.is_file():
        return None
    if candidate.suffix.lower() not in {".jpg", ".jpeg"}:
        return None
    return candidate


def foto_exists(nome: str) -> bool:
    return resolve_foto_path(nome) is not None


def resolve_foto_path(nome: str) -> Path | None:
    row = _row_for_nome(nome)
    if not row:
        return None
    return _safe_file(str(row.get("image_path") or ""))


def save_foto(nome: str, data: bytes) -> dict:
    display = " ".join((nome or "").split())
    normalized = normalize_label(display)
    if len(normalized) < 3:
        raise ValueError("Informe o nome do solicitante (mínimo 3 caracteres).")
    if not data:
        raise ValueError("Arquivo vazio.")
    if len(data) > MAX_BYTES:
        raise ValueError("Imagem muito grande (máx. 8MB).")

    _detect_image_kind(data)
    jpeg = _to_jpeg_bytes(data)

    dest = solicitante_fotos_dir() / f"{_file_stem(normalized)}.jpg"
    dest.write_bytes(jpeg)
    path_str = str(dest)

    db.execute_query(
        """
        INSERT INTO tab_solicitante_foto (
            solicitante, solicitante_normalizado, image_path, content_type
        )
        VALUES (%s, %s, %s, 'image/jpeg')
        ON DUPLICATE KEY UPDATE
            solicitante = VALUES(solicitante),
            image_path = VALUES(image_path),
            content_type = VALUES(content_type)
        """,
        (display[:255], normalized[:255], path_str[:512]),
    )
    logger.debug("Foto do solicitante gravada (norm_len=%s)", len(normalized))
    return {"exists": True}
