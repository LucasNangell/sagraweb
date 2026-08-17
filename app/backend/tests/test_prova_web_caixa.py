"""Parser de faca + mockup caixa (tuck-end) — Prova WEB."""

from __future__ import annotations

from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")

from services import prova_web_caixa_service as caixa_svc
from services import prova_web_dieline_service as dieline_svc
from services import prova_web_render_service as render_svc

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "caixa_tuck_end_exemplo.pdf"


@pytest.mark.skipif(not FIXTURE.is_file(), reason="fixture PDF ausente")
def test_parse_exemplo_cut_vs_fold() -> None:
    parsed = dieline_svc.parse_dieline_pdf(str(FIXTURE))
    assert parsed["cutCount"] >= 4
    assert parsed["foldCount"] >= 10
    assert parsed["pageCount"] == 2
    assert len(parsed["verticalCreasesMm"]) >= 4
    assert len(parsed["horizontalCreasesMm"]) >= 4
    dims = parsed["dims"]
    assert dims["lengthMm"] == pytest.approx(135, abs=8)
    assert dims["widthMm"] == pytest.approx(190, abs=10)
    assert dims["heightMm"] == pytest.approx(49, abs=5)
    assert dims["ready"] is True
    assert dims["confidence"] >= 0.5


@pytest.mark.skipif(not FIXTURE.is_file(), reason="fixture PDF ausente")
def test_detect_roles_faca_arte() -> None:
    doc = fitz.open(str(FIXTURE))
    try:
        roles = dieline_svc.detect_page_roles(doc)
    finally:
        doc.close()
    assert roles["facaPage"] == 0
    assert roles["artePage"] == 1


def test_is_dashed_stroke_variants() -> None:
    assert dieline_svc.is_dashed_stroke("[] 0") is False
    assert dieline_svc.is_dashed_stroke("[ 4 4 ] 0") is True
    assert dieline_svc.is_dashed_stroke(([], 0)) is False
    assert dieline_svc.is_dashed_stroke(([4, 4], 0)) is True
    assert dieline_svc.is_dashed_stroke(None) is False


def test_estimate_tuck_end_from_deltas() -> None:
    # Espelha deltas aproximados do PDF exemplo (mm relativos)
    v = [65.0, 201.4, 250.5, 384.5, 434.0, 483.0]
    h = [32.0, 81.0, 130.7, 320.3, 370.0, 419.0]
    dims = dieline_svc.estimate_tuck_end_dims(v, h)
    assert dims["heightMm"] == pytest.approx(49, abs=3)
    assert dims["lengthMm"] == pytest.approx(135, abs=5)
    assert dims["widthMm"] == pytest.approx(190, abs=5)
    assert dims["ready"] is True


def test_normalize_and_build_box_mockup() -> None:
    cfg = caixa_svc.normalize_caixa_config(
        {
            "sourceKind": "combined",
            "dimsMm": {"length": 135, "width": 190, "height": 49, "glue": 24},
            "facaPage": 0,
            "artePage": 1,
        }
    )
    assert cfg["template"] == "flip_top"
    assert cfg["dimsMm"]["length"] == 135
    mock = caixa_svc.build_box_mockup(cfg)
    assert mock["ready"] is True
    ids = {p["id"] for p in mock["panels"]}
    assert "front" in ids and "back" in ids
    assert "lid_top" in ids and "lid_front" in ids
    assert "dust_right_top" in ids
    assert mock["netWidthMm"] > mock["dimsMm"]["length"]
    assert any(o["panelId"] == "lid_top" for o in mock["openOperations"])


def test_normalize_model_duplex_art_fields() -> None:
    cfg = caixa_svc.normalize_caixa_config(
        {
            "sourceKind": "model",
            "boxModelId": 7,
            "artePage": 0,
            "arteInsidePage": 1,
            "artTransform": {"txMm": 2, "tyMm": 3, "scale": 1.1, "rotationDeg": 5},
            "artInsideTransform": {
                "txMm": -1,
                "tyMm": 0,
                "scale": 1.0,
                "rotationDeg": 0,
            },
            "dimsMm": {"length": 100, "width": 80, "height": 40, "glue": 15},
        }
    )
    assert cfg["sourceKind"] == "model"
    assert cfg["template"] == "graph"
    assert cfg["artePage"] == 0
    assert cfg["arteInsidePage"] == 1
    assert cfg["artTransform"]["txMm"] == 2
    assert cfg["artInsideTransform"]["txMm"] == -1


