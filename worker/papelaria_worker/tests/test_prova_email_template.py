"""Prova e-mail a partir de PDF template cadastrado (BordaF + carimbo)."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import fitz
import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prova_email_a4 import (  # noqa: E402
    compose_prova_email_a4,
    find_borda_f_rect,
)

_SAMPLE = (
    Path(__file__).resolve().parents[3]
    / "estudos"
    / "_fixtures"
    / "CatDupRetrLat.pdf"
)
_ATTACHED = Path(
    r"c:\Users\p_918713.REDECAMARA\.cursor\projects\c-dev-SagraWeb"
    r"\attachments\02b6df4b-11b1-4bff-9cf9-859a1e278a3f\CatDupRetrLat.pdf"
)


@pytest.fixture(scope="module")
def sample_template(tmp_path_factory) -> Path:
    dest_dir = tmp_path_factory.mktemp("tmpl")
    dest = dest_dir / "CatDupRetrLat.pdf"
    src = _SAMPLE if _SAMPLE.is_file() else _ATTACHED
    if not src.is_file():
        pytest.skip("PDF modelo de prova não disponível")
    shutil.copy2(src, dest)
    return dest


def test_find_borda_f_rect_no_sample(sample_template: Path):
    doc = fitz.open(sample_template)
    try:
        rect = find_borda_f_rect(doc[0])
    finally:
        doc.close()
    assert rect is not None
    assert rect.width > 100
    assert rect.height > 100


def test_compose_from_template_places_page1_and_updates_carimbo(
    sample_template: Path, tmp_path: Path
):
    art_w, art_h = 200, 280
    base = tmp_path / "BaseSefoc.pdf"
    doc = fitz.open()
    page = doc.new_page(width=art_w, height=art_h)
    page.draw_rect(page.rect, color=(0, 0, 1), fill=(0.8, 0.9, 1.0))
    page.insert_text((20, 40), "BASE-PAGE-1", fontsize=16, color=(0, 0, 0.6))
    doc.save(base)
    doc.close()

    out = tmp_path / "ProvaSefoc 1.pdf"
    logs = compose_prova_email_a4(
        base_pdf_path=str(base),
        output_pdf_path=str(out),
        carimbo={
            "TipoOSint": "SP",
            "OSint": "05024/2026",
            "DataInt": "16/11/2026",
            "ProvaNroInt": "3",
            "ProdutoNome": "Produto Teste Template",
        },
        template_pdf_path=str(sample_template),
    )
    assert out.is_file()
    assert any("pdf padrão" in line.lower() for line in logs)

    result = fitz.open(out)
    try:
        assert result.page_count == 1
        text = result[0].get_text().replace("\xa0", " ")
        assert "05024/2026" in text
        assert "16/11/2026" in text
        assert "3" in text
        assert "Produto Teste Template" in text
        assert "Prova SEFOC" in text
        assert "Não vale como prova fiel de cor" in text
    finally:
        result.close()
