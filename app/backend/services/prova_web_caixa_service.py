"""
Modo Prova WEB caixa (tuck-end): normalização de CropJson.caixa e boxMockup.
"""
from __future__ import annotations

from typing import Any, Optional

from services.prova_web_crop_service import empty_crop, normalize_crop_sides
from services.prova_web_dieline_service import estimate_tuck_end_dims

TEMPLATE_TUCK_END_REVERSE = "tuck_end_reverse"
SOURCE_COMBINED = "combined"
SOURCE_SEPARATE = "separate"

_MIN_DIM_MM = 10.0
_MAX_DIM_MM = 800.0


def _clamp_dim(value: Any, default: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = default
    return round(max(_MIN_DIM_MM, min(_MAX_DIM_MM, v)), 2)


def default_open_operations() -> list[dict[str, Any]]:
    """Ordem de abertura das abas (progresso 0=fechado → 1=aberto)."""
    return [
        {
            "id": "op_tuck_top",
            "panelId": "tuck_top",
            "order": 1,
            "targetAngleDeg": 110,
            "phaseId": "lid",
        },
        {
            "id": "op_dust_front_top",
            "panelId": "dust_front_top",
            "order": 2,
            "targetAngleDeg": 100,
            "phaseId": "dust_top",
        },
        {
            "id": "op_dust_back_top",
            "panelId": "dust_back_top",
            "order": 2,
            "targetAngleDeg": 100,
            "phaseId": "dust_top",
        },
        {
            "id": "op_tuck_bottom",
            "panelId": "tuck_bottom",
            "order": 3,
            "targetAngleDeg": 110,
            "phaseId": "bottom",
        },
        {
            "id": "op_dust_front_bottom",
            "panelId": "dust_front_bottom",
            "order": 4,
            "targetAngleDeg": 100,
            "phaseId": "dust_bottom",
        },
        {
            "id": "op_dust_back_bottom",
            "panelId": "dust_back_bottom",
            "order": 4,
            "targetAngleDeg": 100,
            "phaseId": "dust_bottom",
        },
    ]


def build_tuck_end_net(dims: dict[str, float]) -> dict[str, Any]:
    """
    Net paramétrica reverse tuck-end (mm, origem canto superior esquerdo).

    Layout X: glue | front(L) | right(H) | back(L) | left(H)
    Layout Y: top flaps(H) | body(W) | bottom flaps(H)
    """
    L = float(dims["lengthMm"])
    W = float(dims["widthMm"])
    H = float(dims["heightMm"])
    G = float(dims.get("glueMm") or round(H * 0.5, 2))

    x_glue = 0.0
    x_front = G
    x_right = G + L
    x_back = G + L + H
    x_left = G + L + H + L

    y_top = 0.0
    y_body = H
    y_bottom = H + W

    net_w = G + L + H + L + H
    net_h = H + W + H

    panels = [
        {
            "id": "glue",
            "role": "glue",
            "xMm": x_glue,
            "yMm": y_body,
            "wMm": G,
            "hMm": W,
            "parentId": "front",
            "hinge": "right",
            "bodyAngleDeg": 90,
            "flap": False,
        },
        {
            "id": "front",
            "role": "front",
            "xMm": x_front,
            "yMm": y_body,
            "wMm": L,
            "hMm": W,
            "parentId": None,
            "hinge": None,
            "bodyAngleDeg": 0,
            "flap": False,
        },
        {
            "id": "right",
            "role": "side",
            "xMm": x_right,
            "yMm": y_body,
            "wMm": H,
            "hMm": W,
            "parentId": "front",
            "hinge": "left",
            "bodyAngleDeg": 90,
            "flap": False,
        },
        {
            "id": "back",
            "role": "back",
            "xMm": x_back,
            "yMm": y_body,
            "wMm": L,
            "hMm": W,
            "parentId": "right",
            "hinge": "left",
            "bodyAngleDeg": 90,
            "flap": False,
        },
        {
            "id": "left",
            "role": "side",
            "xMm": x_left,
            "yMm": y_body,
            "wMm": H,
            "hMm": W,
            "parentId": "back",
            "hinge": "left",
            "bodyAngleDeg": 90,
            "flap": False,
        },
        # Top flaps
        {
            "id": "dust_front_top",
            "role": "dust",
            "xMm": x_front,
            "yMm": y_top,
            "wMm": L,
            "hMm": H,
            "parentId": "front",
            "hinge": "bottom",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        {
            "id": "tuck_top",
            "role": "tuck",
            "xMm": x_back,
            "yMm": y_top,
            "wMm": L,
            "hMm": H,
            "parentId": "back",
            "hinge": "bottom",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        {
            "id": "dust_back_top",
            "role": "dust",
            "xMm": x_right,
            "yMm": y_top,
            "wMm": H,
            "hMm": H * 0.85,
            "parentId": "right",
            "hinge": "bottom",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        # Bottom flaps
        {
            "id": "dust_front_bottom",
            "role": "dust",
            "xMm": x_front,
            "yMm": y_bottom,
            "wMm": L,
            "hMm": H,
            "parentId": "front",
            "hinge": "top",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        {
            "id": "tuck_bottom",
            "role": "tuck",
            "xMm": x_back,
            "yMm": y_bottom,
            "wMm": L,
            "hMm": H,
            "parentId": "back",
            "hinge": "top",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        {
            "id": "dust_back_bottom",
            "role": "dust",
            "xMm": x_right,
            "yMm": y_bottom,
            "wMm": H,
            "hMm": H * 0.85,
            "parentId": "right",
            "hinge": "top",
            "bodyAngleDeg": 0,
            "flap": True,
        },
    ]

    # UV em fração da net (arte mapeada sobre a net paramétrica)
    for p in panels:
        p["u0"] = round(p["xMm"] / net_w, 6)
        p["v0"] = round(p["yMm"] / net_h, 6)
        p["u1"] = round((p["xMm"] + p["wMm"]) / net_w, 6)
        p["v1"] = round((p["yMm"] + p["hMm"]) / net_h, 6)

    return {
        "netWidthMm": round(net_w, 2),
        "netHeightMm": round(net_h, 2),
        "panels": panels,
        "layout": {
            "glueMm": G,
            "lengthMm": L,
            "widthMm": W,
            "heightMm": H,
        },
    }


def normalize_caixa_config(
    raw: Optional[dict[str, Any]],
    *,
    suggested: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Normaliza CropJson.caixa com defaults e clamps."""
    src = raw if isinstance(raw, dict) else {}
    sug_dims = {}
    if isinstance(suggested, dict):
        sug_dims = suggested.get("dims") if isinstance(suggested.get("dims"), dict) else suggested

    source_kind = str(src.get("sourceKind") or SOURCE_COMBINED).strip().lower()
    if source_kind not in (SOURCE_COMBINED, SOURCE_SEPARATE):
        source_kind = SOURCE_COMBINED

    template = str(src.get("template") or TEMPLATE_TUCK_END_REVERSE).strip()
    if template != TEMPLATE_TUCK_END_REVERSE:
        template = TEMPLATE_TUCK_END_REVERSE

    dims_in = src.get("dimsMm") if isinstance(src.get("dimsMm"), dict) else {}
    length = _clamp_dim(
        dims_in.get("length", dims_in.get("lengthMm", sug_dims.get("lengthMm", 120))),
        120.0,
    )
    width = _clamp_dim(
        dims_in.get("width", dims_in.get("widthMm", sug_dims.get("widthMm", 160))),
        160.0,
    )
    height = _clamp_dim(
        dims_in.get("height", dims_in.get("heightMm", sug_dims.get("heightMm", 40))),
        40.0,
    )
    glue = _clamp_dim(
        dims_in.get("glue", dims_in.get("glueMm", sug_dims.get("glueMm", height * 0.5))),
        max(10.0, height * 0.5),
    )

    faca_page = int(src.get("facaPage") if src.get("facaPage") is not None else 0)
    arte_page = int(src.get("artePage") if src.get("artePage") is not None else 1)
    faca_page = max(0, faca_page)
    arte_page = max(0, arte_page)

    crop_raw = src.get("artCrop") if isinstance(src.get("artCrop"), dict) else src.get("crop")
    art_crop = normalize_crop_sides(crop_raw) if crop_raw else empty_crop("manual")

    rot = src.get("artRotationDeg", 0)
    try:
        rot_i = int(rot)
    except (TypeError, ValueError):
        rot_i = 0
    if rot_i not in (0, 90, 180, 270):
        rot_i = 0

    ops_raw = src.get("openOperations")
    if isinstance(ops_raw, list) and ops_raw:
        open_ops = ops_raw
    else:
        open_ops = default_open_operations()

    confidence = None
    if isinstance(sug_dims, dict) and sug_dims.get("confidence") is not None:
        try:
            confidence = float(sug_dims["confidence"])
        except (TypeError, ValueError):
            confidence = None

    net_meta = src.get("net") if isinstance(src.get("net"), dict) else None

    return {
        "sourceKind": source_kind,
        "template": template,
        "dimsMm": {
            "length": length,
            "width": width,
            "height": height,
            "glue": glue,
        },
        "facaPage": faca_page,
        "artePage": arte_page,
        "artCrop": art_crop,
        "artRotationDeg": rot_i,
        "openOperations": open_ops,
        "net": net_meta,
        "suggestedConfidence": confidence,
        "ready": True,
    }


def build_box_mockup(cfg: dict[str, Any]) -> dict[str, Any]:
    """Metadados do mockup 3D para o manifesto."""
    dims = cfg.get("dimsMm") or {}
    net_dims = {
        "lengthMm": float(dims.get("length") or 120),
        "widthMm": float(dims.get("width") or 160),
        "heightMm": float(dims.get("height") or 40),
        "glueMm": float(dims.get("glue") or 20),
    }
    net = build_tuck_end_net(net_dims)
    return {
        "template": cfg.get("template") or TEMPLATE_TUCK_END_REVERSE,
        "dimsMm": {
            "length": net_dims["lengthMm"],
            "width": net_dims["widthMm"],
            "height": net_dims["heightMm"],
            "glue": net_dims["glueMm"],
        },
        "netWidthMm": net["netWidthMm"],
        "netHeightMm": net["netHeightMm"],
        "panels": net["panels"],
        "openOperations": cfg.get("openOperations") or default_open_operations(),
        "artRotationDeg": int(cfg.get("artRotationDeg") or 0),
        "ready": bool(cfg.get("ready", True)),
        "paperThicknessMm": 0.4,
    }


def suggest_from_dieline(parsed: dict[str, Any]) -> dict[str, Any]:
    """Atalho: parsed dieline → dims + net hints para o wizard."""
    dims = parsed.get("dims") if isinstance(parsed.get("dims"), dict) else {}
    if not dims:
        dims = estimate_tuck_end_dims(
            list(parsed.get("verticalCreasesMm") or []),
            list(parsed.get("horizontalCreasesMm") or []),
        )
    cut = parsed.get("cutBboxMm")
    art_crop = empty_crop("manual")
    if isinstance(cut, dict):
        art_crop = normalize_crop_sides(
            {
                "top": cut.get("top", 0),
                "right": cut.get("right", 0),
                "bottom": cut.get("bottom", 0),
                "left": cut.get("left", 0),
                "source": "faca",
            }
        )
    return {
        "dimsMm": {
            "length": dims.get("lengthMm"),
            "width": dims.get("widthMm"),
            "height": dims.get("heightMm"),
            "glue": dims.get("glueMm"),
        },
        "confidence": dims.get("confidence"),
        "ready": bool(dims.get("ready")),
        "artCrop": art_crop,
        "cutBboxMm": cut,
        "verticalCreasesMm": parsed.get("verticalCreasesMm") or [],
        "horizontalCreasesMm": parsed.get("horizontalCreasesMm") or [],
        "facaPage": parsed.get("facaPage", 0),
        "artePage": parsed.get("artePage", 1),
    }
