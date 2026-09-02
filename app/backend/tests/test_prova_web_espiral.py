"""Isolamento do modo espiral vs capa_miolo/folha no render."""

from __future__ import annotations

from services.prova_web_render_service import (
    MODE_CAPA_MIOLO,
    MODE_ESPIRAL,
    _book_mockup_meta,
    _espiral_config,
    _spiral_mockup_meta,
)


def test_espiral_config_defaults():
    cfg = _espiral_config(None)
    assert cfg["sourceKind"] == "unico"
    assert cfg["edge"] == "left"
    assert cfg["holeCount"] == 40
    assert cfg["holeDiameterMm"] == 3.0


def test_espiral_config_clamps_and_edge():
    cfg = _espiral_config(
        {
            "espiral": {
                "sourceKind": "capa_miolo",
                "edge": "top",
                "holeCount": 99,
                "holeDiameterMm": 1,
                "marginFromEdgeMm": 100,
                "crop": {"top": 1, "right": 2, "bottom": 3, "left": 4},
            }
        }
    )
    assert cfg["sourceKind"] == "capa_miolo"
    assert cfg["edge"] == "top"
    assert cfg["holeCount"] == 80
    assert cfg["holeDiameterMm"] == 2.0
    assert cfg["marginFromEdgeMm"] == 30.0
    assert cfg["capa"] is None or cfg["capa"].get("lombadaMm") == 0
    cfg_mid = _espiral_config({"espiral": {"holeCount": 50}})
    assert cfg_mid["holeCount"] == 50


def test_book_mockup_meta_ignores_espiral_mode():
    meta = _book_mockup_meta(
        mode=MODE_ESPIRAL,
        capa_cfg={"lombadaMm": 10},
        cover_entries=[
            {"role": "cover-front", "widthPt": 595, "heightPt": 842},
        ],
        spine_file=None,
    )
    assert meta is None


def test_book_mockup_meta_still_works_for_capa_miolo():
    meta = _book_mockup_meta(
        mode=MODE_CAPA_MIOLO,
        capa_cfg={"lombadaMm": 10},
        cover_entries=[
            {
                "role": "cover-front",
                "widthPt": 595.0,
                "heightPt": 842.0,
            },
        ],
        spine_file="spine.png",
    )
    assert meta is not None
    assert meta["lombadaMm"] == 10
    assert meta.get("spineFile") == "spine.png"


def test_spiral_mockup_meta_from_pages():
    cfg = _espiral_config(
        {"espiral": {"edge": "left", "holeCount": 12, "sourceKind": "unico"}}
    )
    pages = [
        {
            "role": "cover-front",
            "widthPt": 595.0,
            "heightPt": 842.0,
            "blank": False,
        },
        {"role": "page", "widthPt": 595.0, "heightPt": 842.0, "blank": False},
        {
            "role": "cover-back",
            "widthPt": 595.0,
            "heightPt": 842.0,
            "blank": False,
        },
        {"role": "page", "widthPt": 595.0, "heightPt": 842.0, "blank": True},
    ]
    meta = _spiral_mockup_meta(cfg, pages)
    assert meta is not None
    assert meta["edge"] == "left"
    assert meta["holeCount"] == 12
    assert meta["pageWidthMm"] > 0
    assert meta["pageHeightMm"] > 0
    # 3 folhas reais → 3*0.1+2 = 2.3 → clamp mínimo 4
    assert meta["blockThicknessMm"] == 4.0


def test_spiral_block_thickness_scales_with_pages():
    cfg = _espiral_config({"espiral": {"edge": "top", "holeCount": 10}})
    many = [
        {
            "role": "page",
            "widthPt": 595.0,
            "heightPt": 842.0,
            "blank": False,
        }
        for _ in range(80)
    ]
    meta = _spiral_mockup_meta(cfg, many)
    assert meta is not None
    assert meta["blockThicknessMm"] == round(80 * 0.1 + 2.0, 2)
    assert meta["edge"] == "top"
