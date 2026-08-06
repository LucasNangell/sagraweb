"""Testes do crop mm / TrimBox / cache da Prova WEB."""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")

from services import prova_web_crop_service as crop_svc
from services import prova_web_render_service as render_svc


def _make_pdf_with_trim(
    path: Path,
    *,
    media=(0, 0, 595.28, 841.89),
    trim=(28.35, 28.35, 566.93, 813.54),
    pages: int = 1,
) -> None:
    """MediaBox A4 (pt) + TrimBox inset ~10 mm."""
    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page(width=media[2] - media[0], height=media[3] - media[1])
        # PyMuPDF: trimbox via set_mediabox + cropbox; trimbox property escreve no PDF
        page.set_mediabox(fitz.Rect(*media))
        try:
            page.set_trimbox(fitz.Rect(*trim))
        except Exception:
            page.set_cropbox(fitz.Rect(*trim))
    doc.save(path)
    doc.close()


def test_suggested_crop_prefers_trimbox(tmp_path: Path) -> None:
    pdf = tmp_path / "trim.pdf"
    _make_pdf_with_trim(pdf)
    with fitz.open(pdf) as doc:
        page = doc.load_page(0)
        suggested, source = crop_svc.suggested_crop_from_page(page)
    assert source == "trimbox"
    assert suggested["top"] == pytest.approx(10.0, abs=0.5)
    assert suggested["left"] == pytest.approx(10.0, abs=0.5)
    assert suggested["right"] == pytest.approx(10.0, abs=0.5)
    assert suggested["bottom"] == pytest.approx(10.0, abs=0.5)


def test_apply_mm_crop_insets(tmp_path: Path) -> None:
    pdf = tmp_path / "plain.pdf"
    doc = fitz.open()
    doc.new_page(width=200, height=300)
    doc.save(pdf)
    doc.close()

    with fitz.open(pdf) as doc:
        page = doc.load_page(0)
        render_svc._apply_mm_crop(
            page,
            {"top": 5, "right": 5, "bottom": 5, "left": 5, "source": "manual"},
        )
        # 5 mm ≈ 14.17 pt
        assert page.rect.width == pytest.approx(200 - 2 * crop_svc.mm_to_pt(5), abs=0.2)
        assert page.rect.height == pytest.approx(300 - 2 * crop_svc.mm_to_pt(5), abs=0.2)


def test_apply_mm_crop_rejects_excessive() -> None:
    doc = fitz.open()
    page = doc.new_page(width=100, height=100)
    with pytest.raises(ValueError):
        render_svc._apply_mm_crop(
            page,
            {"top": 40, "right": 40, "bottom": 40, "left": 40, "source": "manual"},
        )
    doc.close()


def test_cache_key_changes_with_crop(tmp_path: Path) -> None:
    pdf = tmp_path / "a.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(pdf)
    doc.close()
    paths = [str(pdf)]
    k1 = render_svc._cache_key("unico", paths, 2.0, None)
    k2 = render_svc._cache_key(
        "unico",
        paths,
        2.0,
        {"unico": {"top": 3, "right": 3, "bottom": 3, "left": 3, "source": "trimbox"}},
    )
    k3 = render_svc._cache_key(
        "unico",
        paths,
        2.0,
        {"unico": {"top": 5, "right": 3, "bottom": 3, "left": 3, "source": "manual"}},
    )
    assert k1 != k2
    assert k2 != k3


def test_spread_halves_respect_lombada(tmp_path: Path) -> None:
    """Capa aberta: lombada 10 mm reduz a largura de cada face de forma previsível."""
    pdf = tmp_path / "spread.pdf"
    # Spread ~ 2× A5: 297mm × 210mm → ~841.89 × 595.28 pt
    width_pt, height_pt = 841.89, 595.28
    doc = fitz.open()
    doc.new_page(width=width_pt, height=height_pt)
    doc.new_page(width=width_pt, height=height_pt)
    doc.save(pdf)
    doc.close()

    os_folder = tmp_path / "os"
    os_folder.mkdir()
    (os_folder / "Sefoc" / "AdminDocs" / "WEB").mkdir(parents=True)
    # Miolo estreito para forçar detecção de spread se layout None
    miolo = tmp_path / "miolo.pdf"
    doc = fitz.open()
    doc.new_page(width=420, height=595)
    doc.save(miolo)
    doc.close()

    crop_json = {
        "miolo": {"top": 0, "right": 0, "bottom": 0, "left": 0, "source": "manual"},
        "capa": {
            "layout": "spread",
            "lombadaMm": 10,
            "crop": {"top": 0, "right": 0, "bottom": 0, "left": 0, "source": "manual"},
            "sheets": [
                {
                    "pageIndex": 0,
                    "leftRole": "cover-back",
                    "rightRole": "cover-front",
                },
                {
                    "pageIndex": 1,
                    "leftRole": "cover-front-inside",
                    "rightRole": "cover-back-inside",
                },
            ],
        },
    }
    out0 = render_svc.ensure_prova_web_pages(
        2026,
        1,
        mode="capa_miolo",
        source_paths=[str(pdf), str(miolo)],
        os_folder=str(os_folder),
        pasta_render="Prova1",
        crop_json=crop_json,
    )
    # Versão com lombada 0
    crop_json2 = {
        **crop_json,
        "capa": {**crop_json["capa"], "lombadaMm": 0},
    }
    out1 = render_svc.ensure_prova_web_pages(
        2026,
        1,
        mode="capa_miolo",
        source_paths=[str(pdf), str(miolo)],
        os_folder=str(os_folder),
        pasta_render="Prova2",
        crop_json=crop_json2,
    )

    front0 = next(p for p in out0["pages"] if p["role"] == "cover-front")
    front1 = next(p for p in out1["pages"] if p["role"] == "cover-front")
    # Com lombada 10 mm, cada face perde ~5 mm (metade) ⇒ menor largura em px
    assert front0["width"] < front1["width"]
    assert out0["cacheKey"] != out1["cacheKey"]


