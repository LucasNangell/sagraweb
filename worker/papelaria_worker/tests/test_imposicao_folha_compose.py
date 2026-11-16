"""Testes da montagem PDF Pasta (arte + página em branco)."""
from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from imposicao_folha_compose import (  # noqa: E402
    build_pasta_art_blank_gang,
    expand_art_to_pagina,
)

MM_TO_PT = 72.0 / 25.4


def _make_pdf(path: Path, *, w: float, h: float, color: tuple[float, float, float]) -> None:
    doc = fitz.open()
    page = doc.new_page(width=w, height=h)
    page.draw_rect(page.rect, color=None, fill=color, width=0)
    doc.save(path)
    doc.close()


def test_build_pasta_art_blank_gang(tmp_path: Path):
    art = tmp_path / "art.pdf"
    out = tmp_path / "gang.pdf"
    w = 220 * MM_TO_PT
    h = 320 * MM_TO_PT
    _make_pdf(art, w=w, h=h, color=(0.1, 0.1, 0.9))
    logs = build_pasta_art_blank_gang(
        art_pdf_paths=[str(art)],
        output_pdf_path=str(out),
    )
    assert out.is_file()
    assert any("página(s) em branco" in m for m in logs)
    with fitz.open(out) as doc:
        assert doc.page_count == 2
        assert abs(doc[0].rect.width - w) < 0.5
        assert abs(doc[1].rect.width - w) < 0.5
        assert abs(doc[1].rect.height - h) < 0.5
        # Página 2 em branco (sem tinta dominante).
        pix = doc[1].get_pixmap(matrix=fitz.Matrix(0.2, 0.2), alpha=False)
        sample = pix.pixel(pix.width // 2, pix.height // 2)
        assert sum(sample) > 700


def test_build_pasta_duas_os(tmp_path: Path):
    a1 = tmp_path / "a1.pdf"
    a2 = tmp_path / "a2.pdf"
    out = tmp_path / "gang.pdf"
    _make_pdf(a1, w=100, h=100, color=(0.9, 0.1, 0.1))
    _make_pdf(a2, w=100, h=100, color=(0.1, 0.9, 0.1))
    build_pasta_art_blank_gang(
        art_pdf_paths=[str(a1), str(a2)],
        output_pdf_path=str(out),
    )
    with fitz.open(out) as doc:
        assert doc.page_count == 4


def test_build_pasta_uma_os_duplicada_4_paginas(tmp_path: Path):
    """1 OS com 2 slots → arte duplicada → art,branco, art, branco."""
    art = tmp_path / "art.pdf"
    out = tmp_path / "gang.pdf"
    _make_pdf(art, w=220 * MM_TO_PT, h=320 * MM_TO_PT, color=(0.1, 0.1, 0.9))
    build_pasta_art_blank_gang(
        art_pdf_paths=[str(art), str(art)],
        output_pdf_path=str(out),
    )
    with fitz.open(out) as doc:
        assert doc.page_count == 4
        # Páginas ímpares com tinta; pares em branco.
        for i in (0, 2):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(0.2, 0.2), alpha=False)
            assert pix.pixel(pix.width // 2, pix.height // 2)[2] > 100
        for i in (1, 3):
            pix = doc[i].get_pixmap(matrix=fitz.Matrix(0.2, 0.2), alpha=False)
            assert sum(pix.pixel(pix.width // 2, pix.height // 2)) > 700


def test_expand_art_alinha_direita(tmp_path: Path):
    art = tmp_path / "art.pdf"
    out = tmp_path / "pagina.pdf"
    art_w = 220 * MM_TO_PT
    art_h = 320 * MM_TO_PT
    _make_pdf(art, w=art_w, h=art_h, color=(0.1, 0.1, 0.9))
    expand_art_to_pagina(
        art_pdf_path=str(art),
        page_w_mm=440,
        page_h_mm=320,
        output_pdf_path=str(out),
        align="right",
    )
    with fitz.open(out) as doc:
        page = doc[0]
        assert abs(page.rect.width / MM_TO_PT - 440) < 0.5
        pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False)
        left = pix.pixel(int(pix.width * 0.15), pix.height // 2)
        right = pix.pixel(int(pix.width * 0.85), pix.height // 2)
        assert sum(left) > 700
        assert right[2] > right[0]


def test_build_exige_arte(tmp_path: Path):
    with pytest.raises(ValueError, match="Nenhuma arte"):
        build_pasta_art_blank_gang(
            art_pdf_paths=[],
            output_pdf_path=str(tmp_path / "o.pdf"),
        )