def test_normalize_model_defaults_arte_inside_page() -> None:
    cfg = caixa_svc.normalize_caixa_config({"sourceKind": "model", "boxModelId": 1})
    assert cfg["arteInsidePage"] == 1
    assert cfg["artInsideTransform"] is None


def test_legacy_tuck_template_maps_to_flip_top() -> None:
    cfg = caixa_svc.normalize_caixa_config(
        {"template": "tuck_end_reverse", "dimsMm": {"length": 100, "width": 120, "height": 40}}
    )
    assert cfg["template"] == "flip_top"
    # operações antigas com tuck_top são substituídas
    cfg2 = caixa_svc.normalize_caixa_config(
        {
            "template": "tuck_end_reverse",
            "dimsMm": {"length": 100, "width": 120, "height": 40},
            "openOperations": [
                {"id": "op_tuck_top", "panelId": "tuck_top", "order": 1, "targetAngleDeg": 110}
            ],
        }
    )
    assert any(o["panelId"] == "lid_top" for o in cfg2["openOperations"])


def test_caixa_render_emits_box_mockup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not FIXTURE.is_file():
        pytest.skip("fixture PDF ausente")

    cache = tmp_path / "web"
    cache.mkdir()
    monkeypatch.setattr(render_svc, "ensure_web_render_dir", lambda *_a, **_k: str(cache))
    monkeypatch.setattr(render_svc, "render_scale", lambda: 1.0)

    crop = {
        "caixa": {
            "sourceKind": "combined",
            "template": "flip_top",
            "facaPage": 0,
            "artePage": 1,
            "dimsMm": {"length": 135, "width": 190, "height": 49, "glue": 24},
            "artCrop": {
                "top": 17,
                "right": 17,
                "bottom": 17,
                "left": 17,
                "source": "faca",
            },
        }
    }
    manifest = render_svc.ensure_prova_web_pages(
        2026,
        1,
        mode=render_svc.MODE_CAIXA,
        source_paths=[str(FIXTURE)],
        os_folder=str(tmp_path),
        pasta_render="Prova1",
        crop_json=crop,
    )
    assert manifest["mode"] == "caixa"
    assert manifest.get("boxMockup")
    assert manifest["boxMockup"]["dimsMm"]["height"] == pytest.approx(49, abs=0.1)
    assert manifest["pageCount"] >= 1
    roles = {p["role"] for p in manifest["pages"]}
    assert "sheet-front" in roles


def test_caixa_render_separate_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not FIXTURE.is_file():
        pytest.skip("fixture PDF ausente")

    # Divide o PDF exemplo em faca.pdf + arte.pdf
    faca_pdf = tmp_path / "faca.pdf"
    arte_pdf = tmp_path / "arte.pdf"
    src = fitz.open(str(FIXTURE))
    try:
        d0 = fitz.open()
        d0.insert_pdf(src, from_page=0, to_page=0)
        d0.save(faca_pdf)
        d0.close()
        d1 = fitz.open()
        d1.insert_pdf(src, from_page=1, to_page=1)
        d1.save(arte_pdf)
        d1.close()
    finally:
        src.close()

    cache = tmp_path / "web"
    cache.mkdir()
    monkeypatch.setattr(render_svc, "ensure_web_render_dir", lambda *_a, **_k: str(cache))
    monkeypatch.setattr(render_svc, "render_scale", lambda: 1.0)

    crop = {
        "caixa": {
            "sourceKind": "separate",
            "dimsMm": {"length": 135, "width": 190, "height": 49},
        }
    }
    manifest = render_svc.ensure_prova_web_pages(
        2026,
        1,
        mode=render_svc.MODE_CAIXA,
        source_paths=[str(faca_pdf), str(arte_pdf)],
        os_folder=str(tmp_path),
        pasta_render="Prova1",
        crop_json=crop,
    )
    assert manifest.get("boxMockup")
    roles = [p["role"] for p in manifest["pages"]]
    assert "sheet-front" in roles
