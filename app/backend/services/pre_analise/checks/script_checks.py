"""
Pré-análise — validadores AnalisePDF (sangria, cores, imagens, raster).
"""
from __future__ import annotations

import os
from collections import defaultdict
from typing import Any, Dict, List, Optional

from services.pre_analise.context import PreAnaliseContext
from services.pre_analise.pdf_color_preflight import analyze_color_preflight
from services.pre_analise.pdf_deep import MIN_IMAGE_DPI, analyze_document_images
from services.pre_analise.pdf_partial_raster import (
    analyze_partial_raster_pages,
    ocr_unavailable_reason,
)
from services.pre_analise.pdf_virtual_bleed import REQ_BLEED_MM, analyze_document_bleed
from services.pre_analise.pdf_runner import close_docs, open_folder_pdfs
from services.pre_analise.pdf_utils import list_pdfs
from services.pre_analise.result_helpers import achado, finalize_result


def _ctx(context: Optional[PreAnaliseContext]) -> PreAnaliseContext:
    if context is None:
        return PreAnaliseContext(folder_path="", ano=0, os_id=0)
    return context


def run_cores_colorcheck(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """colorcheck.py — RGB (raster/vetor) e preto composto (4 cores)."""
    err, docs = open_folder_pdfs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", "Cores (RGB / preto 4c)", err, "error")], pdf_count=0
        )

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                achados.append(
                    achado(
                        "pdf_erro",
                        "Cores (RGB / preto 4c)",
                        f"{os.path.basename(path)}: não foi possível abrir.",
                        "error",
                    )
                )
                continue

            preflight = analyze_color_preflight(doc)
            by_page = preflight.get("by_page") or {}
            hidden = preflight.get("hidden") or []
            fname = os.path.basename(path)

            if hidden:
                achados.append(
                    achado(
                        "cores_oculto",
                        "Cores (RGB / preto 4c)",
                        f'"{fname}" — Metadados / Oculto: {" | ".join(hidden)}',
                        "warning",
                        arquivo=fname,
                    )
                )

            for pno in sorted(by_page.keys()):
                labels = by_page[pno]
                if not labels:
                    continue
                achados.append(
                    achado(
                        "cores_pagina",
                        "Cores (RGB / preto 4c)",
                        f'"{fname}" — Página {pno}: {" | ".join(labels)}',
                        "warning",
                        arquivo=fname,
                        pagina=pno,
                    )
                )

        if not achados:
            achados.append(
                achado(
                    "cores_ok",
                    "Cores (RGB / preto 4c)",
                    "Nenhum RGB nem preto composto detectado nos PDFs.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_imagens_checkimagem(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """checkimagem.py — imagens com DPI efetivo < 300 e localização na página."""
    err, docs = open_folder_pdfs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", "Imagens < 300 dpi", err, "error")], pdf_count=0
        )

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            result = analyze_document_images(doc, min_dpi=MIN_IMAGE_DPI)
            low = result.get("low_dpi") or []
            if not low:
                continue

            by_page: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
            for hit in low:
                by_page[int(hit["page"])].append(hit)

            fname = os.path.basename(path)
            for pno in sorted(by_page.keys()):
                hits = sorted(by_page[pno], key=lambda h: int(h.get("dpi") or 0))
                partes: List[str] = []
                seen: set[tuple[int, str]] = set()
                for hit in hits:
                    dpi = int(hit.get("dpi") or 0)
                    loc = hit.get("location") or ""
                    key = (dpi, loc)
                    if key in seen:
                        continue
                    seen.add(key)
                    loc_txt = f"na parte {loc.lower()}, " if loc else ""
                    partes.append(f"imagem {loc_txt}{dpi} dpi".replace("  ", " "))
                if partes:
                    achados.append(
                        achado(
                            "imagem_baixa_dpi",
                            "Imagens < 300 dpi",
                            f'"{fname}" — Página {pno}: {"; ".join(partes)}.',
                            "warning",
                            arquivo=fname,
                            pagina=pno,
                        )
                    )

        if not achados:
            achados.append(
                achado(
                    "imagem_dpi_ok",
                    "Imagens < 300 dpi",
                    f"Todas as imagens analisadas atendem ≥ {MIN_IMAGE_DPI} dpi.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def _format_paginas(pages) -> str:
    return ", ".join(map(str, sorted(pages)))


def run_sangria_bleed(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """checkbleed.py — sangria mínima (4 mm) via TrimBox virtual e marcas de corte."""
    titulo = f"Sangrias (mín. {REQ_BLEED_MM:g} mm)"
    err, docs = open_folder_pdfs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", titulo, err, "error")], pdf_count=0
        )

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                achados.append(
                    achado(
                        "pdf_erro",
                        titulo,
                        f"{os.path.basename(path)}: não foi possível abrir.",
                        "error",
                        arquivo=os.path.basename(path),
                    )
                )
                continue

            result = analyze_document_bleed(doc)
            insuf = result.get("insuficiente") or set()
            ausente = result.get("ausente") or set()
            fname = os.path.basename(path)

            if insuf:
                paginas = _format_paginas(insuf)
                achados.append(
                    achado(
                        "sangria_insuficiente",
                        titulo,
                        f'"{fname}" — Sangria insuficiente nas páginas: {paginas}.',
                        "warning",
                        arquivo=fname,
                        paginas=sorted(insuf),
                        req_bleed_mm=REQ_BLEED_MM,
                    )
                )

            if ausente:
                paginas = _format_paginas(ausente)
                achados.append(
                    achado(
                        "sangria_ausente",
                        titulo,
                        f'"{fname}" — Sangria ausente nas páginas: {paginas}.',
                        "warning",
                        arquivo=fname,
                        paginas=sorted(ausente),
                        req_bleed_mm=REQ_BLEED_MM,
                    )
                )

        if not achados:
            achados.append(
                achado(
                    "sangria_ok",
                    titulo,
                    f"Elementos com sangria adequada (≥ {REQ_BLEED_MM:g} mm) em relação às marcas de corte.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))


def run_raster_parcial(
    folder_path: str, context: Optional[PreAnaliseContext] = None
) -> Dict[str, Any]:
    """raster.py — texto vetorial convertido em imagem (OCR / Tesseract)."""
    err, docs = open_folder_pdfs(folder_path, _ctx(context))
    achados: List[Dict[str, Any]] = []
    if err:
        return finalize_result(
            [achado("pymupdf", "Raster parcial (OCR)", err, "error")], pdf_count=0
        )

    tesseract_missing = False

    try:
        for path, doc in docs:
            if isinstance(doc, Exception):
                continue
            ocr = analyze_partial_raster_pages(doc)
            if ocr.get("method") == "unavailable":
                tesseract_missing = True
                continue
            pages = ocr.get("pages") or []
            if not pages:
                continue
            fname = os.path.basename(path)
            for pno in pages:
                achados.append(
                    achado(
                        "raster_parcial",
                        "Raster parcial (OCR)",
                        f'"{fname}" — Página {pno}',
                        "warning",
                        arquivo=fname,
                        pagina=pno,
                    )
                )

        if tesseract_missing and not achados:
            msg = ocr_unavailable_reason() or (
                "Tesseract não encontrado no servidor. Defina TESSERACT_CMD no ambiente "
                "ou instale o Tesseract OCR."
            )
            achados.append(
                achado(
                    "tesseract_ausente",
                    "Raster parcial (OCR)",
                    msg,
                    "error",
                )
            )
        elif not achados:
            achados.append(
                achado(
                    "raster_ok",
                    "Raster parcial (OCR)",
                    "Nenhuma página com texto rasterizado detectada.",
                    "ok",
                )
            )
    finally:
        close_docs(docs, _ctx(context))

    return finalize_result(achados, pdf_count=len(list_pdfs(folder_path)))
