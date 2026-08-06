"""
Metadados e sugestões de crop (mm) para o assistente da Prova WEB.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_PT_PER_MM = 72.0 / 25.4
_MIN_REMAINING_MM = 5.0


def mm_to_pt(mm: float) -> float:
    return float(mm) * _PT_PER_MM


def pt_to_mm(pt: float) -> float:
    return round(float(pt) / _PT_PER_MM, 2)


def empty_crop(source: str = "manual") -> dict[str, Any]:
    return {
        "top": 0.0,
        "right": 0.0,
        "bottom": 0.0,
        "left": 0.0,
        "source": source,
    }


def centered_crop_mm(
    media_w: float,
    media_h: float,
    target_w: float,
    target_h: float,
    *,
    source: str = "formato",
) -> Optional[dict[str, Any]]:
    """
    Crop que deixa targetW×targetH centralizado no MediaBox.
    Tenta também a orientação invertida se a original não couber.
    Retorna None se o alvo não couber (com folga mínima).
    """
    if media_w <= 0 or media_h <= 0 or target_w <= 0 or target_h <= 0:
        return None

    candidates = [(float(target_w), float(target_h))]
    if abs(target_w - target_h) > 0.05:
        candidates.append((float(target_h), float(target_w)))

    for tw, th in candidates:
        if tw > media_w + 0.05 or th > media_h + 0.05:
            continue
        left = round((media_w - tw) / 2.0, 2)
        right = round(media_w - tw - left, 2)
        top = round((media_h - th) / 2.0, 2)
        bottom = round(media_h - th - top, 2)
        if left < -0.05 or right < -0.05 or top < -0.05 or bottom < -0.05:
            continue
        try:
            validate_crop_against_page(
                media_w,
                media_h,
                {"top": top, "right": right, "bottom": bottom, "left": left},
            )
        except ValueError:
            continue
        return {
            "top": max(0.0, top),
            "right": max(0.0, right),
            "bottom": max(0.0, bottom),
            "left": max(0.0, left),
            "source": source,
        }
    return None


def normalize_crop_sides(raw: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    try:
        crop = {
            "top": max(0.0, float(raw.get("top") or 0)),
            "right": max(0.0, float(raw.get("right") or 0)),
            "bottom": max(0.0, float(raw.get("bottom") or 0)),
            "left": max(0.0, float(raw.get("left") or 0)),
            "source": str(raw.get("source") or "manual"),
        }
    except (TypeError, ValueError):
        return None
    return crop


def validate_crop_against_page(
    width_mm: float, height_mm: float, crop: dict[str, Any]
) -> None:
    remain_w = width_mm - crop["left"] - crop["right"]
    remain_h = height_mm - crop["top"] - crop["bottom"]
    if remain_w < _MIN_REMAINING_MM or remain_h < _MIN_REMAINING_MM:
        raise ValueError(
            f"Crop excessivo: a área útil ficaria com "
            f"{remain_w:.1f}×{remain_h:.1f} mm (mínimo {_MIN_REMAINING_MM} mm)."
        )


def _insets_from_box(media: Any, box: Any) -> Optional[dict[str, float]]:
    if box is None or media is None:
        return None
    try:
        if box.width < 8 or box.height < 8:
            return None
        top = max(0.0, float(media.y1 - box.y1))
        bottom = max(0.0, float(box.y0 - media.y0))
        left = max(0.0, float(box.x0 - media.x0))
        right = max(0.0, float(media.x1 - box.x1))
        # Ignora boxes iguais ao media (crop 0).
        if top + bottom + left + right < 0.05:
            return None
        return {
            "top": pt_to_mm(top),
            "right": pt_to_mm(right),
            "bottom": pt_to_mm(bottom),
            "left": pt_to_mm(left),
        }
    except Exception:
        return None


def suggested_crop_from_page(page: Any) -> tuple[dict[str, Any], str]:
    """
    Prioridade: TrimBox → BleedBox → zeros.
    Retorna (crop_dict, source_label).
    """
    media = page.mediabox
    for source, getter in (
        ("trimbox", lambda: page.trimbox),
        ("bleedbox", lambda: getattr(page, "bleedbox", None)),
    ):
        try:
            box = getter()
        except Exception:
            box = None
        insets = _insets_from_box(media, box)
        if insets:
            return {**insets, "source": source}, source
    return empty_crop("manual"), "manual"


def detect_crop_marks_mm(page: Any) -> Optional[dict[str, Any]]:
    """
    Detector leve (best-effort): procura tinta escura nas faixas das bordas
    de um pixmap baixo. Retorna crop sugerido ou None.
    """
    try:
        import fitz

        pix = page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5), alpha=False)
        w, h = pix.width, pix.height
        if w < 40 or h < 40:
            return None
        samples = pix.samples
        n = pix.n  # geralmente 3 (RGB)

        def dark_at(x: int, y: int) -> bool:
            i = (y * w + x) * n
            if i + 2 >= len(samples):
                return False
            r, g, b = samples[i], samples[i + 1], samples[i + 2]
            return (r + g + b) < 180

        def scan_edge(axis: str) -> Optional[float]:
            """Distância em px até a primeira faixa com marcas (pixels escuros)."""
            band = max(2, min(w, h) // 40)
            if axis == "left":
                for x in range(0, min(w // 4, 80)):
                    hits = sum(1 for y in range(0, h, 3) if dark_at(x, y))
                    if hits > h // 30:
                        return float(x + band)
            elif axis == "right":
                for x in range(w - 1, max(w * 3 // 4, w - 80) - 1, -1):
                    hits = sum(1 for y in range(0, h, 3) if dark_at(x, y))
                    if hits > h // 30:
                        return float(w - x + band)
            elif axis == "top":
                for y in range(0, min(h // 4, 80)):
                    hits = sum(1 for x in range(0, w, 3) if dark_at(x, y))
                    if hits > w // 30:
                        return float(y + band)
            elif axis == "bottom":
                for y in range(h - 1, max(h * 3 // 4, h - 80) - 1, -1):
                    hits = sum(1 for x in range(0, w, 3) if dark_at(x, y))
                    if hits > w // 30:
                        return float(h - y + band)
            return None

        scale = 0.5  # pixmap era Matrix(0.5)
        media = page.mediabox
        # px -> pt da página: pixmap width ≈ media.width * scale
        px_to_pt = float(media.width) / w if w else 1.0

        insets_pt = {
            "left": (scan_edge("left") or 0.0) * px_to_pt,
            "right": (scan_edge("right") or 0.0) * px_to_pt,
            "top": (scan_edge("top") or 0.0) * px_to_pt,
            "bottom": (scan_edge("bottom") or 0.0) * px_to_pt,
        }
        if sum(insets_pt.values()) < 1.0:
            return None
        crop = {
            "top": pt_to_mm(insets_pt["top"]),
            "right": pt_to_mm(insets_pt["right"]),
            "bottom": pt_to_mm(insets_pt["bottom"]),
            "left": pt_to_mm(insets_pt["left"]),
            "source": "marcas",
        }
        validate_crop_against_page(
            pt_to_mm(media.width), pt_to_mm(media.height), crop
        )
        return crop
    except Exception as exc:
        logger.debug("Detecção de marcas falhou: %s", exc)
        return None


def page_crop_meta(page: Any, *, detect_marks: bool = False) -> dict[str, Any]:
    media = page.mediabox
    width_mm = pt_to_mm(media.width)
    height_mm = pt_to_mm(media.height)
    suggested, source = suggested_crop_from_page(page)
    trim = _insets_from_box(media, getattr(page, "trimbox", None))
    bleed = _insets_from_box(media, getattr(page, "bleedbox", None))
    marks = detect_crop_marks_mm(page) if detect_marks else None
    if detect_marks and marks and source == "manual":
        suggested = marks
        source = "marcas"
    # Proxy: spread típico tem largura ≥ ~1.55× a altura.
    likely_spread = width_mm >= max(height_mm * 1.55, 1.0)
    return {
        "widthMm": width_mm,
        "heightMm": height_mm,
        "widthPt": round(float(media.width), 2),
        "heightPt": round(float(media.height), 2),
        "trim": trim,
        "bleed": bleed,
        "suggestedCrop": suggested,
        "suggestionSource": source,
        "likelySpread": likely_spread,
        "cropMarksHint": marks,
    }


def build_pdf_crop_meta(
    pdf_path: str,
    *,
    max_pages: int = 8,
    detect_marks: bool = False,
) -> dict[str, Any]:
    import fitz

    with fitz.open(pdf_path) as doc:
        page_count = len(doc)
        sample = min(page_count, max(1, max_pages))
        pages = []
        for i in range(sample):
            meta = page_crop_meta(doc.load_page(i), detect_marks=detect_marks and i == 0)
            pages.append({"pageIndex": i, **meta})
        first = pages[0] if pages else None
        return {
            "pageCount": page_count,
            "pages": pages,
            "suggestedCrop": (first or {}).get("suggestedCrop") or empty_crop(),
            "suggestionSource": (first or {}).get("suggestionSource") or "manual",
            "likelySpread": bool((first or {}).get("likelySpread")),
            "widthMm": (first or {}).get("widthMm"),
            "heightMm": (first or {}).get("heightMm"),
        }
