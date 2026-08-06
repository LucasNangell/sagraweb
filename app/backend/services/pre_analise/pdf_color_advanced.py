"""
Análise avançada de cores em PDF (CMYK, TAC, separações, ICC).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

PT_TO_MM = 25.4 / 72.0
TAC_LIMIT = 280.0
CMY_BLACK_TEXT_THRESHOLD = 0.05  # 5% em cada canal
K_NOT_PURE_THRESHOLD = 0.95  # K < 95% com CMY presente
CYAN_CALCO_THRESHOLD = 0.15  # 15% C em objeto preto
GRAY_CMYK_TOLERANCE = 0.08

def _sample_matrix() -> Any:
    return fitz.Matrix(0.35, 0.35) if fitz else None

_CMYK_OP_RE = re.compile(
    r"(?P<c>[0-9.]+)\s+(?P<m>[0-9.]+)\s+(?P<y>[0-9.]+)\s+(?P<k>[0-9.]+)\s+k\b"
)
_CMYK_ALT_RE = re.compile(
    r"(?P<c>[0-9.]+)\s+(?P<m>[0-9.]+)\s+(?P<y>[0-9.]+)\s+k\b"
)
_SCN_CMYK_RE = re.compile(
    r"/(?:DeviceCMYK|CMYK)\s+cs.*?([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+scn",
    re.DOTALL,
)


def _page_content_bytes(page: Any, doc: Any) -> bytes:
    try:
        return page.read_contents() or b""
    except Exception:
        pass
    parts: List[bytes] = []
    try:
        for xref in page.get_contents() or []:
            parts.append(doc.xref_stream(xref) or b"")
    except Exception:
        pass
    return b"".join(parts)


def _parse_cmyk_ops(content: bytes) -> List[Tuple[float, float, float, float]]:
    text = content.decode("latin-1", errors="ignore")
    out: List[Tuple[float, float, float, float]] = []
    for m in _CMYK_OP_RE.finditer(text):
        out.append(
            (float(m.group("c")), float(m.group("m")), float(m.group("y")), float(m.group("k")))
        )
    for m in _CMYK_ALT_RE.finditer(text):
        out.append(
            (float(m.group("c")), float(m.group("m")), float(m.group("y")), 1.0)
        )
    return out


def _colorspace_label(doc: Any, xref: int) -> str:
    try:
        from services.pre_analise.pdf_colorspace import colorspace_from_image_tuple

        for pno in range(doc.page_count):
            page = doc.load_page(pno)
            for img in page.get_images(full=True):
                if int(img[0]) == xref:
                    cs, alt = colorspace_from_image_tuple(doc, img)
                    return cs + (f" ({alt})" if alt else "")
    except Exception:
        pass
    try:
        obj = doc.xref_object(xref).upper()
        if "/DEVICECMYK" in obj:
            return "DeviceCMYK"
        if "/DEVICEGRAY" in obj:
            return "DeviceGray"
        if "/DEVICERGB" in obj:
            return "DeviceRGB"
        if "/ICCBASED" in obj:
            n = re.search(r"/N\s+(\d+)", obj)
            if n:
                return f"ICCBased(N={n.group(1)})"
    except Exception:
        pass
    return "Unknown"


def analyze_rgb_elements(doc: Any) -> Dict[str, Any]:
    """DeviceRGB/ICC por imagem e operadores rg/RG (via pdf_colorspace)."""
    from services.pre_analise.pdf_colorspace import analyze_rgb_elements as _analyze

    return _analyze(doc)


def _is_rich_black(c: float, m: float, y: float, k: float) -> bool:
    if k < K_NOT_PURE_THRESHOLD and max(c, m, y) > CMY_BLACK_TEXT_THRESHOLD:
        return True
    if max(c, m, y) > CMY_BLACK_TEXT_THRESHOLD and k >= K_NOT_PURE_THRESHOLD:
        if c > CMY_BLACK_TEXT_THRESHOLD or m > CMY_BLACK_TEXT_THRESHOLD or y > CMY_BLACK_TEXT_THRESHOLD:
            return True
    return False


def _has_cyan_calco(c: float, m: float, y: float, k: float) -> bool:
    """Preto com excesso de ciano."""
    if k < 0.5:
        return False
    if c >= CYAN_CALCO_THRESHOLD and c > m * 1.2 and c > y * 1.2:
        return True
    return False


def analyze_black_in_four_color(
    doc: Any, include_paths: bool = False
) -> Dict[str, Any]:
    """Texto/objetos pretos em quatro cores via operadores CMYK no content stream."""
    text_hits: List[Dict[str, Any]] = []
    path_hits: List[Dict[str, Any]] = []
    calco_hits: List[Dict[str, Any]] = []

    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        content = _page_content_bytes(page, doc)
        ops = _parse_cmyk_ops(content)
        for c, m, y, k in ops:
            if _is_rich_black(c, m, y, k):
                entry = {"page": pno + 1, "cmyk": [c, m, y, k]}
                text_hits.append(entry)
            if _has_cyan_calco(c, m, y, k):
                calco_hits.append({"page": pno + 1, "cmyk": [c, m, y, k]})

        if include_paths:
            try:
                for d in page.get_drawings():
                    fill = d.get("fill")
                    if isinstance(fill, (list, tuple)) and len(fill) >= 4:
                        c, m, y, k = (float(fill[0]), float(fill[1]), float(fill[2]), float(fill[3]))
                        if _is_rich_black(c, m, y, k):
                            path_hits.append({"page": pno + 1, "cmyk": [c, m, y, k]})
            except Exception:
                pass

        # Texto com cor embutida (dict)
        try:
            d = page.get_text("dict")
            for block in d.get("blocks") or []:
                for line in block.get("lines") or []:
                    for span in line.get("spans") or []:
                        col = span.get("color")
                        if col is None:
                            continue
                        # Cor escura não pura (heurística sRGB embutida)
                        r = (col >> 16) & 0xFF
                        g = (col >> 8) & 0xFF
                        b = col & 0xFF
                        if r < 40 and g < 40 and b < 40 and (r > 2 or g > 2 or b > 2):
                            text_hits.append(
                                {
                                    "page": pno + 1,
                                    "texto": (span.get("text") or "")[:40],
                                    "rgb_embedded": [r, g, b],
                                }
                            )
        except Exception:
            pass

    return {
        "text_hits": text_hits[:50],
        "path_hits": path_hits[:50],
        "calco_hits": calco_hits[:50],
        "text_count": len(text_hits),
        "path_count": len(path_hits),
        "calco_count": len(calco_hits),
    }


def _image_is_gray_cmyk(doc: Any, xref: int) -> bool:
    try:
        img = doc.extract_image(xref)
        cs = img.get("colorspace")
        if cs not in (4, "CMYK", "DeviceCMYK"):
            return False
        # Amostra via pixmap
        pix = fitz.Pixmap(doc, xref)
        if pix.n < 4:
            pix = None
            return False
        samples = min(pix.width * pix.height, 40000)
        step = max(1, (pix.width * pix.height) // samples)
        idx = 0
        gray_like = 0
        color_like = 0
        for i in range(0, pix.samples_size, pix.n * step):
            if i + 3 >= len(pix.samples):
                break
            c, m, y, k = (
                pix.samples[i] / 255.0,
                pix.samples[i + 1] / 255.0,
                pix.samples[i + 2] / 255.0,
                pix.samples[i + 3] / 255.0,
            )
            if abs(c - m) < GRAY_CMYK_TOLERANCE and abs(m - y) < GRAY_CMYK_TOLERANCE:
                if c > 0.02 or k > 0.02:
                    gray_like += 1
            else:
                color_like += 1
            idx += 1
            if idx > 500:
                break
        return gray_like > 20 and color_like < gray_like * 0.15
    except Exception:
        return False


def analyze_gray_images_in_cmyk(doc: Any) -> List[Dict[str, Any]]:
    hits: List[Dict[str, Any]] = []
    seen: Set[Tuple[int, int]] = set()
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        for img in page.get_images(full=True):
            xref = int(img[0])
            key = (pno + 1, xref)
            if key in seen:
                continue
            seen.add(key)
            if _image_is_gray_cmyk(doc, xref):
                hits.append({"page": pno + 1, "xref": xref})
    return hits


def _sample_pages(doc: Any, max_pages: int = 12) -> List[int]:
    n = doc.page_count
    if n <= max_pages:
        return list(range(n))
    indices = {0, n - 1, n // 2, n // 4, 3 * n // 4}
    step = max(1, n // (max_pages - 2))
    for i in range(0, n, step):
        indices.add(i)
    return sorted(indices)[:max_pages]


def analyze_tac(doc: Any, limit: float = TAC_LIMIT) -> Dict[str, Any]:
    """TAC máximo por amostragem de páginas renderizadas em CMYK."""
    max_tac = 0.0
    worst: Optional[Dict[str, Any]] = None
    if fitz is None:
        return {"max_tac": 0, "over_limit": False, "pages_sampled": 0}

    for pno in _sample_pages(doc):
        page = doc.load_page(pno)
        try:
            pix = page.get_pixmap(matrix=_sample_matrix(), colorspace=fitz.csCMYK, alpha=False)
        except Exception:
            continue
        n = pix.n
        if n < 4:
            continue
        step = max(1, (pix.width * pix.height) // 8000)
        for i in range(0, pix.width * pix.height, step):
            off = i * n
            if off + 3 >= len(pix.samples):
                break
            c = pix.samples[off] / 255.0 * 100
            m = pix.samples[off + 1] / 255.0 * 100
            y = pix.samples[off + 2] / 255.0 * 100
            k = pix.samples[off + 3] / 255.0 * 100
            tac = c + m + y + k
            if tac > max_tac:
                max_tac = tac
                worst = {"page": pno + 1, "tac": round(tac, 1)}
            if max_tac > limit:
                break
        if max_tac > limit:
            break

    return {
        "max_tac": round(max_tac, 1),
        "over_limit": max_tac > limit,
        "limit": limit,
        "worst": worst,
        "pages_sampled": len(_sample_pages(doc)),
    }


def analyze_colorspace_consistency(doc: Any) -> List[str]:
    """Mistura inconsistente de ICC/DeviceN entre páginas."""
    per_page: List[Set[str]] = []
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        spaces: Set[str] = set()
        for img in page.get_images(full=True):
            spaces.add(_colorspace_label(doc, int(img[0])))
        content = _page_content_bytes(page, doc).decode("latin-1", errors="ignore")
        if "/DEVICERGB" in content.upper():
            spaces.add("DeviceRGB")
        if "/DEVICECMYK" in content.upper() or _CMYK_OP_RE.search(content):
            spaces.add("DeviceCMYK")
        if "/DEVICEN" in content.upper():
            spaces.add("DeviceN")
        per_page.append(spaces)

    issues: List[str] = []
    all_spaces: Set[str] = set()
    for s in per_page:
        all_spaces |= s
    if "DeviceRGB" in all_spaces and "DeviceCMYK" in all_spaces:
        issues.append("documento mistura DeviceRGB e DeviceCMYK")
    rgb_pages = [i + 1 for i, s in enumerate(per_page) if "DeviceRGB" in s]
    cmyk_only = [i + 1 for i, s in enumerate(per_page) if s == {"DeviceCMYK"}]
    if rgb_pages and cmyk_only and len(rgb_pages) < doc.page_count * 0.9:
        issues.append(
            f"páginas RGB ({len(rgb_pages)}) coexistem com páginas só CMYK ({len(cmyk_only)})"
        )
    icc_variants = set()
    for pno in range(doc.page_count):
        for img in doc.load_page(pno).get_images(full=True):
            lab = _colorspace_label(doc, int(img[0]))
            if lab.startswith("ICCBased"):
                icc_variants.add(lab)
    if len(icc_variants) > 2:
        issues.append(f"múltiplos perfis ICC: {', '.join(sorted(icc_variants)[:4])}")
    return issues
