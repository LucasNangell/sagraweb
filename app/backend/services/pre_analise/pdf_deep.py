"""Análise aprofundada de PDF (fontes, cores, imagens)."""
from __future__ import annotations

import logging
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from services.pre_analise.pdf_utils import list_pdfs

logger = logging.getLogger(__name__)

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

MIN_IMAGE_DPI = 300
ASPECT_TOLERANCE = 0.04
RESTRICTED_FONT_RE = re.compile(
    r"demo|trial|teste|evaluation|restrict|opcional|não para|nao para|sample|"
    r"versão de demonstração|versao de demonstracao",
    re.IGNORECASE,
)


def require_fitz() -> Optional[str]:
    if fitz is None:
        return "PyMuPDF não está instalado no servidor."
    return None


def iter_pdf_paths(folder_path: str) -> List[str]:
    return [os.path.join(folder_path, n) for n in list_pdfs(folder_path)]


def _font_descriptor_embedded(doc: Any, xref: int) -> bool:
    try:
        extracted = doc.extract_font(xref)
        if extracted and extracted.get("ext"):
            return True
    except Exception:
        pass
    try:
        obj = doc.xref_object(xref)
        if "/FontDescriptor" not in obj:
            if "/DescendantFonts" in obj:
                m = re.search(r"/DescendantFonts\s*\[\s*(\d+)\s+(\d+)\s+R", obj)
                if m:
                    child = int(m.group(1))
                    return _font_descriptor_embedded(doc, child)
            return False
        m = re.search(r"/FontDescriptor\s+(\d+)\s+(\d+)\s+R", obj)
        if not m:
            return False
        fd_xref = int(m.group(1))
        fd = doc.xref_object(fd_xref)
        return any(k in fd for k in ("/FontFile", "/FontFile2", "/FontFile3"))
    except Exception:
        return False


def analyze_document_fonts(doc: Any) -> Dict[str, Any]:
    missing: List[str] = []
    restricted: List[str] = []
    embedded_ok: List[str] = []
    seen: Set[int] = set()

    for pno in range(doc.page_count):
        try:
            font_list = doc.get_page_fonts(pno, full=True)
        except TypeError:
            font_list = doc.get_page_fonts(pno)
        for entry in font_list:
            xref = int(entry[0])
            if xref in seen:
                continue
            seen.add(xref)
            name = str(entry[3] if len(entry) > 3 else entry[1] or f"font-{xref}")
            if RESTRICTED_FONT_RE.search(name):
                restricted.append(name)
            if _font_descriptor_embedded(doc, xref):
                embedded_ok.append(name)
            else:
                missing.append(name)

    return {
        "missing": sorted(set(missing)),
        "restricted": sorted(set(restricted)),
        "embedded": sorted(set(embedded_ok)),
    }


def _page_has_rgb_content(page: Any, doc: Any) -> bool:
    from services.pre_analise.pdf_colorspace import page_has_rgb_content

    has, _ = page_has_rgb_content(page, doc)
    return has


def analyze_document_rgb(doc: Any) -> List[int]:
    """Números das páginas (1-based) com conteúdo RGB detectado."""
    from services.pre_analise.pdf_colorspace import analyze_document_rgb as _analyze_rgb

    return _analyze_rgb(doc)["pages"]


def _image_location_name(
    rect: Any, page_width: float, page_height: float
) -> str:
    """Posição aproximada na página (grade 3×3), como no validador checkimagem."""
    center_x = rect.x0 + (rect.width / 2)
    center_y = rect.y0 + (rect.height / 2)
    third_w = page_width / 3
    third_h = page_height / 3
    if center_y < third_h:
        vert = "Superior"
    elif center_y > (third_h * 2):
        vert = "Inferior"
    else:
        vert = "Central"
    if center_x < third_w:
        horiz = "Esquerda"
    elif center_x > (third_w * 2):
        horiz = "Direita"
    else:
        horiz = "Exato" if vert == "Central" else "Centro"
    return f"{vert} {horiz}"


