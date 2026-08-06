"""
Detecção de raster parcial (texto vetorial convertido em imagem) via OCR leve.

Adaptado do validador raster.py; Tesseract é opcional (TESSERACT_CMD ou PATH).
"""
from __future__ import annotations

import io
import logging
import os
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

try:
    import pytesseract
    from PIL import Image

    _OCR_LIBS = True
except ImportError:  # pragma: no cover
    pytesseract = None  # type: ignore
    Image = None  # type: ignore
    _OCR_LIBS = False

_tesseract_configured = False

_PROD_TESSERACT_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def _is_production() -> bool:
    env = (os.environ.get("ENV") or "production").strip().lower()
    return env not in ("development", "dev", "local")


def _tesseract_runs(cmd: str) -> bool:
    try:
        proc = subprocess.run(
            [cmd, "--version"],
            capture_output=True,
            timeout=15,
            check=False,
        )
        return proc.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _resolve_tesseract_cmd() -> Optional[str]:
    env_cmd = (os.environ.get("TESSERACT_CMD") or "").strip()
    if env_cmd and (_tesseract_runs(env_cmd) or os.path.isfile(env_cmd)):
        return env_cmd
    if _is_production():
        if _tesseract_runs(_PROD_TESSERACT_CMD) or os.path.isfile(_PROD_TESSERACT_CMD):
            return _PROD_TESSERACT_CMD
    which = shutil.which("tesseract")
    if which and _tesseract_runs(which):
        return which
    for candidate in (
        _PROD_TESSERACT_CMD,
        os.path.expandvars(
            r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"
        ),
    ):
        if not candidate:
            continue
        if _tesseract_runs(candidate) or os.path.isfile(candidate):
            return candidate
    return None


def ocr_unavailable_reason() -> Optional[str]:
    """Motivo pelo qual o OCR não está disponível (None = OK para configurar)."""
    if not _OCR_LIBS:
        return (
            "Bibliotecas Python ausentes (pytesseract/Pillow). "
            "No servidor, execute: pip install -r requirements.txt"
        )
    if not _resolve_tesseract_cmd():
        return (
            "Tesseract não encontrado no servidor. Defina TESSERACT_CMD no config/.env "
            f"(ex.: {_PROD_TESSERACT_CMD}) ou instale o Tesseract OCR."
        )
    return None


def _ensure_tesseract() -> bool:
    global _tesseract_configured
    if not _OCR_LIBS:
        return False
    if _tesseract_configured:
        return bool(getattr(pytesseract.pytesseract, "tesseract_cmd", None))
    cmd = _resolve_tesseract_cmd()
    if not cmd:
        return False
    pytesseract.pytesseract.tesseract_cmd = cmd
    _tesseract_configured = True
    return True


def _clean_ocr_text(text: str) -> str:
    clean_str = re.sub(r"[^a-zA-Z0-9À-ÿ\s]", "", text)
    return re.sub(r"\s+", " ", clean_str).strip()


def analyze_partial_raster_pages(doc: Any) -> Dict[str, Any]:
    """
    Páginas com imagem que contém texto legível por OCR (raster parcial).

    Returns:
        pages: lista 1-based
        method: 'ocr' | 'unavailable'
    """
    if fitz is None or not _ensure_tesseract():
        return {"pages": [], "method": "unavailable"}

    rasterized: Set[int] = set()
    try:
        for pno in range(doc.page_count):
            page = doc.load_page(pno)
            page_num = pno + 1
            for img in page.get_images(full=True):
                xref = int(img[0])
                try:
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image.get("image")
                    if not image_bytes:
                        continue
                    pil_img = Image.open(io.BytesIO(image_bytes)).convert("L")
                    raw_text = pytesseract.image_to_string(pil_img, config="--psm 6")
                    clean_text = _clean_ocr_text(raw_text)
                    if len(clean_text) > 5 and re.search(r"[a-zA-Z]{3,}", clean_text):
                        rasterized.add(page_num)
                        break
                except Exception as exc:
                    logger.debug("OCR imagem xref %s pág %s: %s", xref, page_num, exc)
                    continue
    except Exception as exc:
        logger.warning("analyze_partial_raster_pages: %s", exc)
        return {"pages": [], "method": "unavailable"}

    return {"pages": sorted(rasterized), "method": "ocr"}
