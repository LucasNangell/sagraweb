"""Testes da montagem de folha Pasta com PDF template."""
from __future__ import annotations

import sys
from pathlib import Path

import fitz
import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from imposicao_folha_compose import compose_folha_com_template  # noqa: E402


def _make_pdf(path: Path, *, w: float, h: float, color: tuple[float, float, float]) -> None:
    doc = fitz.open()
    page = doc.new_page(width=w, height=h)
    page.draw_rect(page.rect, color=None, fill=color, width=0)
    doc.save(path)
    doc.close()


def test_compose_folha_duas_artes(tmp_path: Path):
    tmpl = tmp_path / "imposicao.pdf"
    art1 = tmp_path / "a1.pdf"
    art2 = tmp_path / "a2.pdf"
    out = tmp_path / "gang.pdf"
    # Folha A4 paisagem em pontos
    _make_pdf(tmpl, w=841.89, h=595.28, color=(0.95, 0.95, 0.95))
    _make_pdf(art1, w=400, h=500, color=(0.2, 0.2, 0.8))
    _make_pdf(art2, w=400, h=500, color=(0.8, 0.2, 0.2))

    cfg = {
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "fixixa", "largura_mm": 140, "altura_mm": 200},
        "grid": {
            "colunas": 2,
            "linhas": 1,
            "ocupadas": [
                {"col": 0, "row": 0, "pagina": 1},
                {"col": 1, "row": 0, "pagina": 2},
            ],
        },
        "espacamento_mm": {"horizontal": 0, "vertical": 0},
        "centralizar_na_folha": True,
    }
    logs = compose_folha_com_template(
        template_pdf_path=str(tmpl),
        art_pdf_paths=[str(art1), str(art2)],
        config=cfg,
        output_pdf_path=str(out),
    )
    assert out.is_file()
    assert any("Folha montada" in m for m in logs)
    with fitz.open(out) as doc:
        assert doc.page_count == 1


def test_compose_exige_template(tmp_path: Path):
    with pytest.raises(FileNotFoundError, match="PDF de imposição"):
        compose_folha_com_template(
            template_pdf_path=str(tmp_path / "missing.pdf"),
            art_pdf_paths=[str(tmp_path / "a.pdf")],
            config={},
            output_pdf_path=str(tmp_path / "o.pdf"),
        )