def _image_dpi_and_distortion(
    page: Any,
    doc: Any,
    xref: int,
    pixel_w: int,
    pixel_h: int,
) -> List[Dict[str, Any]]:
    """Uma entrada por instância da imagem na página (DPI efetivo + distorção)."""
    hits: List[Dict[str, Any]] = []
    if pixel_w < 10 or pixel_h < 10:
        return hits
    try:
        page_w = float(page.rect.width)
        page_h = float(page.rect.height)
        rects = page.get_image_rects(xref)
        for rect in rects:
            display_w_pt = float(rect.width)
            display_h_pt = float(rect.height)
            if display_w_pt < 1 or display_h_pt < 1:
                continue
            dpi_x = round((pixel_w * 72) / display_w_pt)
            dpi_y = round((pixel_h * 72) / display_h_pt)
            dpi = float(min(dpi_x, dpi_y))
            pixel_ar = pixel_w / pixel_h
            display_ar = display_w_pt / display_h_pt
            distorted = (
                abs(pixel_ar - display_ar) / max(pixel_ar, display_ar)
                > ASPECT_TOLERANCE
            )
            hits.append(
                {
                    "dpi": dpi,
                    "distorted": distorted,
                    "location": _image_location_name(rect, page_w, page_h),
                }
            )
    except Exception as exc:
        logger.debug("imagem xref %s: %s", xref, exc)
    return hits


def _dpi_from_display_size(
    pixel_w: int, pixel_h: int, display_w_pt: float, display_h_pt: float
) -> float:
    dpi_x = round((pixel_w * 72) / display_w_pt)
    dpi_y = round((pixel_h * 72) / display_h_pt)
    return float(min(dpi_x, dpi_y))


def analyze_document_images(
    doc: Any,
    min_dpi: float = MIN_IMAGE_DPI,
    *,
    check_distortion: bool = False,
) -> Dict[str, List[Dict[str, Any]]]:
    low_dpi: List[Dict[str, Any]] = []
    distorted: List[Dict[str, Any]] = []
    seen_hits: Set[Tuple[Any, ...]] = set()
    dpi_cache: Dict[Tuple[int, int, int], float] = {}

    for pno in range(doc.page_count):
        page = doc[pno]
        page_w = float(page.rect.width)
        page_h = float(page.rect.height)

        for img in page.get_images(full=True):
            xref = int(img[0])
            pixel_w = int(img[2]) if len(img) > 2 else 0
            pixel_h = int(img[3]) if len(img) > 3 else 0
            if pixel_w < 10 or pixel_h < 10:
                continue
            name = str(img[7] if len(img) > 7 else f"img-{xref}")

            try:
                rects = page.get_image_rects(xref)
            except Exception:
                continue

            for rect in rects:
                display_w_pt = float(rect.width)
                display_h_pt = float(rect.height)
                if display_w_pt < 1 or display_h_pt < 1:
                    continue

                cache_key = (
                    xref,
                    int(display_w_pt * 10),
                    int(display_h_pt * 10),
                )
                dpi = dpi_cache.get(cache_key)
                if dpi is None:
                    dpi = _dpi_from_display_size(
                        pixel_w, pixel_h, display_w_pt, display_h_pt
                    )
                    dpi_cache[cache_key] = dpi

                location = _image_location_name(rect, page_w, page_h)
                hit_key = (pno + 1, xref, location, int(dpi))
                if hit_key in seen_hits:
                    continue
                seen_hits.add(hit_key)

                if dpi < min_dpi:
                    low_dpi.append(
                        {
                            "page": pno + 1,
                            "xref": xref,
                            "name": name,
                            "dpi": dpi,
                            "location": location,
                        }
                    )

                if check_distortion:
                    pixel_ar = pixel_w / pixel_h
                    display_ar = display_w_pt / display_h_pt
                    if (
                        abs(pixel_ar - display_ar) / max(pixel_ar, display_ar)
                        > ASPECT_TOLERANCE
                    ):
                        distorted.append(
                            {
                                "page": pno + 1,
                                "xref": xref,
                                "name": name,
                                "location": location,
                            }
                        )

    return {"low_dpi": low_dpi, "distorted": distorted}


def _page_trim_rect(page: Any) -> Any:
    for box in ("trimbox", "cropbox", "mediabox"):
        try:
            box_val = getattr(page, box)
            if box_val and not box_val.is_empty:
                return fitz.Rect(box_val)
        except Exception:
            continue
    return page.rect


