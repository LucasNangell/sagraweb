"""Smoke: composição A4 Prova e-mail com pymupdf."""
from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prova_email_a4 import (  # noqa: E402
    MM_TO_PT,
    TOP_OFFSET_PT,
    compose_prova_email_a4,
)


def _carimbo(**extra):
    base = {
        "TipoOSint": "SP",
        "OSint": "05954/2026",
        "DataInt": "13/11/2026",
        "ProvaNroInt": "1",
        "ProdutoNome": "Credencial",
    }
    base.update(extra)
    return base


def test_compose_prova_email_a4_arte_tamanho_real_e_carimbo(tmp_path: Path):
    # Credencial 75×110 mm (Larg × Alt) — cabe em A4 em escala 1:1.
    art_w = 75 * MM_TO_PT
    art_h = 110 * MM_TO_PT
    base = tmp_path / "base.pdf"
    doc = fitz.open()
    page = doc.new_page(width=art_w, height=art_h)
    page.insert_text((10, 40), "ARTE", fontsize=20)
    doc.save(base)
    doc.close()

    out = tmp_path / "prova.pdf"
    logs = compose_prova_email_a4(
        base_pdf_path=str(base),
        output_pdf_path=str(out),
        carimbo=_carimbo(),
    )
    assert out.is_file()
    assert any("tamanho real" in line.lower() for line in logs)

    result = fitz.open(out)
    try:
        assert result.page_count == 1
        rect = result[0].rect
        assert rect.width == pytest.approx(595.276, abs=0.5)
        assert rect.height == pytest.approx(841.890, abs=0.5)
        text = result[0].get_text().replace("\xa0", " ")
        assert "Prova SEFOC" in text
        assert "OS nº:" in text
        assert "05954/2026" in text
        assert "13/11/2026" in text
        assert "Prova nº:" in text
        assert "Não vale como prova fiel de cor" in text
        assert "Credencial" in text
        assert "110mm (Alt) x 75mm (Larg)" in text
        assert "Frente" not in text  # 1 página → sem rótulo

        drawings = result[0].get_drawings()
        art_rects = [
            d
            for d in drawings
            if abs((d.get("rect") or fitz.Rect()).width - art_w) < 1.0
            and abs((d.get("rect") or fitz.Rect()).height - art_h) < 1.0
        ]
        assert art_rects, "esperava borda no tamanho real da arte (75×110 mm)"
        art_rect = art_rects[0]["rect"]
        # 20 mm do topo, centralizado horizontalmente.
        assert art_rect.y0 == pytest.approx(TOP_OFFSET_PT, abs=0.5)
        expected_x = (595.276 - art_w) / 2.0
        assert art_rect.x0 == pytest.approx(expected_x, abs=0.5)
    finally:
        result.close()


def test_compose_prova_email_a4_frente_verso_empilhados(tmp_path: Path):
    art_w = 85 * MM_TO_PT
    art_h = 50 * MM_TO_PT
    base = tmp_path / "duplex.pdf"
    doc = fitz.open()
    p0 = doc.new_page(width=art_w, height=art_h)
    p0.insert_text((8, 24), "FRENTE-SRC", fontsize=10)
    p1 = doc.new_page(width=art_w, height=art_h)
    p1.insert_text((8, 24), "VERSO-SRC", fontsize=10)
    doc.save(base)
    doc.close()

    out = tmp_path / "prova.pdf"
    logs = compose_prova_email_a4(
        base_pdf_path=str(base),
        output_pdf_path=str(out),
        carimbo=_carimbo(ProdutoNome="Cartão de visita"),
    )
    assert any("frente/verso" in line.lower() for line in logs)

    result = fitz.open(out)
    try:
        text = result[0].get_text()
        assert "Frente" in text
        assert "Verso" in text
        drawings = result[0].get_drawings()
        art_rects = [
            d["rect"]
            for d in drawings
            if abs((d.get("rect") or fitz.Rect()).width - art_w) < 1.0
            and abs((d.get("rect") or fitz.Rect()).height - art_h) < 1.0
        ]
        assert len(art_rects) >= 2
        # Empilhadas: mesma X (centralizadas), Verso abaixo da Frente.
        top = min(art_rects, key=lambda r: r.y0)
        bottom = max(art_rects, key=lambda r: r.y0)
        assert top.y0 == pytest.approx(TOP_OFFSET_PT, abs=0.5)
        assert bottom.y0 > top.y1
        assert top.x0 == pytest.approx(bottom.x0, abs=0.5)
    finally:
        result.close()


def test_compose_prova_email_a4_reduz_se_nao_couber(tmp_path: Path):
    base = tmp_path / "grande.pdf"
    doc = fitz.open()
    doc.new_page(width=800, height=1000)
    doc.save(base)
    doc.close()

    out = tmp_path / "prova.pdf"
    logs = compose_prova_email_a4(
        base_pdf_path=str(base),
        output_pdf_path=str(out),
        carimbo=_carimbo(ProdutoNome="Banner", ProvaNroInt="2"),
    )
    assert any("reduzida" in line.lower() for line in logs)
    assert out.is_file()
