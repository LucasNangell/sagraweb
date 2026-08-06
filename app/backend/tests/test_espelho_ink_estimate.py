"""Testes da estimativa de tintas em PDFs de espelho."""
from __future__ import annotations

import fitz

from services.espelho_ink_estimate import (
    estimate_inks_for_pdf_path,
    estimate_inks_for_pdf_paths,
)


def _write_cmyk_page_pdf(path: str, *, pages: int = 1) -> None:
    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page(width=200, height=200)
        # Operadores CMYK no content stream (cobertura em C e K)
        page.wrap_contents()
        # Inserir via show_pdf_page não ajuda; usar insert_htmlbox não gera k ops.
        # Desenhar com color em DeviceCMYK via shape:
        shape = page.new_shape()
        shape.draw_rect(fitz.Rect(10, 10, 100, 100))
        shape.finish(color=(0.8, 0, 0, 0.2), fill=(0.5, 0, 0, 0.4))
        shape.commit()
    doc.save(path)
    doc.close()


def test_estimate_inks_counts_cmyk_coverage(tmp_path):
    pdf = tmp_path / "espelho.pdf"
    _write_cmyk_page_pdf(str(pdf), pages=2)
    result = estimate_inks_for_pdf_path(str(pdf))
    assert result["page_count"] == 2
    assert result["status"] in ("ok", "partial")
    # Pelo menos alguma tinta detectada nas páginas
    assert result["expected_plate_count"] >= 2
    assert len(result["pages"]) == 2


def test_estimate_inks_aggregate_paths(tmp_path):
    a = tmp_path / "a.pdf"
    b = tmp_path / "b.pdf"
    _write_cmyk_page_pdf(str(a), pages=1)
    _write_cmyk_page_pdf(str(b), pages=1)
    result = estimate_inks_for_pdf_paths([str(a), str(b)])
    assert result["pdf_page_count"] == 2
    assert result["ink_analysis_status"] in ("ok", "partial", "unavailable")
    if result["ink_analysis_status"] != "unavailable":
        assert result["expected_plate_count"] is not None
        assert result["expected_plate_count"] >= 2