def _point_in_bleed_margin(
    px: float, py: float, trim: Any, media: Any, pad: float = 5.0
) -> bool:
    """Ponto na faixa entre trim e media (sangria técnica), fora do trim."""
    x0, y0, x1, y1 = float(trim.x0), float(trim.y0), float(trim.x1), float(trim.y1)
    mx0, my0, mx1, my1 = float(media.x0), float(media.y0), float(media.x1), float(media.y1)
    outside_trim = px < x0 - pad or px > x1 + pad or py < y0 - pad or py > y1 + pad
    inside_media = mx0 - pad <= px <= mx1 + pad and my0 - pad <= py <= my1 + pad
    in_trim = x0 <= px <= x1 and y0 <= py <= y1
    return outside_trim and inside_media and not in_trim


def _rect_in_bleed_margin(rect: Any, trim: Any, media: Any, pad: float = 5.0) -> bool:
    r = fitz.Rect(rect)
    if r.is_empty:
        return False
    cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    return _point_in_bleed_margin(cx, cy, trim, media, pad)


def _segment_in_margin(seg: Any, trim: Any, media: Any, margin_pt: float) -> bool:
    """Traço na faixa entre trim e media (sangria técnica)."""
    for px, py in ((seg.mid_x, seg.mid_y), (seg.x1, seg.y1), (seg.x2, seg.y2)):
        if _point_in_bleed_margin(px, py, trim, media, margin_pt):
            return True
    return False


# Marca de registro: braços da cruz ~6–45 pt
_REG_ARM_MIN_PT = 6.0
_REG_ARM_MAX_PT = 45.0
_REG_CROSS_TOL_PT = 8.0
# Barra de cor: faixa longa ou ≥3 patches alinhados
_COLOR_BAR_LONG_PT = 70.0
_COLOR_BAR_THIN_PT = 28.0
_COLOR_BAR_MIN_PATCHES = 3
_COLOR_BAR_ALIGN_TOL_PT = 4.0

_TEXT_COLOR_BAR_RE = re.compile(
    r"CALIBR|COLOR\s*BAR|BARRA\s*(DE\s*)?COR|TIRA\s*DE\s*COR|PROOF\s*BAR|"
    r"COLOR\s*GUIDE|ESCALA\s*DE\s*COR",
    re.IGNORECASE,
)
_TEXT_REGISTRATION_RE = re.compile(
    r"REGIST(RATION|RO)?|MARCA\s*DE\s*REGISTRO|TARGET|ALINHAMENTO",
    re.IGNORECASE,
)


def _cross_at_trim_corner(
    h: Any, v: Any, trim: Any, media: Any
) -> bool:
    """Cantoneira de corte (cruz no canto da sangria) não é marca de registro."""
    cx = (h.mid_x + v.mid_x) / 2
    cy = (h.mid_y + v.mid_y) / 2
    corners = (
        (float(trim.x0), float(trim.y0)),
        (float(trim.x1), float(trim.y0)),
        (float(trim.x0), float(trim.y1)),
        (float(trim.x1), float(trim.y1)),
    )
    bleed = max(
        float(trim.x0 - media.x0),
        float(media.x1 - trim.x1),
        float(trim.y0 - media.y0),
        float(media.y1 - trim.y1),
        12.0,
    )
    corner_band = bleed * 1.8 + 8.0
    for tx, ty in corners:
        if abs(cx - tx) <= corner_band and abs(cy - ty) <= corner_band:
            return True
    return False


def _detect_registration_cross(
    segments_in_margin: List[Any], trim: Any, media: Any
) -> bool:
    """Cruz de registro no centro da sangria (não nos cantos de marcas de corte)."""
    horiz = [
        s
        for s in segments_in_margin
        if s.horizontal and _REG_ARM_MIN_PT <= s.length_pt <= _REG_ARM_MAX_PT
    ]
    vert = [
        s
        for s in segments_in_margin
        if s.vertical and _REG_ARM_MIN_PT <= s.length_pt <= _REG_ARM_MAX_PT
    ]
    for h in horiz:
        for v in vert:
            if (
                abs(h.mid_x - v.mid_x) <= _REG_CROSS_TOL_PT
                and abs(h.mid_y - v.mid_y) <= _REG_CROSS_TOL_PT
            ):
                if _cross_at_trim_corner(h, v, trim, media):
                    continue
                return True
    return False


