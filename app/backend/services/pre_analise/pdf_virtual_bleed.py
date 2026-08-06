"""
TrimBox virtual por marcas de corte e verificação de sangria mínima (4 mm).

Lógica baseada em checkbleed.py (AnalisePDF) — motor validado, modo resumo por páginas.
"""
from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

try:
    import fitz
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

try:
    import cv2
    import numpy as np
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore
    np = None  # type: ignore

REQ_BLEED_MM = 4.0
PT_TO_MM = 25.4 / 72.0
MM_TO_PT = 72.0 / 25.4


class VirtualBleedChecker:
    """Analisa sangria com TrimBox virtual (vetor + OpenCV)."""

    def __init__(self, req_bleed_mm: float = REQ_BLEED_MM) -> None:
        self.pt_to_mm = PT_TO_MM
        self.mm_to_pt = MM_TO_PT
        self.req_bleed_pt = req_bleed_mm * self.mm_to_pt
        self.pages_insuficiente: Set[int] = set()
        self.pages_ausente: Set[int] = set()
        self._doc_trimbox: Optional[Any] = None
        self._doc_trimbox_resolved = False

    def reset(self) -> None:
        self.pages_insuficiente.clear()
        self.pages_ausente.clear()
        self._doc_trimbox = None
        self._doc_trimbox_resolved = False

    def _extract_segments(self, page: Any) -> List[Tuple[Any, Any]]:
        segments: List[Tuple[Any, Any]] = []
        try:
            for path in page.get_drawings():
                for item in path["items"]:
                    if item[0] == "l":
                        segments.append((item[1], item[2]))
                    elif item[0] == "c":
                        segments.append((item[1], item[4]))
                    elif item[0] == "re":
                        r = item[1]
                        segments.append(
                            (fitz.Point(r.x0, r.y0), fitz.Point(r.x1, r.y0))
                        )
                        segments.append(
                            (fitz.Point(r.x1, r.y0), fitz.Point(r.x1, r.y1))
                        )
                        segments.append(
                            (fitz.Point(r.x1, r.y1), fitz.Point(r.x0, r.y1))
                        )
                        segments.append(
                            (fitz.Point(r.x0, r.y1), fitz.Point(r.x0, r.y0))
                        )
        except Exception:
            pass
        return segments

    def _get_vectors_universal(
        self, page: Any, segments: List[Tuple[Any, Any]]
    ) -> Tuple[List[float], List[float]]:
        v_xs: List[float] = []
        h_ys: List[float] = []
        margem_borda = 12.0 * self.mm_to_pt
        min_len = 2.0 * self.mm_to_pt
        max_len = 45.0 * self.mm_to_pt

        for p1, p2 in segments:
            dx = abs(p1.x - p2.x)
            dy = abs(p1.y - p2.y)
            length = math.hypot(dx, dy)

            if min_len <= length <= max_len:
                if dx <= 2.0:
                    y_min, y_max = min(p1.y, p2.y), max(p1.y, p2.y)
                    if (
                        y_min <= page.rect.y0 + margem_borda
                        or y_max >= page.rect.y1 - margem_borda
                    ):
                        v_xs.append((p1.x + p2.x) / 2)

                elif dy <= 2.0:
                    x_min, x_max = min(p1.x, p2.x), max(p1.x, p2.x)
                    if (
                        x_min <= page.rect.x0 + margem_borda
                        or x_max >= page.rect.x1 - margem_borda
                    ):
                        h_ys.append((p1.y + p2.y) / 2)

        def agrupar(valores: List[float], tolerancia: float) -> List[float]:
            if not valores:
                return []
            valores.sort()
            clusters = [[valores[0]]]
            for v in valores[1:]:
                if v - clusters[-1][-1] <= tolerancia:
                    clusters[-1].append(v)
                else:
                    clusters.append([v])
            return [sum(c) / len(c) for c in clusters]

        return agrupar(v_xs, 4.0), agrupar(h_ys, 4.0)

    def _trimbox_fits_page(self, tb: Any, page: Any) -> bool:
        file_w, file_h = page.rect.width, page.rect.height
        min_side = 50 * self.mm_to_pt
        if (tb.x1 - tb.x0) < min_side or (tb.y1 - tb.y0) < min_side:
            return False
        if tb.x0 < -1 or tb.y0 < -1 or tb.x1 > file_w + 1 or tb.y1 > file_h + 1:
            return False
        return True

    def _sample_page_indices(self, page_count: int) -> List[int]:
        """Páginas candidatas para detectar marcas de corte uma única vez por arquivo."""
        if page_count <= 0:
            return []
        if page_count == 1:
            return [0]
        indices = [0, page_count - 1]
        if page_count > 2:
            indices.insert(1, 1)
        if page_count > 10:
            indices.append(page_count // 2)
        return sorted(set(indices))

    def _resolve_document_trimbox(self, doc: Any) -> Optional[Any]:
        """
        Detecta TrimBox virtual uma vez por PDF (marcas de corte repetem no miolo).
        Evita raster 300 dpi + OpenCV em todas as páginas.
        """
        for pno in self._sample_page_indices(doc.page_count):
            tb = self._trimbox_from_page(doc[pno], pno)
            if tb is not None:
                return tb
        return None

    def _get_document_trimbox(self, doc: Any) -> Optional[Any]:
        if not self._doc_trimbox_resolved:
            self._doc_trimbox = self._resolve_document_trimbox(doc)
            self._doc_trimbox_resolved = True
        return self._doc_trimbox

    def _trimbox_from_page(self, page: Any, page_num: int) -> Optional[Any]:
        file_w, file_h = page.rect.width, page.rect.height

        segments = self._extract_segments(page)
        v_c, h_c = self._get_vectors_universal(page, segments)

        if len(v_c) >= 2 and len(h_c) >= 2:
            left = [x for x in v_c if x < file_w / 2]
            right = [x for x in v_c if x > file_w / 2]
            top = [y for y in h_c if y < file_h / 2]
            bottom = [y for y in h_c if y > file_h / 2]

            if left and right and top and bottom:
                x0, x1 = max(left), min(right)
                y0, y1 = max(top), min(bottom)
                if (x1 - x0) >= 50 * self.mm_to_pt and (y1 - y0) >= 50 * self.mm_to_pt:
                    return fitz.Rect(x0, y0, x1, y1)

        if cv2 is None or np is None or fitz is None:
            return None

        try:
            dpi = 300
            pix = page.get_pixmap(
                matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csGRAY
            )
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
                pix.height, pix.width
            )

            _, bin_img = cv2.threshold(img, 200, 255, cv2.THRESH_BINARY_INV)
            lines = cv2.HoughLinesP(
                bin_img, 1, np.pi / 180, 30, minLineLength=20, maxLineGap=5
            )

            if lines is not None:
                px_mm = 25.4 / dpi
                px_pt = 72 / dpi
                v_x: List[float] = []
                h_y: List[float] = []
                h_px, w_px = img.shape
                m_px = 30 / px_mm

                for line in lines:
                    x1, y1, x2, y2 = line[0]
                    dx, dy = abs(x2 - x1), abs(y2 - y1)
                    if math.hypot(dx, dy) > 35 / px_mm:
                        continue

                    if dx <= 2 and dy >= 15:
                        if min(y1, y2) < m_px or max(y1, y2) > h_px - m_px:
                            v_x.append(((x1 + x2) / 2) * px_pt)
                    elif dy <= 2 and dx >= 15:
                        if min(x1, x2) < m_px or max(x1, x2) > w_px - m_px:
                            h_y.append(((y1 + y2) / 2) * px_pt)

                def cluster(vals: List[float], tol: float) -> List[float]:
                    if not vals:
                        return []
                    vals.sort()
                    c = [[vals[0]]]
                    for v in vals[1:]:
                        if v - c[-1][-1] <= tol:
                            c[-1].append(v)
                        else:
                            c.append([v])
                    return [sum(x) / len(x) for x in c]

                v_c = cluster(v_x, 2.0 * self.mm_to_pt)
                h_c = cluster(h_y, 2.0 * self.mm_to_pt)

                left = [x for x in v_c if x < file_w / 2]
                right = [x for x in v_c if x > file_w / 2]
                top = [y for y in h_c if y < file_h / 2]
                bottom = [y for y in h_c if y > file_h / 2]

                if left and right and top and bottom:
                    x0, x1 = max(left), min(right)
                    y0, y1 = max(top), min(bottom)
                    if (x1 - x0) >= 50 * self.mm_to_pt and (y1 - y0) >= 50 * self.mm_to_pt:
                        return fitz.Rect(x0, y0, x1, y1)
        except Exception as exc:
            logger.debug("OpenCV sangria página %s: %s", page_num + 1, exc)

        return None

    def _expanded_trim_zone(self, tb: Any) -> Any:
        pad = self.req_bleed_pt * 2.5
        return fitz.Rect(
            tb.x0 - pad,
            tb.y0 - pad,
            tb.x1 + pad,
            tb.y1 + pad,
        )

    def _collect_bleed_elements(self, page: Any, tb: Any) -> List[Any]:
        """Só elementos na faixa de sangria (evita varrer vetores irrelevantes)."""
        zone = self._expanded_trim_zone(tb)
        elements: List[Any] = []
        for img in page.get_images(full=True):
            try:
                for rect in page.get_image_rects(img[0]):
                    if rect.intersects(zone):
                        elements.append(rect)
            except Exception:
                pass
        for path in page.get_drawings():
            rect = path.get("rect")
            if rect is not None and fitz.Rect(rect).intersects(zone):
                elements.append(rect)
        return elements

    def _classify_page_bleed(self, page_num: int, tb: Any, elements: List[Any]) -> None:
        tol = 2.0
        for rect in elements:
            edges_failed: List[bool] = []
            min_bleed = 999.0

            if rect.x0 <= tb.x0 + tol and rect.x1 > tb.x0 + tol:
                if rect.y0 < tb.y1 and rect.y1 > tb.y0:
                    bleed = tb.x0 - rect.x0
                    if bleed < self.req_bleed_pt - 0.5:
                        edges_failed.append(True)
                        min_bleed = min(min_bleed, bleed)

            if rect.x1 >= tb.x1 - tol and rect.x0 < tb.x1 - tol:
                if rect.y0 < tb.y1 and rect.y1 > tb.y0:
                    bleed = rect.x1 - tb.x1
                    if bleed < self.req_bleed_pt - 0.5:
                        edges_failed.append(True)
                        min_bleed = min(min_bleed, bleed)

            if rect.y0 <= tb.y0 + tol and rect.y1 > tb.y0 + tol:
                if rect.x0 < tb.x1 and rect.x1 > tb.x0:
                    bleed = tb.y0 - rect.y0
                    if bleed < self.req_bleed_pt - 0.5:
                        edges_failed.append(True)
                        min_bleed = min(min_bleed, bleed)

            if rect.y1 >= tb.y1 - tol and rect.y0 < tb.y1 - tol:
                if rect.x0 < tb.x1 and rect.x1 > tb.x0:
                    bleed = rect.y1 - tb.y1
                    if bleed < self.req_bleed_pt - 0.5:
                        edges_failed.append(True)
                        min_bleed = min(min_bleed, bleed)

            if not edges_failed:
                continue

            bleed_mm = round(min_bleed * self.pt_to_mm, 1)
            if bleed_mm <= 0.2:
                self.pages_ausente.add(page_num)
            else:
                self.pages_insuficiente.add(page_num)
            return

    def _analyze_page(self, doc: Any, pno: int, doc_tb: Optional[Any]) -> None:
        page = doc[pno]
        page_num = pno + 1

        tb = doc_tb
        if tb is not None and not self._trimbox_fits_page(tb, page):
            tb = self._trimbox_from_page(page, pno)
        if not tb:
            self.pages_ausente.add(page_num)
            return

        elements = self._collect_bleed_elements(page, tb)
        if not elements:
            return
        self._classify_page_bleed(page_num, tb, elements)

    def analyze_document(self, doc: Any) -> Dict[str, Set[int]]:
        """Retorna conjuntos de páginas com sangria insuficiente ou ausente."""
        self.reset()
        if fitz is None:
            return {"insuficiente": set(), "ausente": set()}

        doc_tb = self._get_document_trimbox(doc)
        if doc_tb is None:
            self.pages_ausente.update(range(1, doc.page_count + 1))
            return {
                "insuficiente": set(self.pages_insuficiente),
                "ausente": set(self.pages_ausente),
            }

        for pno in range(doc.page_count):
            try:
                self._analyze_page(doc, pno, doc_tb)
            except Exception as exc:
                logger.debug("Sangria página %s: %s", pno + 1, exc)
                self.pages_ausente.add(pno + 1)

        return {
            "insuficiente": set(self.pages_insuficiente),
            "ausente": set(self.pages_ausente),
        }


def analyze_document_bleed(
    doc: Any, req_bleed_mm: float = REQ_BLEED_MM
) -> Dict[str, Set[int]]:
    checker = VirtualBleedChecker(req_bleed_mm=req_bleed_mm)
    return checker.analyze_document(doc)
