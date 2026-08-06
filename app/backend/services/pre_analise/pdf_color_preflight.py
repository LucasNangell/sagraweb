"""
Preflight cromático profundo (xref/stream), adaptado do validador colorcheck.

Varre xrefs com blindagem contra PDFs malformados e mapeia achados por página.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Any, DefaultDict, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

RGB_PATTERN = re.compile(rb"([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+[rR][gG]\b")
CMYK_PATTERN = re.compile(rb"([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+[kK]\b")
DEVICE_RGB_PATTERN = re.compile(rb"/DeviceRGB\b")

ERR_RGB_IMAGE = "Imagem Raster (RGB)"
ERR_RGB_VECTOR = "Vetor/Texto (RGB)"
ERR_RICH_BLACK = "Preto Composto (4 Cores)"


def is_rich_black(c: Any, m: Any, y: Any, k: Any) -> bool:
    try:
        k_val = float(k)
        if k_val > 0.5 and (
            float(c) > 0.05 or float(m) > 0.05 or float(y) > 0.05
        ):
            return True
    except (TypeError, ValueError):
        pass
    return False


def _scan_xref_errors(doc: Any) -> List[Tuple[int, str]]:
    """Retorna lista (xref, tipo_erro) encontrada no documento."""
    errors: List[Tuple[int, str]] = []
    try:
        total_xrefs = doc.xref_length() - 1
    except Exception:
        return errors
    if total_xrefs <= 0:
        return errors

    for xref in range(1, total_xrefs + 1):
        try:
            if doc.xref_is_image(xref):
                try:
                    img_info = doc.extract_image(xref)
                    if img_info:
                        cs = img_info.get("colorspace", 0)
                        cs_name = str(img_info.get("cs-name", "")).upper()
                        if cs == 3 or "RGB" in cs_name:
                            errors.append((xref, ERR_RGB_IMAGE))
                except Exception:
                    pass
            elif doc.xref_is_stream(xref):
                try:
                    stream_bytes = doc.xref_stream(xref)
                    if not stream_bytes:
                        continue
                    has_rgb = (
                        b"rg" in stream_bytes
                        or b"RG" in stream_bytes
                        or b"DeviceRGB" in stream_bytes
                    )
                    has_cmyk = b"k" in stream_bytes or b"K" in stream_bytes
                    if has_rgb:
                        rgb_matches = sum(1 for _ in RGB_PATTERN.finditer(stream_bytes))
                        dev_rgb = sum(1 for _ in DEVICE_RGB_PATTERN.finditer(stream_bytes))
                        if (rgb_matches + dev_rgb) > 0:
                            errors.append((xref, ERR_RGB_VECTOR))
                    if has_cmyk:
                        for match in CMYK_PATTERN.finditer(stream_bytes):
                            if is_rich_black(
                                match.group(1),
                                match.group(2),
                                match.group(3),
                                match.group(4),
                            ):
                                errors.append((xref, ERR_RICH_BLACK))
                                break
                except Exception:
                    pass
        except Exception:
            continue
    return errors


def _build_xref_page_map(doc: Any) -> Dict[int, Set[int]]:
    xref_map: DefaultDict[int, Set[int]] = defaultdict(set)
    for pno in range(doc.page_count):
        page_num = pno + 1
        page = doc.load_page(pno)
        queue: Set[int] = set(page.get_contents() or [])
        try:
            for img in page.get_images():
                queue.add(int(img[0]))
            for xobj in page.get_page_xobjects():
                queue.add(int(xobj[0]))
        except Exception:
            pass
        visited: Set[int] = set()
        pending = list(queue)
        while pending:
            curr_xref = pending.pop(0)
            if curr_xref in visited or curr_xref == 0:
                continue
            visited.add(curr_xref)
            try:
                obj_str = doc.xref_object(curr_xref)
                xref_map[curr_xref].add(page_num)
                for r in re.findall(r"\b(\d+)\s+0\s+R\b", obj_str):
                    pending.append(int(r))
            except Exception:
                continue
    return dict(xref_map)


def analyze_color_preflight(doc: Any) -> Dict[str, Any]:
    """
    Agrupa achados por página (1-based) e metadados ocultos.

    Returns:
        by_page: {page: [error_labels]}
        hidden: [error_labels]
        pages_rgb: páginas com RGB (imagem ou vetor)
        pages_rich_black: páginas com preto composto
    """
    raw_errors = _scan_xref_errors(doc)
    if not raw_errors:
        return {
            "by_page": {},
            "hidden": [],
            "pages_rgb": [],
            "pages_rich_black": [],
        }

    xref_map = _build_xref_page_map(doc)
    by_page: DefaultDict[int, Set[str]] = defaultdict(set)
    hidden: Set[str] = set()

    for xref_id, error_key in raw_errors:
        pages = xref_map.get(xref_id)
        if not pages:
            hidden.add(error_key)
        else:
            for p in pages:
                by_page[p].add(error_key)

    pages_rgb: List[int] = []
    pages_rich_black: List[int] = []
    rgb_labels = {ERR_RGB_IMAGE, ERR_RGB_VECTOR}
    for p in sorted(by_page.keys()):
        labels = by_page[p]
        if labels & rgb_labels:
            pages_rgb.append(p)
        if ERR_RICH_BLACK in labels:
            pages_rich_black.append(p)

    return {
        "by_page": {p: sorted(labels) for p, labels in sorted(by_page.items())},
        "hidden": sorted(hidden),
        "pages_rgb": pages_rgb,
        "pages_rich_black": pages_rich_black,
    }