def _detect_registration_circle(drawings_in_margin: List[Dict[str, Any]]) -> bool:
    """Círculo pequeno na sangria (alvo de registro)."""
    for d in drawings_in_margin:
        rect = d.get("rect")
        if rect is None:
            continue
        r = fitz.Rect(rect)
        w, h = r.width, r.height
        if w < 4 or h < 4 or w > 35 or h > 35:
            continue
        aspect = w / h if h else 0
        if 0.7 <= aspect <= 1.35 and d.get("fill") is not None:
            return True
        items = d.get("items") or []
        curves = sum(1 for it in items if it and it[0] == "c")
        if curves >= 2 and 0.75 <= aspect <= 1.33:
            return True
    return False


def _cluster_rects_by_axis(
    rects: List[Any], axis: str, tol: float
) -> List[List[Any]]:
    """Agrupa retângulos alinhados em faixa horizontal (axis='y') ou vertical ('x')."""
    if not rects:
        return []
    key_fn = lambda r: (fitz.Rect(r).y0 + fitz.Rect(r).y1) / 2 if axis == "y" else (
        (fitz.Rect(r).x0 + fitz.Rect(r).x1) / 2
    )
    ordered = sorted(rects, key=key_fn)
    clusters: List[List[Any]] = [[ordered[0]]]
    for r in ordered[1:]:
        if abs(key_fn(r) - key_fn(clusters[-1][-1])) <= tol:
            clusters[-1].append(r)
        else:
            clusters.append([r])
    return clusters


def _is_color_bar_patch_row(rects: List[Any]) -> bool:
    """Três ou mais retângulos preenchidos alinhados (típico de barra CMYK)."""
    if len(rects) < _COLOR_BAR_MIN_PATCHES:
        return False
    sizes = [fitz.Rect(r) for r in rects]
    heights = [r.height for r in sizes]
    widths = [r.width for r in sizes]
    avg_h = sum(heights) / len(heights)
    avg_w = sum(widths) / len(widths)
    if avg_h < 3 or avg_w < 3:
        return False
    # Patches semelhantes em altura (faixa horizontal) ou largura (vertical)
    h_ok = all(abs(h - avg_h) <= avg_h * 0.6 + 2 for h in heights)
    w_ok = all(abs(w - avg_w) <= avg_w * 0.6 + 2 for w in widths)
    return h_ok or w_ok


def _is_long_color_bar_rect(rect: Any) -> bool:
    """Faixa única longa e fina (barra de calibragem)."""
    r = fitz.Rect(rect)
    long_side = max(r.width, r.height)
    short_side = min(r.width, r.height)
    return long_side >= _COLOR_BAR_LONG_PT and short_side <= _COLOR_BAR_THIN_PT


def _detect_color_calibration_bar(
    drawings_in_margin: List[Dict[str, Any]],
) -> bool:
    filled_rects: List[Any] = []
    for d in drawings_in_margin:
        if d.get("fill") is None and d.get("color") is None:
            continue
        rect = d.get("rect")
        if rect is None:
            continue
        r = fitz.Rect(rect)
        if r.width < 2 or r.height < 2:
            continue
        if _is_long_color_bar_rect(r):
            return True
        filled_rects.append(r)
    for axis in ("y", "x"):
        for cluster in _cluster_rects_by_axis(
            filled_rects, axis, _COLOR_BAR_ALIGN_TOL_PT
        ):
            if _is_color_bar_patch_row(cluster):
                return True
    return False


def _detect_color_bar_image(page: Any, trim: Any, media: Any) -> bool:
    """Imagem em faixa na sangria (barra rasterizada)."""
    try:
        for img in page.get_images(full=True):
            xref = int(img[0])
            for rect in page.get_image_rects(xref):
                if not _rect_in_bleed_margin(rect, trim, media):
                    continue
                r = fitz.Rect(rect)
                long_side = max(r.width, r.height)
                short_side = min(r.width, r.height)
                if long_side >= _COLOR_BAR_LONG_PT and short_side <= _COLOR_BAR_THIN_PT * 1.5:
                    return True
    except Exception:
        pass
    return False


