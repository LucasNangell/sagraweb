"""
Heurísticas de texto: numeração, editoração, fontes rasterizadas, OCR leve.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

PAGE_NUM_RE = re.compile(r"^\s*(\d{1,4})\s*$")
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
SUMARIO_RE = re.compile(r"\bSUM[AÁ]RIO\b", re.IGNORECASE)
INDICE_RE = re.compile(r"\b[IÍ]NDICE\b", re.IGNORECASE)
PARLAMENTAR_RE = re.compile(
    r"\b(SENADOR|SENADORA|DEPUTADO|DEPUTADA|VEREADOR|VEREADORA)\b",
    re.IGNORECASE,
)
NAME_AFTER_TITLE_RE = re.compile(
    r"(?:Senador|Senadora|Deputado|Deputada)\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+)+)",
    re.IGNORECASE,
)


def _footer_zone(page: Any, ratio: float = 0.08) -> Tuple[float, float, float, float]:
    r = page.rect
    h = r.height * ratio
    return (r.x0, r.y1 - h, r.x1, r.y1)


def _header_zone(page: Any, ratio: float = 0.08) -> Tuple[float, float, float, float]:
    r = page.rect
    h = r.height * ratio
    return (r.x0, r.y0, r.x1, r.y0 + h)


def _text_in_rect(page: Any, rect: Tuple[float, float, float, float]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    try:
        blocks = page.get_text("blocks", clip=fitz.Rect(rect))
        for block in blocks:
            if len(block) < 5:
                continue
            x0, y0, x1, y1, text = block[0], block[1], block[2], block[3], block[4]
            t = (text or "").strip()
            if not t:
                continue
            items.append(
                {
                    "text": t,
                    "bbox": (x0, y0, x1, y1),
                    "cx": (x0 + x1) / 2,
                    "cy": (y0 + y1) / 2,
                }
            )
    except Exception:
        pass
    return items


def _extract_page_number_candidates(items: List[Dict[str, Any]]) -> List[int]:
    nums: List[int] = []
    for it in items:
        for line in it["text"].splitlines():
            m = PAGE_NUM_RE.match(line.strip())
            if m:
                n = int(m.group(1))
                if 1 <= n <= 9999:
                    nums.append(n)
    return nums


def analyze_page_numbering(doc: Any) -> Dict[str, Any]:
    """Numeração ausente, excessiva ou posição ímpar/par."""
    missing: List[int] = []
    excess: List[Dict[str, Any]] = []
    misaligned: List[Dict[str, Any]] = []
    pretext_skip = 10

    for pno in range(doc.page_count):
        if pno < pretext_skip:
            continue
        page = doc.load_page(pno)
        footer = _text_in_rect(page, _footer_zone(page))
        nums = _extract_page_number_candidates(footer)
        if not nums:
            missing.append(pno + 1)
            continue
        expected = pno + 1 - pretext_skip  # heurística: miolo após pré-textuais
        for n in nums:
            if n > doc.page_count * 2:
                excess.append({"page": pno + 1, "numero": n, "motivo": "valor muito alto"})
            elif abs(n - expected) > 15 and n != pno + 1:
                excess.append(
                    {
                        "page": pno + 1,
                        "numero": n,
                        "motivo": f"fora da sequência esperada (~{expected})",
                    }
                )
        # Par/ímpar: ímpar à direita, par à esquerda (miolo brasileiro comum)
        page_num = pno + 1
        mid_x = page.rect.width / 2
        for it in footer:
            for line in it["text"].splitlines():
                m = PAGE_NUM_RE.match(line.strip())
                if not m:
                    continue
                if page_num % 2 == 1 and it["cx"] < mid_x * 0.55:
                    misaligned.append(
                        {
                            "page": page_num,
                            "motivo": "página ímpar com número à esquerda",
                        }
                    )
                elif page_num % 2 == 0 and it["cx"] > mid_x * 1.45:
                    misaligned.append(
                        {
                            "page": page_num,
                            "motivo": "página par com número à direita",
                        }
                    )

    return {
        "missing_pages": missing[:30],
        "missing_count": len(missing),
        "excess": excess[:30],
        "misaligned": misaligned[:30],
    }


def analyze_rasterized_fonts(doc: Any) -> Dict[str, Any]:
    """Texto só como imagem / Type3; pouco texto pesquisável."""
    type3_pages: List[int] = []
    low_text_high_image: List[int] = []

    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        try:
            fonts = page.get_fonts(full=True)
        except TypeError:
            fonts = page.get_fonts()
        has_type3 = any(
            len(f) > 2 and str(f[2] if len(f) > 2 else "").lower() == "type3"
            for f in fonts
        )
        if has_type3:
            type3_pages.append(pno + 1)

        text_len = len((page.get_text() or "").strip())
        img_count = len(page.get_images())
        if text_len < 80 and img_count >= 3:
            low_text_high_image.append(pno + 1)

    return {
        "type3_pages": type3_pages,
        "image_only_text_pages": low_text_high_image,
    }


def analyze_editoracao(doc: Any, os_details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Datas, sumário, índice, parlamentar."""
    current_year = datetime.now().year
    stale_years: List[Dict[str, Any]] = []
    indice_como_sumario: List[int] = []
    sumario_ausente = True
    parlamentar_issues: List[str] = []

    os_details = os_details or {}
    observ = f"{os_details.get('Observ') or ''} {os_details.get('Titulo') or ''}"

    for pno in range(min(40, doc.page_count)):
        page = doc.load_page(pno)
        text = page.get_text() or ""
        upper = text.upper()
        if SUMARIO_RE.search(text):
            sumario_ausente = False
        if pno < 15 and INDICE_RE.search(text) and not SUMARIO_RE.search(text):
            if "SUM" not in upper[:500]:
                indice_como_sumario.append(pno + 1)
        for m in YEAR_RE.finditer(text):
            y = int(m.group(0))
            if y < current_year - 1:
                stale_years.append({"page": pno + 1, "ano": y})

    # Parlamentar
    if not PARLAMENTAR_RE.search(observ):
        found_name = False
        for pno in range(min(8, doc.page_count)):
            text = doc.load_page(pno).get_text() or ""
            if NAME_AFTER_TITLE_RE.search(text):
                found_name = True
                break
            if PARLAMENTAR_RE.search(text):
                found_name = True
                break
        titulo = str(os_details.get("Titulo") or "")
        if re.search(r"senado|camara|câmara|congresso", titulo, re.IGNORECASE) and not found_name:
            parlamentar_issues.append(
                "publicação legislativa sem nome de parlamentar identificado no PDF ou OS"
            )

    return {
        "stale_years": stale_years[:20],
        "indice_como_sumario_pages": indice_como_sumario,
        "sumario_ausente": sumario_ausente and doc.page_count > 32,
        "parlamentar_issues": parlamentar_issues,
    }


def analyze_repeated_raster_logos(doc: Any) -> List[Dict[str, Any]]:
    """Imagens repetidas (possível logo em raster)."""
    xref_pages: Dict[int, List[int]] = {}
    xref_sizes: Dict[int, Tuple[int, int]] = {}
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        for img in page.get_images(full=True):
            xref = int(img[0])
            xref_pages.setdefault(xref, []).append(pno + 1)
            try:
                info = doc.extract_image(xref)
                xref_sizes[xref] = (int(info.get("width") or 0), int(info.get("height") or 0))
            except Exception:
                pass

    hits: List[Dict[str, Any]] = []
    for xref, pages in xref_pages.items():
        if len(pages) < 3:
            continue
        w, h = xref_sizes.get(xref, (0, 0))
        if w < 20 or h < 20:
            continue
        if w > 800 or h > 800:
            continue
        hits.append(
            {
                "xref": xref,
                "pages": pages[:10],
                "count": len(pages),
                "size_px": [w, h],
            }
        )
    return hits
