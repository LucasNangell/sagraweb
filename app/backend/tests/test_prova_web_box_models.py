"""Painéis/hinges da faca + modelos de caixa Admin."""
from __future__ import annotations

from pathlib import Path

import pytest

fitz = pytest.importorskip("fitz")

from services.prova_web_box_model_service import (
    bake_art_transform_onto_net,
    build_box_mockup_from_model_config,
    normalize_box_model_config,
    parse_faca_to_box_config,
)
from services.prova_web_box_panel_graph import build_panel_graph_from_parsed
from services.prova_web_dieline_service import parse_dieline_pdf

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "caixa_tuck_end_exemplo.pdf"


@pytest.mark.skipif(not FIXTURE.is_file(), reason="fixture ausente")
def test_panel_graph_from_exemplo() -> None:
    parsed = parse_dieline_pdf(str(FIXTURE))
    graph = build_panel_graph_from_parsed(parsed)
    assert len(graph["panels"]) >= 8
    assert len(graph["hinges"]) >= 6
    assert graph["basePanelId"]
    base = next(p for p in graph["panels"] if p["id"] == graph["basePanelId"])
    assert base["areaMm2"] == max(p["areaMm2"] for p in graph["panels"])
    assert graph["operations"] == []
    assert graph.get("edges")
    assert any(e["kind"] == "fold" for e in graph["edges"])
    cfg = normalize_box_model_config(graph)
    mock = build_box_mockup_from_model_config(cfg)
    assert mock["template"] == "graph"
    assert len(mock["panels"]) >= 8
    assert mock["openOperations"] == []


@pytest.mark.skipif(not FIXTURE.is_file(), reason="fixture ausente")
def test_parse_faca_bytes() -> None:
    data = FIXTURE.read_bytes()
    cfg = parse_faca_to_box_config(data)
    assert cfg["version"] == 1
    assert cfg["panels"]
    assert cfg["cutBboxMm"]["widthMm"] > 100


def test_normalize_rejects_empty_panels() -> None:
    with pytest.raises(ValueError, match="painel"):
        normalize_box_model_config({"panels": []})


def test_bake_art_transform_onto_net(tmp_path: Path) -> None:
    from PIL import Image

    arte = tmp_path / "arte.png"
    Image.new("RGB", (80, 40), (200, 40, 40)).save(arte)
    out = tmp_path / "net.png"
    meta = bake_art_transform_onto_net(
        str(arte),
        str(out),
        net_width_mm=100,
        net_height_mm=50,
        art_transform={"txMm": 5, "tyMm": 0, "scale": 1.0, "rotationDeg": 0},
        px_per_mm=2.0,
    )
    assert out.is_file()
    assert meta["width"] == 200
    assert meta["height"] == 100
    with Image.open(out) as img:
        assert img.size == (200, 100)


@pytest.mark.skipif(not FIXTURE.is_file(), reason="fixture ausente")
def test_smoke_parse_faca_to_mockup_and_bake(tmp_path: Path) -> None:
    """Admin parse → graph mockup → bake arte na net (smoke ONMP fixture)."""
    from PIL import Image

    cfg = parse_faca_to_box_config(FIXTURE.read_bytes())
    mock = build_box_mockup_from_model_config(cfg)
    assert mock["template"] == "graph"
    assert mock["basePanelId"]
    assert mock["netWidthMm"] > 50

    arte = tmp_path / "arte.png"
    Image.new("RGB", (120, 80), (30, 120, 80)).save(arte)
    out = tmp_path / "net.png"
    bake_art_transform_onto_net(
        str(arte),
        str(out),
        net_width_mm=float(mock["netWidthMm"]),
        net_height_mm=float(mock["netHeightMm"]),
        art_transform={"txMm": 0, "tyMm": 0, "scale": 1.1, "rotationDeg": 15},
        px_per_mm=2.0,
    )
    assert out.is_file()
    assert out.stat().st_size > 100
