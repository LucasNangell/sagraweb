"""Testes do fold mockup / folheto dobrado (Prova WEB)."""
from __future__ import annotations

from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")

from services import prova_web_fold_service as fold_svc
from services import prova_web_render_service as render_svc


def test_sheet_from_preset_triptico_sanfona() -> None:
    creases, ops = fold_svc.sheet_from_preset("triptico_sanfona_vertical", 210, 297)
    assert len(creases) == 2
    assert creases[0]["axis"] == "vertical"
    assert creases[0]["positionMm"] == pytest.approx(70.0, abs=0.1)
    assert len(ops) == 2
    assert ops[0]["movingSide"] == "negative"


def test_build_fold_mockup_biparte_panels() -> None:
    cfg = fold_svc.normalize_folheto_config(
        {"preset": "biparte_vertical"},
        page_width_mm=210,
        page_height_mm=297,
    )
    mock = fold_svc.build_fold_mockup(cfg)
    assert len(mock["panels"]) == 2
    assert abs(sum(p["wMm"] for p in mock["panels"]) - cfg["usableWidthMm"]) < 0.5
    assert len(mock["creases"]) == 1
    assert mock["creases"][0]["axis"] == "vertical"
    assert mock["ready"] is True


def test_build_fold_mockup_cruzado_grid() -> None:
    cfg = fold_svc.normalize_folheto_config(
        {
            "preset": "cruzado_v_primeiro",
            "crop": {"top": 0, "right": 0, "bottom": 0, "left": 0},
        },
        page_width_mm=200,
        page_height_mm=200,
    )
    mock = fold_svc.build_fold_mockup(cfg)
    assert len(mock["panels"]) == 4
    assert {c["axis"] for c in mock["creases"]} == {"vertical", "horizontal"}


def test_legacy_config_not_ready() -> None:
    cfg = fold_svc.normalize_folheto_config(
        {
            "preset": "biparte_vertical",
            "dobras": [
                {
                    "id": "d1",
                    "eixo": "vertical",
                    "posicaoMm": 105,
                    "sentido": "valley",
                    "ordem": 1,
                }
            ],
        },
        page_width_mm=210,
        page_height_mm=297,
    )
    mock = fold_svc.build_fold_mockup(cfg)
    assert mock["ready"] is False
    assert any(v["code"] == "legacy_config" for v in mock["validation"])


def test_panel_pages_by_id() -> None:
    cfg = fold_svc.normalize_folheto_config(
        {
            "preset": "triptico_sanfona_vertical",
            "pageVerso": 1,
            "panelPages": [
                {"panelId": "p0", "frontPage": 4, "backPage": 2},
                {"panelId": "p1", "frontPage": 6, "backPage": 3},
                {"panelId": "p2", "frontPage": 1, "backPage": 5},
            ],
        },
        page_width_mm=210,
        page_height_mm=297,
    )
    mock = fold_svc.build_fold_mockup(cfg)
    by_id = {p["panelId"]: p for p in mock["panelPages"]}
    assert by_id["p0"]["frontPage"] == 4
    assert by_id["p2"]["backPage"] == 5


def test_folha_dobrada_render_emits_fold_mockup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "folha.pdf"
    doc = fitz.open()
    doc.new_page(width=595.28, height=841.89)
    doc.new_page(width=595.28, height=841.89)
    doc.save(pdf)
    doc.close()

    cache = tmp_path / "web"
    cache.mkdir()

    monkeypatch.setattr(render_svc, "ensure_web_render_dir", lambda *_a, **_k: str(cache))
    monkeypatch.setattr(render_svc, "render_scale", lambda: 1.0)

    crop = {
        "folheto": {
            "preset": "biparte_vertical",
            "crop": {
                "top": 0,
                "right": 0,
                "bottom": 0,
                "left": 0,
                "source": "manual",
            },
            "creases": [
                {"id": "c1", "axis": "vertical", "positionMm": 105},
            ],
            "operations": [
                {
                    "id": "o1",
                    "creaseId": "c1",
                    "order": 1,
                    "movingSide": "positive",
                    "towards": "front",
                    "targetAngleDeg": 180,
                }
            ],
            "pageFrente": 0,
            "pageVerso": 1,
        }
    }

    manifest = render_svc.ensure_prova_web_pages(
        2026,
        1,
        mode=render_svc.MODE_FOLHA_DOBRADA,
        source_paths=[str(pdf)],
        os_folder=str(tmp_path),
        pasta_render="Prova1",
        crop_json=crop,
    )

    assert manifest["mode"] == render_svc.MODE_FOLHA_DOBRADA
    assert "foldMockup" in manifest
    assert "bookMockup" not in manifest
    assert manifest["pageCount"] == 2
    assert manifest["pages"][0]["role"] == "sheet-front"
    assert manifest["pages"][1]["role"] == "sheet-back"
    assert len(manifest["foldMockup"]["panels"]) == 2
    assert "creases" in manifest["foldMockup"]
    assert (cache / "page_1.png").is_file()
    assert (cache / "page_2.png").is_file()


def test_folha_dobrada_single_page_no_verso(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pdf = tmp_path / "one.pdf"
    doc = fitz.open()
    doc.new_page(width=400, height=300)
    doc.save(pdf)
    doc.close()

    cache = tmp_path / "web2"
    cache.mkdir()
    monkeypatch.setattr(render_svc, "ensure_web_render_dir", lambda *_a, **_k: str(cache))
    monkeypatch.setattr(render_svc, "render_scale", lambda: 1.0)

    manifest = render_svc.ensure_prova_web_pages(
        2026,
        2,
        mode=render_svc.MODE_FOLHA_DOBRADA,
        source_paths=[str(pdf)],
        os_folder=str(tmp_path),
        pasta_render="Prova1",
        crop_json={"folheto": {"preset": "triptico_sanfona_vertical"}},
    )
    assert manifest["pageCount"] == 1
    assert manifest["foldMockup"]["hasVerso"] is False
    assert len(manifest["foldMockup"]["panels"]) == 3
