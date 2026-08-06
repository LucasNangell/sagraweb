"""
Heurísticas de layout: margem, furos, dobra, imposição, capa+miolo no mesmo PDF.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

PT_TO_MM = 25.4 / 72.0
MIN_CONTENT_MARGIN_MM = 7.0
HOLE_MAX_RADIUS_PT = 25.0
HOLE_EDGE_ZONE_RATIO = 0.12
FOLD_LINE_MIN_PT = 40.0
# Placas de fundo / sangria que cobrem a página — não são “mancha” a validar
_BG_COVER_WIDTH_RATIO = 0.82
_BG_COVER_HEIGHT_RATIO = 0.82
_BG_COVER_AREA_RATIO = 0.55
_BLEED_ONLY_TOL_PT = 1.5


def _page_trim_rect(page: Any) -> Any:
    """TrimBox quando definida; senão caixa calculada por marcas ou MediaBox."""
    from services.pre_analise.crop_marks import _trim_box_rect, compute_trim_rect_from_marks

    tb = _trim_box_rect(page)
    if tb is not None:
        return tb
    rect = compute_trim_rect_from_marks(page)
    if rect is not None:
        return rect
    for box in ("cropbox", "mediabox"):
        try:
            box_val = getattr(page, box)
            if box_val and not box_val.is_empty:
                return fitz.Rect(box_val)
        except Exception:
            continue
    return page.rect


def _page_media_rect(page: Any) -> Any:
    media = fitz.Rect(page.mediabox)
    if media.is_empty or media.is_infinite:
        return page.rect
    return media


def _is_bleed_plate(rect: Any, trim: Any) -> bool:
    """
    Ignora fundos de sangria e placas que cobrem a área de corte.

    Conteúdo só na sangria (fora do trim) também é ignorado — é esperado em PDF de impressão.
    """
    inner = rect & trim
    if inner.is_empty:
        return True
    if inner.width >= trim.width * _BG_COVER_WIDTH_RATIO:
        return True
    if inner.height >= trim.height * _BG_COVER_HEIGHT_RATIO:
        return True
    if inner.width * inner.height >= trim.width * trim.height * _BG_COVER_AREA_RATIO:
        return True
    return False


def _margins_inside_trim(rect: Any, trim: Any) -> Optional[Dict[str, float]]:
    """Distâncias (pt) do retângulo às bordas do trim, só para a parte dentro do trim."""
    inner = rect & trim
    if inner.is_empty:
        return None
    return {
        "esquerda": float(inner.x0 - trim.x0),
        "direita": float(trim.x1 - inner.x1),
        "topo": float(inner.y0 - trim.y0),
        "base": float(trim.y1 - inner.y1),
    }


def _side_label(side: str) -> str:
    return side


def _check_rect_margin(
    rect: Any,
    trim: Any,
    min_pt: float,
    tipo: str,
    page_num: int,
    hits: List[Dict[str, Any]],
    seen: set,
) -> None:
    if rect.is_empty or _is_bleed_plate(rect, trim):
        return
    margins = _margins_inside_trim(rect, trim)
    if margins is None:
        return
    for side, dist_pt in margins.items():
        if dist_pt < 0:
            continue
        if dist_pt >= min_pt:
            continue
        key = (page_num, side, tipo, round(dist_pt, 1))
        if key in seen:
            continue
        seen.add(key)
        hits.append(
            {
                "page": page_num,
                "lado": _side_label(side),
                "mm": round(dist_pt * PT_TO_MM, 2),
                "tipo": tipo,
            }
        )


def _drawing_in_bleed_only(d: Dict[str, Any], trim: Any, media: Any) -> bool:
    """Marca de corte / elemento só na sangria técnica."""
    from services.pre_analise.pdf_deep import _rect_in_bleed_margin

    rect = d.get("rect")
    if rect is None:
        return False
    r = fitz.Rect(rect)
    if r.is_empty:
        return False
    inner = r & trim
    if not inner.is_empty and inner.width * inner.height > 4:
        return False
    return _rect_in_bleed_margin(r, trim, media, _BLEED_ONLY_TOL_PT)


def analyze_content_margin(doc: Any, min_mm: float = MIN_CONTENT_MARGIN_MM) -> List[Dict[str, Any]]:
    """
    Textos e elementos gráficos (não fundo de sangria) a menos de min_mm da linha de corte (trim).
    """
    hits: List[Dict[str, Any]] = []
    min_pt = min_mm / PT_TO_MM
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        trim = _page_trim_rect(page)
        media = _page_media_rect(page)
        seen: set = set()
        page_num = pno + 1

        try:
            for block in page.get_text("blocks"):
                if len(block) < 4:
                    continue
                text = (block[4] or "").strip()
                if not text:
                    continue
                r = fitz.Rect(block[0], block[1], block[2], block[3])
                _check_rect_margin(r, trim, min_pt, "texto", page_num, hits, seen)
        except Exception:
            pass

        try:
            for img in page.get_images(full=True):
                xref = int(img[0])
                for rect in page.get_image_rects(xref):
                    _check_rect_margin(
                        fitz.Rect(rect), trim, min_pt, "imagem", page_num, hits, seen
                    )
        except Exception:
            pass

        try:
            for d in page.get_drawings():
                if _drawing_in_bleed_only(d, trim, media):
                    continue
                dr = d.get("rect")
                if dr is None:
                    continue
                _check_rect_margin(
                    fitz.Rect(dr), trim, min_pt, "vetor", page_num, hits, seen
                )
        except Exception:
            pass

    return hits


def _content_bbox(page: Any) -> Optional[Any]:
    """União bruta de texto, vetores e imagens (uso em heurísticas de imposição)."""
    try:
        blocks = page.get_text("blocks")
        drawings = page.get_drawings()
    except Exception:
        return None
    union = None
    for block in blocks:
        if len(block) < 4:
            continue
        r = fitz.Rect(block[0], block[1], block[2], block[3])
        if r.is_empty:
            continue
        union = r if union is None else union | r
    for d in drawings:
        dr = d.get("rect")
        if dr is not None:
            r = fitz.Rect(dr)
            if not r.is_empty:
                union = r if union is None else union | r
    for img in page.get_images(full=True):
        xref = int(img[0])
        try:
            for rect in page.get_image_rects(xref):
                union = fitz.Rect(rect) if union is None else union | fitz.Rect(rect)
        except Exception:
            pass
    return union


def _is_small_circle_path(d: Dict[str, Any]) -> bool:
    items = d.get("items") or []
    if len(items) < 2:
        return False
    rect = d.get("rect")
    if rect is None:
        return False
    r = fitz.Rect(rect)
    w, h = r.width, r.height
    if w < 2 or h < 2 or w > HOLE_MAX_RADIUS_PT * 2 or h > HOLE_MAX_RADIUS_PT * 2:
        return False
    aspect = w / h if h else 0
    return 0.75 <= aspect <= 1.33


def analyze_holes_near_trim(doc: Any) -> List[Dict[str, Any]]:
    """Círculos/pequenos paths perto da borda (furos)."""
    hits: List[Dict[str, Any]] = []
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        trim = _page_trim_rect(page)
        zx = trim.width * HOLE_EDGE_ZONE_RATIO
        zy = trim.height * HOLE_EDGE_ZONE_RATIO
        for d in page.get_drawings():
            if not _is_small_circle_path(d):
                continue
            rect = fitz.Rect(d.get("rect"))
            cx, cy = (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2
            near_edge = (
                cx <= trim.x0 + zx
                or cx >= trim.x1 - zx
                or cy <= trim.y0 + zy
                or cy >= trim.y1 - zy
            )
            if near_edge:
                hits.append(
                    {
                        "page": pno + 1,
                        "bbox_pt": [rect.x0, rect.y0, rect.x1, rect.y1],
                    }
                )
    return hits


def analyze_fold_marks(doc: Any) -> Dict[str, Any]:
    """Linhas de dobra (traços longos no centro ou terços)."""
    from services.pre_analise.crop_marks import collect_crop_mark_segments

    lines: List[Dict[str, Any]] = []
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        trim = _page_trim_rect(page)
        mid_x = (trim.x0 + trim.x1) / 2
        mid_y = (trim.y0 + trim.y1) / 2
        for seg in collect_crop_mark_segments(page):
            if seg.length_pt < FOLD_LINE_MIN_PT:
                continue
            if seg.vertical and abs(seg.mid_x - mid_x) < trim.width * 0.05:
                lines.append({"page": pno + 1, "tipo": "vertical_centro"})
            if seg.horizontal and abs(seg.mid_y - mid_y) < trim.height * 0.05:
                lines.append({"page": pno + 1, "tipo": "horizontal_centro"})
    return {"fold_lines": lines, "has_fold_marks": len(lines) > 0}


def analyze_imposition(doc: Any) -> List[Dict[str, Any]]:
    """Várias áreas de conteúdo lado a lado na mesma MediaBox."""
    hits: List[Dict[str, Any]] = []
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        media = fitz.Rect(page.mediabox)
        trim = _page_trim_rect(page)
        if media.width > trim.width * 1.55:
            content = _content_bbox(page)
            if content and content.width > trim.width * 0.85:
                hits.append(
                    {
                        "page": pno + 1,
                        "motivo": "MediaBox muito mais larga que TrimBox com conteúdo amplo",
                        "media_mm": round(media.width * PT_TO_MM, 1),
                        "trim_mm": round(trim.width * PT_TO_MM, 1),
                    }
                )
        # Clusters de texto em metades esquerda/direita
        try:
            blocks = page.get_text("blocks")
            left, right = 0, 0
            mid = (media.x0 + media.x1) / 2
            for b in blocks:
                if len(b) < 4:
                    continue
                cx = (b[0] + b[2]) / 2
                if cx < mid:
                    left += 1
                else:
                    right += 1
            if left >= 5 and right >= 5 and media.width > trim.width * 1.4:
                hits.append(
                    {
                        "page": pno + 1,
                        "motivo": "conteúdo em duas colunas/regiões (possível imposição)",
                    }
                )
        except Exception:
            pass
    return hits


def analyze_capa_miolo_junto(
    doc: Any, expects_separate: bool
) -> Optional[Dict[str, Any]]:
    """
    Um PDF com N páginas; heurística 4 primeiras = capa quando OS exige separado.
    """
    if not expects_separate:
        return None
    if doc.page_count <= 4:
        return None
    capa_hint = doc.page_count >= 8
    if not capa_hint:
        return None
    # Dimensões das 4 primeiras vs restante
    p1 = doc.load_page(0).rect
    p5 = doc.load_page(4).rect if doc.page_count > 4 else p1
    same_size = abs(p1.width - p5.width) < 2 and abs(p1.height - p5.height) < 2
    return {
        "page_count": doc.page_count,
        "capa_pages_heuristic": 4,
        "same_trim_as_miolo": same_size,
        "message": (
            f"PDF único com {doc.page_count} páginas; as 4 primeiras podem ser capa "
            f"e o restante miolo, mas a OS indica capa e miolo em arquivos separados."
        ),
    }


def is_folder_product(os_details: Dict[str, Any]) -> bool:
    text = f"{os_details.get('DescAcabamento') or ''} {os_details.get('TipoPublicacaoLink') or ''}"
    return bool(re.search(r"folder|dobrad|panfleto\s+dobr", text, re.IGNORECASE))