def test_book_mockup_and_spine_with_lombada(tmp_path: Path) -> None:
    pdf = tmp_path / "spread.pdf"
    doc = fitz.open()
    doc.new_page(width=841.89, height=595.28)
    doc.new_page(width=841.89, height=595.28)
    doc.save(pdf)
    doc.close()

    miolo = tmp_path / "miolo.pdf"
    doc = fitz.open()
    doc.new_page(width=420, height=595)
    doc.save(miolo)
    doc.close()

    os_folder = tmp_path / "os"
    (os_folder / "Sefoc" / "AdminDocs" / "WEB").mkdir(parents=True)

    crop_json = {
        "miolo": {"top": 0, "right": 0, "bottom": 0, "left": 0, "source": "manual"},
        "capa": {
            "layout": "spread",
            "lombadaMm": 8,
            "crop": {"top": 0, "right": 0, "bottom": 0, "left": 0, "source": "manual"},
            "sheets": [
                {
                    "pageIndex": 0,
                    "leftRole": "cover-back",
                    "rightRole": "cover-front",
                },
                {
                    "pageIndex": 1,
                    "leftRole": "cover-front-inside",
                    "rightRole": "cover-back-inside",
                },
            ],
        },
    }
    out = render_svc.ensure_prova_web_pages(
        2026,
        2,
        mode="capa_miolo",
        source_paths=[str(pdf), str(miolo)],
        os_folder=str(os_folder),
        pasta_render="Prova1",
        crop_json=crop_json,
    )
    bm = out.get("bookMockup")
    assert bm is not None
    assert bm["lombadaMm"] == 8
    assert bm["pageWidthMm"] > 0
    assert bm["pageHeightMm"] > 0
    assert bm.get("spineFile") == "spine.png"
    spine_path = render_svc.resolve_rendered_asset_path(
        str(os_folder), "Prova1", "spine.png"
    )
    assert os.path.isfile(spine_path)

    # Lombada 0 → sem bookMockup
    crop_json0 = {
        **crop_json,
        "capa": {**crop_json["capa"], "lombadaMm": 0},
    }
    out0 = render_svc.ensure_prova_web_pages(
        2026,
        2,
        mode="capa_miolo",
        source_paths=[str(pdf), str(miolo)],
        os_folder=str(os_folder),
        pasta_render="Prova2",
        crop_json=crop_json0,
    )
    assert "bookMockup" not in out0


def test_orelhas_narrow_cover_faces(tmp_path: Path) -> None:
    pdf = tmp_path / "spread.pdf"
    doc = fitz.open()
    doc.new_page(width=841.89, height=595.28)
    doc.new_page(width=841.89, height=595.28)
    doc.save(pdf)
    doc.close()

    miolo = tmp_path / "miolo.pdf"
    doc = fitz.open()
    doc.new_page(width=420, height=595)
    doc.save(miolo)
    doc.close()

    os_folder = tmp_path / "os"
    (os_folder / "Sefoc" / "AdminDocs" / "WEB").mkdir(parents=True)

    base_capa = {
        "layout": "spread",
        "lombadaMm": 8,
        "crop": {"top": 0, "right": 0, "bottom": 0, "left": 0, "source": "manual"},
        "sheets": [
            {
                "pageIndex": 0,
                "leftRole": "cover-back",
                "rightRole": "cover-front",
            },
            {
                "pageIndex": 1,
                "leftRole": "cover-front-inside",
                "rightRole": "cover-back-inside",
            },
        ],
    }
    crop0 = {
        "miolo": {"top": 0, "right": 0, "bottom": 0, "left": 0, "source": "manual"},
        "capa": {**base_capa, "orelhaEsquerdaMm": 0, "orelhaDireitaMm": 0},
    }
    crop15 = {
        "miolo": crop0["miolo"],
        "capa": {
            **base_capa,
            "orelhaEsquerdaMm": 15,
            "orelhaDireitaMm": 15,
        },
    }
    out0 = render_svc.ensure_prova_web_pages(
        2026,
        3,
        mode="capa_miolo",
        source_paths=[str(pdf), str(miolo)],
        os_folder=str(os_folder),
        pasta_render="Prova1",
        crop_json=crop0,
    )
    out15 = render_svc.ensure_prova_web_pages(
        2026,
        3,
        mode="capa_miolo",
        source_paths=[str(pdf), str(miolo)],
        os_folder=str(os_folder),
        pasta_render="Prova2",
        crop_json=crop15,
    )
    front0 = next(p for p in out0["pages"] if p["role"] == "cover-front")
    front15 = next(p for p in out15["pages"] if p["role"] == "cover-front")
    assert front15["width"] < front0["width"]
    assert out0["cacheKey"] != out15["cacheKey"]


def test_validate_crop_against_page() -> None:
    with pytest.raises(ValueError):
        crop_svc.validate_crop_against_page(
            50, 50, {"top": 24, "right": 24, "bottom": 24, "left": 24}
        )
