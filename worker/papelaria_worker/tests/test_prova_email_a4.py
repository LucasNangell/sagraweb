"""Smoke: composição A4 Prova e-mail com pymupdf."""
from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prova_email_a4 import compose_prova_email_a4  # noqa: E402


def test_compose_prova_email_a4(tmp_path: Path):
    base = tmp_path / "base.pdf"
    doc = fitz.open()
    page = doc.new_page(width=200, height=300)
    page.insert_text((20, 40), "ARTE", fontsize=20)
    doc.save(base)
    doc.close()

    out = tmp_path / "prova.pdf"
    logs = compose_prova_email_a4(
        base_pdf_path=str(base),
        output_pdf_path=str(out),
        carimbo={
            "TipoOSint": "SP",
            "OSint": "05954/2026",
            "DataInt": "13/11/2026",
            "ProvaNroInt": "1",
        },
    )
    assert out.is_file()
    assert logs
    result = fitz.open(out)
    try:
        assert result.page_count == 1
        rect = result[0].rect
        assert rect.width == pytest.approx(595.276, abs=0.5)
        assert rect.height == pytest.approx(841.890, abs=0.5)
        text = result[0].get_text()
        assert "05954/2026" in text
        assert "Prova 1" in text
        # Borda desenhada como path vetorial ao redor da arte.
        drawings = result[0].get_drawings()
        assert drawings, "esperava borda (drawings) ao redor da arte"
    finally:
        result.close()
