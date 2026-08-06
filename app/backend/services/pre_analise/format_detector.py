"""
Detector de formato de impressão (marcas de corte, TrimBox, capa).

Portado de formato.py (AnalisePDF) — mesma lógica de detecção vetorial,
TrimBox, OpenCV e análise de capa com amostragem para PDFs grandes.
"""
from __future__ import annotations

import math
import os
import random
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    fitz = None  # type: ignore

try:
    import cv2
    import numpy as np

    _HAS_OPENCV = True
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore
    np = None  # type: ignore
    _HAS_OPENCV = False


class FormatDetector:
    def __init__(self) -> None:
        self.pt_to_mm = 25.4 / 72
        self.mm_to_pt = 72 / 25.4

    def _analisar_pagina(
        self, doc: Any, page_num: int, pdf_path: str, eh_capa_pelo_nome: bool
    ) -> Dict[str, Any]:
        page = doc[page_num]

        file_w = round(page.rect.width * self.pt_to_mm)
        file_h = round(page.rect.height * self.pt_to_mm)

        v_c, h_c = self._get_vectors_universal(page)

        is_capa_geometry = len(v_c) >= 3

        if eh_capa_pelo_nome or is_capa_geometry:
            dados_capa = self._analisar_capa_vetorial(page, v_c, h_c, eh_capa_pelo_nome)
            if dados_capa and dados_capa.get("tipo") != "Não é capa":
                return {
                    "page": page_num + 1,
                    "is_capa": True,
                    "dados": dados_capa,
                    "file_w": file_w,
                    "file_h": file_h,
                }

        print_w, print_h, method = self._analisar_miolo_vetorial(page, v_c, h_c)

        if print_w == 0 or print_h == 0:
            print_w, print_h = self._get_trimbox(doc, page)
            method = "Trimbox" if print_w > 0 else "Nenhuma"

        if print_w == 0 or print_h == 0:
            print_w, print_h, method = self._get_opencv_from_page(page, file_w, file_h)

        aviso = ""
        if method not in [
            "Marcas de corte (Geometria Vetorial)",
            "Marcas de corte (OpenCV)",
            "Trimbox",
        ]:
            print_w = print_w if print_w > 0 else file_w
            print_h = print_h if print_h > 0 else file_h
            method = "Formato do Arquivo"
            aviso = " (Aviso: O arquivo não possui marcas de corte nem TrimBox)"

        if eh_capa_pelo_nome:
            aviso += (
                " [ALERTA: Arquivo classificado como capa, mas o designer não incluiu "
                "marcas de corte para leitura.]"
            )

        return {
            "page": page_num + 1,
            "is_capa": False,
            "file_w": file_w,
            "file_h": file_h,
            "print_w": round(print_w),
            "print_h": round(print_h),
            "method": method,
            "aviso": aviso,
        }

    def detect_document(
        self, doc: Any, pdf_path: str
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Analisa um documento já aberto (sem abrir/fechar o arquivo)."""
        if fitz is None:
            raise RuntimeError("PyMuPDF não está instalado (pip install pymupdf).")

        total_pages = doc.page_count
        results: List[Dict[str, Any]] = []

        nome_arquivo = os.path.basename(pdf_path).lower()
        eh_capa_pelo_nome = "capa" in nome_arquivo

        if total_pages > 50:
            indices_aleatorios = random.sample(range(1, total_pages - 1), 48)
            indices_amostra = [0] + indices_aleatorios + [total_pages - 1]
            indices_amostra.sort()

            for page_num in indices_amostra:
                results.append(
                    self._analisar_pagina(doc, page_num, pdf_path, eh_capa_pelo_nome)
                )

            padroes = set()
            for r in results:
                if r["is_capa"]:
                    b = r["dados"]
                    padroes.add(("capa", b.get("aberto_w"), b.get("aberto_h")))
                else:
                    padroes.add(
                        ("miolo", r["print_w"], r["print_h"], r["file_w"], r["file_h"])
                    )

            if len(padroes) > 1:
                faltantes = [i for i in range(total_pages) if i not in indices_amostra]
                for page_num in faltantes:
                    results.append(
                        self._analisar_pagina(doc, page_num, pdf_path, eh_capa_pelo_nome)
                    )
                results.sort(key=lambda x: x["page"])
        else:
            for page_num in range(total_pages):
                results.append(
                    self._analisar_pagina(doc, page_num, pdf_path, eh_capa_pelo_nome)
                )

        return results, total_pages

    def detect(self, pdf_path: str) -> Tuple[List[Dict[str, Any]], int]:
        if fitz is None:
            raise RuntimeError("PyMuPDF não está instalado (pip install pymupdf).")

        doc = fitz.open(pdf_path)
        try:
            return self.detect_document(doc, pdf_path)
        finally:
            doc.close()

    def _extract_segments(self, page: Any) -> List[Any]:
        segments: List[Any] = []
        try:
            for path in page.get_drawings():
                for item in path["items"]:
                    if item[0] == "l":
                        segments.append((item[1], item[2]))
                    elif item[0] == "c":
                        segments.append((item[1], item[4]))
                    elif item[0] == "re":
                        r = item[1]
                        segments.append((fitz.Point(r.x0, r.y0), fitz.Point(r.x1, r.y0)))
                        segments.append((fitz.Point(r.x1, r.y0), fitz.Point(r.x1, r.y1)))
                        segments.append((fitz.Point(r.x1, r.y1), fitz.Point(r.x0, r.y1)))
                        segments.append((fitz.Point(r.x0, r.y1), fitz.Point(r.x0, r.y0)))
        except Exception:
            pass
        return segments

    def _get_vectors_universal(self, page: Any) -> Tuple[List[float], List[float]]:
        segments = self._extract_segments(page)

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
                    y_min = min(p1.y, p2.y)
                    y_max = max(p1.y, p2.y)
                    if y_min <= page.rect.y0 + margem_borda or y_max >= page.rect.y1 - margem_borda:
                        v_xs.append((p1.x + p2.x) / 2)

                elif dy <= 2.0:
                    x_min = min(p1.x, p2.x)
                    x_max = max(p1.x, p2.x)
                    if x_min <= page.rect.x0 + margem_borda or x_max >= page.rect.x1 - margem_borda:
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

        v_c = agrupar(v_xs, 4.0)
        h_c = agrupar(h_ys, 4.0)

        return v_c, h_c

    def _analisar_capa_vetorial(
        self, page: Any, v_c: List[float], h_c: List[float], eh_capa_pelo_nome: bool
    ) -> Optional[Dict[str, Any]]:
        if not v_c:
            return None

        eixos_x = [v * self.pt_to_mm for v in v_c]
        eixos_y = [h * self.pt_to_mm for h in h_c]

        medidas_brutas: List[float] = []
        for i in range(len(eixos_x) - 1):
            largura = round(eixos_x[i + 1] - eixos_x[i], 1)
            if largura >= 1.0:
                medidas_brutas.append(largura)

        if not medidas_brutas:
            return None

        medidas = medidas_brutas.copy()
        if len(medidas) >= 3:
            if medidas[0] <= 8.0:
                medidas.pop(0)
            if medidas[-1] <= 8.0:
                medidas.pop(-1)

        aberto_w = round(sum(medidas), 1)

        altura_impressao = 0.0
        if len(eixos_y) >= 2:
            eixos_y.sort()
            t = [y for y in eixos_y if y < page.rect.height * self.pt_to_mm / 2]
            b = [y for y in eixos_y if y > page.rect.height * self.pt_to_mm / 2]
            if t and b:
                altura_impressao = round(min(b) - max(t), 1)

        if altura_impressao == 0.0:
            altura_impressao = round(page.rect.height * self.pt_to_mm)

        dados: Dict[str, Any] = {
            "aberto_w": aberto_w,
            "aberto_h": altura_impressao,
            "detalhes": medidas,
        }

        if len(medidas) == 5:
            dados["tipo"] = "Capa com Orelhas"
            dados["orelha_esq"] = medidas[0]
            dados["contracapa"] = medidas[1]
            dados["lombada"] = medidas[2]
            dados["capa"] = medidas[3]
            dados["orelha_dir"] = medidas[4]
        elif len(medidas) == 3:
            dados["tipo"] = "Capa Simples (Lombada Quadrada s/ Orelhas)"
            dados["contracapa"] = medidas[0]
            dados["lombada"] = medidas[1]
            dados["capa"] = medidas[2]
        elif len(medidas) == 2:
            dados["tipo"] = "Capa Assimétrica / Vinco Único"
            dados["contracapa"] = medidas[0]
            dados["capa"] = medidas[1]
        elif len(medidas) == 1 and eh_capa_pelo_nome:
            dados["tipo"] = "Capa Plana ou Canoa (S/ vinco. Medida calculada ao meio)"
            dados["contracapa"] = round(medidas[0] / 2, 1)
            dados["capa"] = round(medidas[0] / 2, 1)
        else:
            if not eh_capa_pelo_nome:
                return {"tipo": "Não é capa"}
            dados["tipo"] = f"Capa Complexa ({len(medidas)} partes fatiadas)"

        return dados

    def _analisar_miolo_vetorial(
        self, page: Any, v_c: List[float], h_c: List[float]
    ) -> Tuple[float, float, str]:
        if len(v_c) < 2 or len(h_c) < 2:
            return 0.0, 0.0, ""

        l = [x for x in v_c if x < page.rect.width / 2]
        r = [x for x in v_c if x > page.rect.width / 2]
        t = [y for y in h_c if y < page.rect.height / 2]
        b = [y for y in h_c if y > page.rect.height / 2]

        w = (min(r) - max(l)) * self.pt_to_mm if (l and r) else 0.0
        h = (min(b) - max(t)) * self.pt_to_mm if (t and b) else 0.0

        if w >= 50 and h >= 50:
            return w, h, "Marcas de corte (Geometria Vetorial)"

        return 0.0, 0.0, ""

    def _get_trimbox(self, doc: Any, page: Any) -> Tuple[float, float]:
        try:
            xref = page.xref
            _, tb_str = doc.xref_get_key(xref, "TrimBox")
            if tb_str and tb_str != "null":
                parts = [float(p) for p in tb_str.strip("[]").split()]
                if len(parts) == 4:
                    return (
                        abs(parts[2] - parts[0]) * self.pt_to_mm,
                        abs(parts[3] - parts[1]) * self.pt_to_mm,
                    )
        except Exception:
            pass

        try:
            tb = page.trimbox
            if tb.width > 0 and tb.height > 0 and (
                abs(tb.width - page.rect.width) > 1
                or abs(tb.height - page.rect.height) > 1
            ):
                return tb.width * self.pt_to_mm, tb.height * self.pt_to_mm
        except Exception:
            pass

        return 0.0, 0.0

    def _get_opencv_from_page(
        self, page: Any, file_w: float, file_h: float
    ) -> Tuple[float, float, str]:
        if not _HAS_OPENCV or fitz is None:
            return 0.0, 0.0, ""

        try:
            dpi = 300
            pix = page.get_pixmap(
                matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csGRAY
            )
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)

            _, bin_img = cv2.threshold(img, 200, 255, cv2.THRESH_BINARY_INV)
            lines = cv2.HoughLinesP(
                bin_img, 1, np.pi / 180, 30, minLineLength=20, maxLineGap=5
            )

            if lines is None:
                return 0.0, 0.0, ""

            px_mm = 25.4 / dpi
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
                        v_x.append(((x1 + x2) / 2) * px_mm)
                elif dy <= 2 and dx >= 15:
                    if min(x1, x2) < m_px or max(x1, x2) > w_px - m_px:
                        h_y.append(((y1 + y2) / 2) * px_mm)

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

            v_c = cluster(v_x, 2.0)
            h_c = cluster(h_y, 2.0)

            l = [x for x in v_c if x < file_w / 2]
            r = [x for x in v_c if x > file_w / 2]
            t = [y for y in h_c if y < file_h / 2]
            b = [y for y in h_c if y > file_h / 2]

            w = (min(r) - max(l)) if (l and r) else 0.0
            h = (min(b) - max(t)) if (t and b) else 0.0

            if w >= 50 and h >= 50:
                return w, h, "Marcas de corte (OpenCV)"
        except Exception:
            pass

        return 0.0, 0.0, ""

    def find_duplicate_marks(self, page: Any) -> List[str]:
        """Marcas de corte duplicadas na mesma cantoneira (mesmos filtros vetoriais)."""
        segments = self._extract_segments(page)
        margem_borda = 12.0 * self.mm_to_pt
        min_len = 2.0 * self.mm_to_pt
        max_len = 45.0 * self.mm_to_pt
        join_tol = 1.5

        by_corner: Dict[str, List[Tuple[float, float, float, float]]] = {
            "tl": [],
            "tr": [],
            "bl": [],
            "br": [],
        }

        for p1, p2 in segments:
            dx = abs(p1.x - p2.x)
            dy = abs(p1.y - p2.y)
            length = math.hypot(dx, dy)
            if not (min_len <= length <= max_len):
                continue

            horizontal = dy <= 2.0
            vertical = dx <= 2.0
            if not horizontal and not vertical:
                continue

            x0, y0 = float(page.rect.x0), float(page.rect.y0)
            x1, y1 = float(page.rect.x1), float(page.rect.y1)

            if vertical:
                x = (p1.x + p2.x) / 2
                y_min, y_max = min(p1.y, p2.y), max(p1.y, p2.y)
                if y_min <= y0 + margem_borda and x <= x0 + margem_borda:
                    by_corner["tl"].append((x, y_min, y_max, 0.0))
                elif y_min <= y0 + margem_borda and x >= x1 - margem_borda:
                    by_corner["tr"].append((x, y_min, y_max, 0.0))
                elif y_max >= y1 - margem_borda and x <= x0 + margem_borda:
                    by_corner["bl"].append((x, y_min, y_max, 0.0))
                elif y_max >= y1 - margem_borda and x >= x1 - margem_borda:
                    by_corner["br"].append((x, y_min, y_max, 0.0))
            else:
                y = (p1.y + p2.y) / 2
                x_min, x_max = min(p1.x, p2.x), max(p1.x, p2.x)
                if x_min <= x0 + margem_borda and y <= y0 + margem_borda:
                    by_corner["tl"].append((y, x_min, x_max, 1.0))
                elif x_max >= x1 - margem_borda and y <= y0 + margem_borda:
                    by_corner["tr"].append((y, x_min, x_max, 1.0))
                elif x_min <= x0 + margem_borda and y >= y1 - margem_borda:
                    by_corner["bl"].append((y, x_min, x_max, 1.0))
                elif x_max >= x1 - margem_borda and y >= y1 - margem_borda:
                    by_corner["br"].append((y, x_min, x_max, 1.0))

        issues: List[str] = []
        for corner, segs in by_corner.items():
            if len(segs) < 2:
                continue
            for i, a in enumerate(segs):
                encontrou = False
                for b in segs[i + 1 :]:
                    if a[3] != b[3]:
                        continue
                    dist = abs(a[0] - b[0])
                    if dist <= 0.5:
                        continue
                    overlap = abs(a[1] - b[1]) < max(
                        abs(a[2] - a[1]), abs(b[2] - b[1])
                    ) * 0.35
                    if dist <= join_tol and overlap:
                        issues.append(
                            f"canto {corner}: marcas sobrepostas "
                            f"(~{dist * self.pt_to_mm:.1f} mm)"
                        )
                        encontrou = True
                        break
                if encontrou:
                    break
        return list(dict.fromkeys(issues))


def dominant_pattern(results: List[Dict[str, Any]]) -> Optional[Tuple[Any, ...]]:
    """Retorna o padrão físico dominante entre páginas de miolo."""
    normais = [r for r in results if not r.get("is_capa")]
    if not normais:
        return None
    dimensoes = [(r["print_w"], r["print_h"], r["file_w"], r["file_h"]) for r in normais]
    return Counter(dimensoes).most_common(1)[0][0]


def sampling_status(results: List[Dict[str, Any]], total_pages: int) -> Optional[str]:
    """Indica se houve amostragem rápida ou varredura completa."""
    if total_pages <= 50:
        return None
    if len(results) == 50:
        return "amostragem_rapida"
    return "varredura_completa"