def _text_in_bleed_margin(page: Any, trim: Any, media: Any) -> List[str]:
    """Texto de barra de cor ou registro na sangria."""
    found: List[str] = []
    try:
        blocks = page.get_text("blocks")
        for block in blocks:
            if len(block) < 5:
                continue
            x0, y0, x1, y1, text = block[0], block[1], block[2], block[3], block[4]
            mid_x, mid_y = (x0 + x1) / 2, (y0 + y1) / 2
            if not _point_in_bleed_margin(mid_x, mid_y, trim, media, 5):
                continue
            t = (text or "").strip()
            if _TEXT_COLOR_BAR_RE.search(t):
                found.append("barra de calibragem de cor (texto)")
            if _TEXT_REGISTRATION_RE.search(t):
                found.append("marca de registro (texto)")
    except Exception:
        pass
    return found


def analyze_bleed_excess(page: Any) -> List[str]:
    """
    Detecta apenas barra de calibragem de cor ou marcas de registro na sangria.

    Não alerta por marcas de corte, elementos vetoriais genéricos ou conteúdo comum.
    """
    from services.pre_analise.crop_marks import collect_crop_mark_segments

    issues: List[str] = []
    if fitz is None:
        return issues

    trim = _page_trim_rect(page)
    media = fitz.Rect(page.mediabox)
    if media.width <= trim.width + 6 and media.height <= trim.height + 6:
        return issues

    segments = collect_crop_mark_segments(page)
    margin_segments = [s for s in segments if _segment_in_margin(s, trim, media, 8)]

    drawings_in_margin: List[Dict[str, Any]] = []
    try:
        for d in page.get_drawings():
            rect = d.get("rect")
            if rect and _rect_in_bleed_margin(rect, trim, media, 8):
                drawings_in_margin.append(d)
    except Exception:
        pass

    if _detect_registration_cross(margin_segments, trim, media):
        issues.append("marca de registro (cruz) na área de sangria")
    if _detect_registration_circle(drawings_in_margin):
        issues.append("marca de registro (círculo/alvo) na área de sangria")
    if _detect_color_calibration_bar(drawings_in_margin):
        issues.append("barra de calibragem de cor na área de sangria")
    if _detect_color_bar_image(page, trim, media):
        issues.append("barra de calibragem de cor (imagem) na área de sangria")

    for label in _text_in_bleed_margin(page, trim, media):
        if label not in issues:
            issues.append(label)

    return issues


def parse_os_cores_esperado(cores: Optional[str], cores_desc: Optional[str] = None) -> Dict[str, Any]:
    text = f"{cores or ''} {cores_desc or ''}".upper()
    pb_only = bool(
        re.search(r"\bP\s*[&.]\s*B\b|\bPB\b|PRETO\s*E\s*BRANCO|MONOCROM", text)
    ) and not re.search(r"4\s*/\s*4|POLICROM|COLOR|4\s*COR", text)
    color_expected = bool(
        re.search(r"4\s*/\s*4|POLICROM|COLOR|CMYK|4\s*COR|QUATRO\s*COR", text)
    )
    if not pb_only and not color_expected:
        if "COR" in text or "COLOR" in text:
            color_expected = True
    return {
        "raw": text.strip(),
        "pb_only": pb_only,
        "color_expected": color_expected,
        "unknown": not pb_only and not color_expected,
    }


def _page_appears_color(page: Any, doc: Any) -> bool:
    """Página com conteúdo colorido (RGB ou CMYK), não apenas cinza."""
    if _page_has_rgb_content(page, doc):
        return True
    try:
        from services.pre_analise.pdf_colorspace import colorspace_from_image_tuple

        for img in page.get_images(full=True):
            cs, _ = colorspace_from_image_tuple(doc, img)
            if "cmyk" in cs or cs == "devicecmyk":
                return True
    except Exception:
        pass
    return False


def analyze_document_color_vs_pb(doc: Any) -> List[int]:
    pages: List[int] = []
    for i in range(doc.page_count):
        if _page_appears_color(doc.load_page(i), doc):
            pages.append(i + 1)
    return pages
