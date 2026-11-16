from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pdf_blank_pages import (  # noqa: E402
    copy_pdf_without_blank_pages,
    page_is_blank,
)


def _write_pdf(path: Path, pages: list[str]) -> None:
    doc = fitz.open()
    for text in pages:
        page = doc.new_page(width=200, height=200)
        if text:
            page.insert_text((40, 100), text, fontsize=16)
    doc.save(path)
    doc.close()


def test_page_is_blank_detects_empty_and_content(tmp_path: Path):
    pdf = tmp_path / "mix.pdf"
    _write_pdf(pdf, ["", "Conteudo"])
    with fitz.open(pdf) as doc:
        assert page_is_blank(doc[0]) is True
        assert page_is_blank(doc[1]) is False


def test_copy_pdf_without_blank_pages_keeps_content_only(tmp_path: Path):
    src = tmp_path / "base.pdf"
    dest = tmp_path / "prova.pdf"
    _write_pdf(src, ["", "Frente", ""])

    info = copy_pdf_without_blank_pages(str(src), str(dest))
    assert info["source_pages"] == 3
    assert info["kept_count"] == 1
    assert info["kept_pages"] == [1]
    assert src.read_bytes() != dest.read_bytes()

    with fitz.open(src) as base:
        assert base.page_count == 3
    with fitz.open(dest) as prova:
        assert prova.page_count == 1
        assert "Frente" in prova[0].get_text()


def test_copy_all_blank_keeps_first_page(tmp_path: Path):
    src = tmp_path / "all_blank.pdf"
    dest = tmp_path / "prova.pdf"
    _write_pdf(src, ["", ""])
    info = copy_pdf_without_blank_pages(str(src), str(dest))
    assert info["kept_pages"] == [0]
    with fitz.open(dest) as prova:
        assert prova.page_count == 1
