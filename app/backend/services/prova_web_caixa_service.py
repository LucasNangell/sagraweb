"""
Modo Prova WEB caixa (flip-top): normalização de CropJson.caixa e boxMockup.

A faca de referência (ONMP) tem a tampa articulada no painel traseiro
(lid front + lid top), tipología flip-top — não tuck-end simétrico.
"""
from __future__ import annotations

from typing import Any, Optional

from services.prova_web_crop_service import empty_crop, normalize_crop_sides
from services.prova_web_dieline_service import estimate_tuck_end_dims

TEMPLATE_FLIP_TOP = "flip_top"
# Alias legado do MVP inicial (mapeado para flip_top).
TEMPLATE_TUCK_END_REVERSE = "tuck_end_reverse"
_KNOWN_TEMPLATES = frozenset({TEMPLATE_FLIP_TOP, TEMPLATE_TUCK_END_REVERSE})

SOURCE_COMBINED = "combined"
SOURCE_SEPARATE = "separate"
SOURCE_MODEL = "model"

_MIN_DIM_MM = 10.0
_MAX_DIM_MM = 800.0


def _clamp_dim(value: Any, default: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = default
    return round(max(_MIN_DIM_MM, min(_MAX_DIM_MM, v)), 2)


def default_open_operations() -> list[dict[str, Any]]:
    """
    Ordem de abertura flip-top (0=fechado → 1=aberto):
    1) dust laterais  2) tampa (lid_top; lid_front acompanha)  3) fundo opcional.
    """
    return [
        {
            "id": "op_dust_right_top",
            "panelId": "dust_right_top",
            "order": 1,
            "targetAngleDeg": 100,
            "phaseId": "dust",
        },
        {
            "id": "op_dust_left_top",
            "panelId": "dust_left_top",
            "order": 1,
            "targetAngleDeg": 100,
            "phaseId": "dust",
        },
        {
            "id": "op_lid",
            "panelId": "lid_top",
            "order": 2,
            "targetAngleDeg": 120,
            "phaseId": "lid",
        },
        {
            "id": "op_front_collar",
            "panelId": "front_collar",
            "order": 3,
            "targetAngleDeg": 30,
            "phaseId": "collar",
        },
    ]


def build_flip_top_net(dims: dict[str, float]) -> dict[str, Any]:
    """
    Net paramétrica flip-top (mm, origem canto superior esquerdo).

    Layout X: glue | front(L) | right(H) | back(L) | left(H)
    Layout Y: lidFront(H) | lidTop(H) | body(W) | bottom(H)

    A tampa (lid_front + lid_top) existe só na coluna do painel traseiro;
    dust flaps nas laterais na faixa do lid_top.
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

    y_lid_front = 0.0
    y_lid_top = H
    y_body = 2.0 * H
    y_bottom = 2.0 * H + W

    net_w = G + L + H + L + H
    net_h = 3.0 * H + W

    panels: list[dict[str, Any]] = [
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
        # Tampa flip-top (só no back)
        {
            "id": "lid_top",
            "role": "lid",
            "xMm": x_back,
            "yMm": y_lid_top,
            "wMm": L,
            "hMm": H,
            "parentId": "back",
            "hinge": "bottom",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        {
            "id": "lid_front",
            "role": "lid",
            "xMm": x_back,
            "yMm": y_lid_front,
            "wMm": L,
            "hMm": H,
            "parentId": "lid_top",
            "hinge": "bottom",
            "bodyAngleDeg": 90,
            "flap": True,
        },
        # Dust laterais na faixa do topo da tampa
        {
            "id": "dust_right_top",
            "role": "dust",
            "xMm": x_right,
            "yMm": y_lid_top,
            "wMm": H,
            "hMm": H * 0.9,
            "parentId": "right",
            "hinge": "bottom",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        {
            "id": "dust_left_top",
            "role": "dust",
            "xMm": x_left,
            "yMm": y_lid_top,
            "wMm": H,
            "hMm": H * 0.9,
            "parentId": "left",
            "hinge": "bottom",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        # Gola / aba frontal (ficará sob a tampa)
        {
            "id": "front_collar",
            "role": "collar",
            "xMm": x_front,
            "yMm": y_lid_top,
            "wMm": L,
            "hMm": H * 0.85,
            "parentId": "front",
            "hinge": "bottom",
            "bodyAngleDeg": 0,
            "flap": True,
        },
        # Fundo (crash / tuck) — permanece fechado no mockup
        {
            "id": "bottom_back",
            "role": "bottom",
            "xMm": x_back,
            "yMm": y_bottom,
            "wMm": L,
            "hMm": H,
            "parentId": "back",
            "hinge": "top",
            "bodyAngleDeg": 0,
            "flap": False,
        },
        {
            "id": "bottom_front",
            "role": "bottom",
            "xMm": x_front,
            "yMm": y_bottom,
            "wMm": L,
            "hMm": H,
            "parentId": "front",
            "hinge": "top",
            "bodyAngleDeg": 0,
            "flap": False,
        },
    ]

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


# Compatível com imports/testes antigos
def build_tuck_end_net(dims: dict[str, float]) -> dict[str, Any]:
    return build_flip_top_net(dims)


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
    if source_kind not in (SOURCE_COMBINED, SOURCE_SEPARATE, SOURCE_MODEL):
        source_kind = SOURCE_COMBINED

    template = str(src.get("template") or TEMPLATE_FLIP_TOP).strip()
    if source_kind == SOURCE_MODEL:
        template = "graph"
    elif template not in _KNOWN_TEMPLATES:
        template = TEMPLATE_FLIP_TOP
    # MVP antigo gravava tuck_end_reverse — comportamento agora é flip_top
    if template == TEMPLATE_TUCK_END_REVERSE:
        template = TEMPLATE_FLIP_TOP

    box_model_id = src.get("boxModelId")
    try:
        box_model_id_i = int(box_model_id) if box_model_id is not None else None
    except (TypeError, ValueError):
        box_model_id_i = None

    art_transform = None
    raw_tf = src.get("artTransform")
    if isinstance(raw_tf, dict):
        try:
            art_transform = {
                "txMm": float(raw_tf.get("txMm") or 0),
                "tyMm": float(raw_tf.get("tyMm") or 0),
                "scale": max(0.1, min(5.0, float(raw_tf.get("scale") or 1))),
                "rotationDeg": float(raw_tf.get("rotationDeg") or 0),
            }
        except (TypeError, ValueError):
            art_transform = {"txMm": 0.0, "tyMm": 0.0, "scale": 1.0, "rotationDeg": 0.0}

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
        # Migra operações antigas (tuck_top) para o set flip-top
        ids = {str(o.get("panelId") or "") for o in ops_raw if isinstance(o, dict)}
        if "lid_top" in ids or not ids.intersection({"tuck_top", "dust_front_top"}):
            open_ops = ops_raw
        else:
            open_ops = default_open_operations()
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
        "boxModelId": box_model_id_i,
        "artTransform": art_transform,
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
    net = build_flip_top_net(net_dims)
    return {
        "template": cfg.get("template") or TEMPLATE_FLIP_TOP,
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
        "template": TEMPLATE_FLIP_TOP,
    }
