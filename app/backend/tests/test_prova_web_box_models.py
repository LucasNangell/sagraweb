"""Painéis/hinges da faca + modelos de caixa Admin."""
from __future__ import annotations

from pathlib import Path

import pytest

from services.prova_web_box_model_service import (
    bake_art_transform_onto_net,
    build_box_mockup_from_model_config,
    normalize_box_model_config,
    parse_faca_to_box_config,
)
from services.prova_web_box_panel_graph import build_panel_graph_from_parsed
from services.prova_web_dieline_svg import parse_dieline_svg

FIXTURE_PDF = Path(__file__).resolve().parent / "fixtures" / "caixa_tuck_end_exemplo.pdf"
FIXTURE_SVG = Path(__file__).resolve().parent / "fixtures" / "caixa_dieline_exemplo.svg"


def test_svg_curves_produce_cut_segments() -> None:
    """C/S/A e cantos arredondados viram segmentos densos (não somem do preview)."""
    from services.prova_web_dieline_svg import _path_to_polylines, parse_dieline_svg

    cubic = _path_to_polylines("M 0 0 C 10 0 20 20 30 20")
    assert len(cubic) == 1
    assert len(cubic[0]) >= 8

    smooth = _path_to_polylines("M 0 0 C 10 0 20 0 30 0 S 50 20 60 20")
    assert len(smooth[0]) >= 12

    arc = _path_to_polylines("M 0 10 A 10 10 0 0 1 10 0")
    assert len(arc[0]) >= 6
    # Ponto final do arco
    assert abs(arc[0][-1][0] - 10) < 0.05
    assert abs(arc[0][-1][1] - 0) < 0.05

    svg = b"""<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40">
  <g id="corte" stroke="#ED3237" fill="none">
    <path d="M 5 20 C 5 5 25 5 40 20 S 75 35 75 20"/>
  </g>
</svg>"""
    parsed = parse_dieline_svg(svg)
    assert parsed["cutCount"] >= 8
    # Curva tem pontos intermediários (não só corda reta 5→75)
    ys = {round(s["y1"], 1) for s in parsed["cutSegmentsMm"]} | {
        round(s["y2"], 1) for s in parsed["cutSegmentsMm"]
    }
    assert len(ys) >= 3


@pytest.mark.skipif(not FIXTURE_SVG.is_file(), reason="fixture SVG ausente")
def test_parse_svg_cut_vs_fold() -> None:
    parsed = parse_dieline_svg(FIXTURE_SVG.read_bytes())
    assert parsed["source"] == "svg"
    assert parsed["foldCount"] >= 8
    assert parsed["cutCount"] >= 4
    assert parsed["verticalCreasesMm"]
    assert parsed["foldSegmentsMm"]


@pytest.mark.skipif(not FIXTURE_SVG.is_file(), reason="fixture SVG ausente")
def test_parse_svg_by_layer_and_color() -> None:
    """Camada dobras/#00AFEF e corte/#ED3237 sem dasharray."""
    from services.prova_web_dieline_svg import (
        _kind_from_color,
        _kind_from_layer,
    )

    assert _kind_from_color("#00AFEF") == "fold"
    assert _kind_from_color("#ed3237") == "cut"
    assert _kind_from_layer("layer dobras box") == "fold"
    assert _kind_from_layer("camada corte") == "cut"

    parsed = parse_dieline_svg(FIXTURE_SVG.read_bytes())
    assert parsed["foldCount"] >= 8
    assert parsed["cutCount"] >= 4
    assert len(parsed["verticalCreasesMm"]) >= 3


@pytest.mark.skipif(not FIXTURE_SVG.is_file(), reason="fixture SVG ausente")
def test_svg_to_box_config_ops_empty() -> None:
    cfg = parse_faca_to_box_config(
        FIXTURE_SVG.read_bytes(), filename="caixa_dieline_exemplo.svg"
    )
    assert cfg["version"] == 1
    assert cfg["operations"] == []
    assert len(cfg["panels"]) >= 4
    assert len(cfg["hinges"]) >= 3
    assert any(e["kind"] == "fold" for e in cfg["edges"])
    assert any(e["kind"] == "cut" for e in cfg["edges"])
    assert all(e.get("source") != "hinge" for e in cfg["edges"])
    mock = build_box_mockup_from_model_config(cfg)
    assert mock["template"] == "graph"
    assert mock["openOperations"] == []


@pytest.mark.skipif(not FIXTURE_SVG.is_file(), reason="fixture SVG ausente")
def test_svg_named_folds_and_no_gap_spanning_edge() -> None:
    """Linhas nomeadas preservadas; nenhuma dobra inventada no vão entre flaps."""
    parsed = parse_dieline_svg(FIXTURE_SVG.read_bytes())
    named = [s for s in parsed["foldSegmentsMm"] if s.get("name")]
    assert len(named) >= 5
    assert any(s.get("name") == "dobra_h_flap_a" for s in named)

    cfg = build_panel_graph_from_parsed(parsed)
    assert all(e.get("source") != "hinge" for e in cfg["edges"])
    # Vão entre flaps superiores (x~110..130 em y=40): sem aresta de dobra
    gap_folds = [
        e
        for e in cfg["edges"]
        if e["kind"] == "fold"
        and abs(e["y1"] - 40) < 1.5
        and abs(e["y2"] - 40) < 1.5
        and min(e["x1"], e["x2"]) < 115
        and max(e["x1"], e["x2"]) > 125
    ]
    assert gap_folds == []
    # Hinge horizontal clipada ao segmento real (não cruza o vão)
    for h in cfg["hinges"]:
        if h["axis"] != "horizontal" or abs(float(h["positionMm"]) - 40) > 1.5:
            continue
        assert float(h["spanEndMm"]) - float(h["spanStartMm"]) < 65


def test_hinges_require_real_fold_segment() -> None:
    """Vizinhos de grade sem dobra SVG não ganham hinge nem aresta sintética."""
    parsed = {
        "pageWidthMm": 200.0,
        "pageHeightMm": 120.0,
        "cutBboxMm": {
            "x0Mm": 0.0,
            "y0Mm": 0.0,
            "x1Mm": 200.0,
            "y1Mm": 120.0,
            "widthMm": 200.0,
            "heightMm": 120.0,
        },
        "verticalCreasesMm": [100.0],
        "horizontalCreasesMm": [40.0],
        # Dobra só na metade esquerda da junção horizontal
        "foldSegmentsMm": [
            {"x1": 0.0, "y1": 40.0, "x2": 80.0, "y2": 40.0, "name": "dobra_parcial"},
            {"x1": 100.0, "y1": 0.0, "x2": 100.0, "y2": 120.0, "name": "dobra_v"},
        ],
        "cutSegmentsMm": [
            {"x1": 0.0, "y1": 0.0, "x2": 200.0, "y2": 0.0},
            {"x1": 200.0, "y1": 0.0, "x2": 200.0, "y2": 120.0},
            {"x1": 200.0, "y1": 120.0, "x2": 0.0, "y2": 120.0},
            {"x1": 0.0, "y1": 120.0, "x2": 0.0, "y2": 0.0},
        ],
    }
    cfg = build_panel_graph_from_parsed(parsed)
    assert all(e.get("source") in ("fold", "cut") for e in cfg["edges"])
    assert any(e.get("name") == "dobra_parcial" for e in cfg["edges"])
    # Nenhuma dobra horizontal cobrindo o vão 80..100+
    spanning = [
        e
        for e in cfg["edges"]
        if e["kind"] == "fold"
        and abs(e["y1"] - 40) < 1
        and abs(e["y2"] - 40) < 1
        and min(e["x1"], e["x2"]) <= 70
        and max(e["x1"], e["x2"]) >= 95
    ]
    assert spanning == []
    for h in cfg["hinges"]:
        if h["axis"] == "horizontal" and abs(float(h["positionMm"]) - 40) < 1:
            assert float(h["spanEndMm"]) <= 82


@pytest.mark.skipif(not FIXTURE_PDF.is_file(), reason="fixture PDF ausente")
def test_panel_graph_from_pdf_exemplo() -> None:
    pytest.importorskip("fitz")
    from services.prova_web_dieline_service import parse_dieline_pdf

    parsed = parse_dieline_pdf(str(FIXTURE_PDF))
    graph = build_panel_graph_from_parsed(parsed)
    assert len(graph["panels"]) >= 8
    assert len(graph["hinges"]) >= 6
    assert graph["operations"] == []
    cfg = normalize_box_model_config(graph)
    mock = build_box_mockup_from_model_config(cfg)
    assert mock["template"] == "graph"


@pytest.mark.skipif(not FIXTURE_PDF.is_file(), reason="fixture PDF ausente")
def test_parse_faca_pdf_bytes() -> None:
    pytest.importorskip("fitz")
    data = FIXTURE_PDF.read_bytes()
    cfg = parse_faca_to_box_config(data, filename="faca.pdf")
    assert cfg["version"] == 1
    assert cfg["panels"]


def test_mockup_reroots_when_base_changes() -> None:
    cfg = {
        "version": 1,
        "basePanelId": "p0",
        "pageWidthMm": 200,
        "pageHeightMm": 100,
        "cutBboxMm": {"widthMm": 200, "heightMm": 100},
        "panels": [
            {
                "id": "p0",
                "xMm": 0,
                "yMm": 0,
                "wMm": 100,
                "hMm": 100,
                "active": True,
            },
            {
                "id": "p1",
                "xMm": 100,
                "yMm": 0,
                "wMm": 100,
                "hMm": 100,
                "active": True,
            },
        ],
        "hinges": [
            {
                "id": "h0",
                "panelA": "p0",
                "panelB": "p1",
                "axis": "vertical",
                "positionMm": 100,
                "spanStartMm": 0,
                "spanEndMm": 100,
            }
        ],
        "operations": [
            {
                "id": "op0",
                "hingeId": "h0",
                "panelId": "p1",
                "order": 1,
                "targetAngleDeg": 90,
            }
        ],
    }
    mock = build_box_mockup_from_model_config(cfg)
    assert mock["panels"][0]["parentId"] is None or next(
        p["parentId"] for p in mock["panels"] if p["id"] == "p0"
    ) is None
    assert next(p["parentId"] for p in mock["panels"] if p["id"] == "p1") == "p0"

    cfg["basePanelId"] = "p1"
    mock2 = build_box_mockup_from_model_config(cfg)
    assert next(p["parentId"] for p in mock2["panels"] if p["id"] == "p0") == "p1"
    assert next(p["parentId"] for p in mock2["panels"] if p["id"] == "p1") is None
    assert mock2["openOperations"][0]["panelId"] == "p0"


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


@pytest.mark.skipif(not FIXTURE_SVG.is_file(), reason="fixture SVG ausente")
def test_smoke_svg_parse_to_mockup_and_bake(tmp_path: Path) -> None:
    from PIL import Image

    cfg = parse_faca_to_box_config(
        FIXTURE_SVG.read_bytes(), filename="caixa.svg"
    )
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
