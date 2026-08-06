"""
Geometria de folheto dobrado — topologia + operações (motor genérico).
"""
from __future__ import annotations

from typing import Any, Optional

from services.prova_web_crop_service import empty_crop, normalize_crop_sides

_MIN_PANEL_MM = 15.0
_POSITION_EPS = 0.01

# preset → list of (axis, fraction, moving_side, towards, order, phase_id|None)
# Geradores espelhados do frontend foldPresets.ts
_PRESET_SPECS: dict[str, list[tuple[str, float, str, str, int, Optional[str]]]] = {
    "biparte_vertical": [("vertical", 0.5, "positive", "front", 1, None)],
    "biparte_horizontal": [("horizontal", 0.5, "positive", "front", 1, None)],
    "triptico_sanfona_vertical": [
        ("vertical", 1 / 3, "negative", "front", 1, None),
        ("vertical", 2 / 3, "positive", "back", 2, None),
    ],
    "triptico_sanfona_horizontal": [
        ("horizontal", 1 / 3, "negative", "front", 1, None),
        ("horizontal", 2 / 3, "positive", "back", 2, None),
    ],
    "triptico_carteira_esquerda": [
        ("vertical", 1 / 3, "negative", "front", 1, None),
        ("vertical", 2 / 3, "positive", "front", 2, None),
    ],
    "triptico_carteira_direita": [
        ("vertical", 2 / 3, "positive", "front", 1, None),
        ("vertical", 1 / 3, "negative", "front", 2, None),
    ],
    "portao": [
        ("vertical", 0.25, "negative", "front", 1, "gate"),
        ("vertical", 0.75, "positive", "front", 1, "gate"),
    ],
    "sanfona_4": [
        ("vertical", 0.25, "negative", "front", 1, None),
        ("vertical", 0.5, "positive", "back", 2, None),
        ("vertical", 0.75, "negative", "front", 3, None),
    ],
    "enrolada_4": [
        ("vertical", 0.75, "positive", "front", 1, None),
        ("vertical", 0.5, "positive", "front", 2, None),
        ("vertical", 0.25, "positive", "front", 3, None),
    ],
    "paralela_dupla": [
        ("vertical", 1 / 3, "negative", "front", 1, None),
        ("vertical", 2 / 3, "negative", "front", 2, None),
    ],
    "cruzado_v_primeiro": [
        ("vertical", 0.5, "positive", "front", 1, None),
        ("horizontal", 0.5, "positive", "front", 2, None),
    ],
    "cruzado_h_primeiro": [
        ("horizontal", 0.5, "positive", "front", 1, None),
        ("vertical", 0.5, "positive", "front", 2, None),
    ],
    "personalizada": [("vertical", 0.5, "positive", "front", 1, None)],
    # legado aliases
    "triptico_vertical": [
        ("vertical", 1 / 3, "negative", "front", 1, None),
        ("vertical", 2 / 3, "positive", "back", 2, None),
    ],
    "triptico_horizontal": [
        ("horizontal", 1 / 3, "negative", "front", 1, None),
        ("horizontal", 2 / 3, "positive", "back", 2, None),
    ],
    "quad_vertical": [
        ("vertical", 0.25, "negative", "front", 1, None),
        ("vertical", 0.5, "positive", "back", 2, None),
        ("vertical", 0.75, "negative", "front", 3, None),
    ],
    "sanfona_vertical": [
        ("vertical", 0.25, "negative", "front", 1, None),
        ("vertical", 0.5, "positive", "back", 2, None),
        ("vertical", 0.75, "negative", "front", 3, None),
    ],
    "cruzado": [
        ("vertical", 0.5, "positive", "front", 1, None),
        ("horizontal", 0.5, "positive", "front", 2, None),
    ],
}


def quantize_mm(value: float) -> float:
    return round(round(value / _POSITION_EPS) * _POSITION_EPS, 4)


def is_legacy_folheto(raw: Optional[dict[str, Any]]) -> bool:
    if not isinstance(raw, dict):
        return False
    creases = raw.get("creases")
    operations = raw.get("operations")
    has_new = isinstance(creases, list) and len(creases) > 0 and isinstance(
        operations, list
    ) and len(operations) > 0
    if has_new:
        return False
    dobras = raw.get("dobras")
    return isinstance(dobras, list) and len(dobras) > 0


def sheet_from_preset(
    preset: str, width_mm: float, height_mm: float
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    specs = _PRESET_SPECS.get(preset) or _PRESET_SPECS["biparte_vertical"]
    creases: list[dict[str, Any]] = []
    operations: list[dict[str, Any]] = []
    # Portão / carteira podem listar same crease twice in ops with different order —
    # generate unique creases by position.
    crease_by_key: dict[tuple[str, float], str] = {}
    for i, (axis, frac, side, towards, order, phase) in enumerate(specs):
        span = width_mm if axis == "vertical" else height_mm
        pos = quantize_mm(span * frac)
        key = (axis, pos)
        if key not in crease_by_key:
            cid = f"c{len(crease_by_key) + 1}"
            crease_by_key[key] = cid
            creases.append({"id": cid, "axis": axis, "positionMm": pos})
        cid = crease_by_key[key]
        op: dict[str, Any] = {
            "id": f"o{i + 1}",
            "creaseId": cid,
            "order": order,
            "movingSide": side,
            "towards": towards,
            "targetAngleDeg": 180,
        }
        if phase:
            op["phaseId"] = phase
        operations.append(op)
    return creases, operations


def _unique_breaks(span: float, cuts: list[float]) -> list[float]:
    pts = [0.0] + [quantize_mm(c) for c in cuts] + [quantize_mm(span)]
    pts = sorted(set(quantize_mm(p) for p in pts))
    out = [pts[0]]
    for p in pts[1:]:
        if abs(p - out[-1]) > _POSITION_EPS / 2:
            out.append(p)
    return out


def build_topology(
    width_mm: float, height_mm: float, creases: list[dict[str, Any]]
) -> dict[str, Any]:
    w = quantize_mm(width_mm)
    h = quantize_mm(height_mm)
    v_cuts = [float(c["positionMm"]) for c in creases if c.get("axis") == "vertical"]
    h_cuts = [float(c["positionMm"]) for c in creases if c.get("axis") == "horizontal"]
    x_breaks = _unique_breaks(w, v_cuts)
    y_breaks = _unique_breaks(h, h_cuts)
    multi_row = len(y_breaks) > 2
    panels: list[dict[str, Any]] = []
    for row in range(len(y_breaks) - 1):
        y0, y1 = y_breaks[row], y_breaks[row + 1]
        for col in range(len(x_breaks) - 1):
            x0, x1 = x_breaks[col], x_breaks[col + 1]
            pid = f"p{row}_{col}" if multi_row else f"p{col}"
            pw = quantize_mm(x1 - x0)
            ph = quantize_mm(y1 - y0)
            panels.append(
                {
                    "id": pid,
                    "row": row,
                    "column": col,
                    "xMm": x0,
                    "yMm": y0,
                    "wMm": pw,
                    "hMm": ph,
                }
            )
    return {"panels": panels, "widthMm": w, "heightMm": h}


def default_panel_pages(
    panels: list[dict[str, Any]], has_verso: bool
) -> list[dict[str, Any]]:
    ordered = sorted(panels, key=lambda p: (p["row"], p["column"]))
    n = len(ordered)
    out: list[dict[str, Any]] = []
    for i, p in enumerate(ordered):
        out.append(
            {
                "panelId": p["id"],
                "frontPage": i + 1,
                "backPage": (2 * n - i) if has_verso else None,
            }
        )
    return out


def normalize_panel_pages(
    raw: Any, panels: list[dict[str, Any]], has_verso: bool
) -> list[dict[str, Any]]:
    fallback = default_panel_pages(panels, has_verso)
    if not isinstance(raw, list) or not raw:
        return fallback
    by_id = {
        str(item.get("panelId")): item
        for item in raw
        if isinstance(item, dict) and item.get("panelId")
    }
    out: list[dict[str, Any]] = []
    for f in fallback:
        hit = by_id.get(f["panelId"])
        if not hit:
            out.append(f)
            continue
        try:
            fp = int(hit.get("frontPage") or f["frontPage"])
        except (TypeError, ValueError):
            fp = f["frontPage"]
        bp = None
        if has_verso:
            try:
                bp = int(hit.get("backPage") or f["backPage"] or 0) or f["backPage"]
            except (TypeError, ValueError):
                bp = f["backPage"]
        out.append({"panelId": f["panelId"], "frontPage": max(1, fp), "backPage": bp})
    return out


def normalize_folheto_config(
    raw: Optional[dict[str, Any]],
    *,
    page_width_mm: float,
    page_height_mm: float,
) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    legacy = is_legacy_folheto(data)

    preset = str(data.get("preset") or "biparte_vertical")
    if preset not in _PRESET_SPECS:
        preset = "biparte_vertical"
    crop = normalize_crop_sides(data.get("crop")) or empty_crop("manual")
    usable_w = max(_MIN_PANEL_MM, page_width_mm - crop["left"] - crop["right"])
    usable_h = max(_MIN_PANEL_MM, page_height_mm - crop["top"] - crop["bottom"])

    if legacy:
        creases, operations = sheet_from_preset("biparte_vertical", usable_w, usable_h)
        validation = [
            {
                "level": "error",
                "code": "legacy_config",
                "message": "Configuração antiga de dobras. Reconfigure no assistente.",
            }
        ]
        ready = False
        preset = "biparte_vertical"
    else:
        creases_raw = data.get("creases")
        ops_raw = data.get("operations")
        if not isinstance(creases_raw, list) or not creases_raw:
            creases, operations = sheet_from_preset(preset, usable_w, usable_h)
        else:
            creases = []
            for i, item in enumerate(creases_raw):
                if not isinstance(item, dict):
                    continue
                axis = item.get("axis") or item.get("eixo")
                if axis not in ("vertical", "horizontal"):
                    continue
                try:
                    pos = float(item.get("positionMm") or item.get("posicaoMm") or 0)
                except (TypeError, ValueError):
                    continue
                span = usable_w if axis == "vertical" else usable_h
                pos = max(_MIN_PANEL_MM, min(span - _MIN_PANEL_MM, pos))
                creases.append(
                    {
                        "id": str(item.get("id") or f"c{i + 1}"),
                        "axis": axis,
                        "positionMm": round(pos, 2),
                    }
                )
            operations = []
            if isinstance(ops_raw, list):
                for i, item in enumerate(ops_raw):
                    if not isinstance(item, dict):
                        continue
                    cid = str(item.get("creaseId") or "")
                    if not cid or not any(c["id"] == cid for c in creases):
                        continue
                    side = item.get("movingSide")
                    if side not in ("negative", "positive"):
                        side = "positive"
                    towards = item.get("towards")
                    if towards not in ("front", "back"):
                        towards = "front"
                    try:
                        order = int(item.get("order") or i + 1)
                    except (TypeError, ValueError):
                        order = i + 1
                    try:
                        ang = float(item.get("targetAngleDeg") or 180)
                    except (TypeError, ValueError):
                        ang = 180
                    op: dict[str, Any] = {
                        "id": str(item.get("id") or f"o{i + 1}"),
                        "creaseId": cid,
                        "order": order,
                        "movingSide": side,
                        "towards": towards,
                        "targetAngleDeg": max(1, min(180, ang)),
                    }
                    if item.get("phaseId"):
                        op["phaseId"] = str(item["phaseId"])
                    try:
                        stagger_raw = item.get("startAfterPrevOpen01")
                        if stagger_raw is not None:
                            stagger = float(stagger_raw)
                            stagger = max(0.0, min(1.0, stagger))
                            if abs(stagger - 1.0) > 1e-6:
                                op["startAfterPrevOpen01"] = round(stagger, 6)
                    except (TypeError, ValueError):
                        pass
                    operations.append(op)
            if not creases or not operations:
                creases, operations = sheet_from_preset(preset, usable_w, usable_h)
        validation = []
        ready = True

    try:
        page_frente = int(
            data.get("pageFrente") if data.get("pageFrente") is not None else 0
        )
    except (TypeError, ValueError):
        page_frente = 0
    page_verso = data.get("pageVerso")
    if page_verso is None:
        verso: Optional[int] = None
    else:
        try:
            verso = int(page_verso)
        except (TypeError, ValueError):
            verso = 1

    return {
        "preset": preset,
        "crop": crop,
        "creases": creases,
        "operations": sorted(operations, key=lambda o: (o["order"], o["id"])),
        "pageFrente": max(0, page_frente),
        "pageVerso": verso,
        "usableWidthMm": round(usable_w, 2),
        "usableHeightMm": round(usable_h, 2),
        "panelPages": data.get("panelPages"),
        "backArtworkTransform": data.get("backArtworkTransform")
        or {"mirrorX": True, "mirrorY": False, "rotationDeg": 0},
        "physical": data.get("physical")
        or {
            "paperThicknessMm": 0.22,
            "renderGapMm": 0.015,
            "creaseRadiusMm": 0.35,
        },
        "validation": validation,
        "ready": ready,
    }


def build_fold_mockup(cfg: dict[str, Any]) -> dict[str, Any]:
    w = float(cfg["usableWidthMm"])
    h = float(cfg["usableHeightMm"])
    creases = list(cfg.get("creases") or [])
    operations = list(cfg.get("operations") or [])
    topo = build_topology(w, h, creases)
    panels = topo["panels"]
    has_verso = cfg.get("pageVerso") is not None
    panel_pages = normalize_panel_pages(cfg.get("panelPages"), panels, has_verso)
    validation = list(cfg.get("validation") or [])
    ready = bool(cfg.get("ready", True)) and not any(
        v.get("level") == "error" for v in validation
    )

    return {
        "preset": cfg.get("preset") or "biparte_vertical",
        "pageWidthMm": round(w, 2),
        "pageHeightMm": round(h, 2),
        "panels": panels,
        "creases": creases,
        "operations": operations,
        "hasVerso": has_verso,
        "panelPages": panel_pages,
        "backArtworkTransform": cfg.get("backArtworkTransform"),
        "physical": cfg.get("physical"),
        "validation": validation,
        "ready": ready,
    }


# Compat tests antigos
def dobras_from_preset(preset: str, width_mm: float, height_mm: float) -> list[dict[str, Any]]:
    creases, operations = sheet_from_preset(preset, width_mm, height_mm)
    out = []
    for i, c in enumerate(creases):
        op = next((o for o in operations if o["creaseId"] == c["id"]), None)
        out.append(
            {
                "id": c["id"],
                "eixo": c["axis"],
                "posicaoMm": c["positionMm"],
                "sentido": "valley" if (op or {}).get("towards") == "front" else "mountain",
                "ordem": (op or {}).get("order", i + 1),
            }
        )
    return out


def default_sequencia_paginas(panel_count: int, has_verso: bool) -> dict[str, Any]:
    n = max(1, int(panel_count))
    frente = list(range(1, n + 1))
    if not has_verso:
        return {"frente": frente, "verso": None}
    return {"frente": frente, "verso": list(range(2 * n, n, -1))}


def normalize_sequencia_paginas(
    raw: Any, panel_count: int, has_verso: bool
) -> dict[str, Any]:
    """Compat: também aceita lista panelPages."""
    if isinstance(raw, list):
        panels = [{"id": f"p{i}", "row": 0, "column": i} for i in range(panel_count)]
        pages = normalize_panel_pages(raw, panels, has_verso)
        return {
            "frente": [p["frontPage"] for p in pages],
            "verso": [p["backPage"] for p in pages] if has_verso else None,
        }
    fallback = default_sequencia_paginas(panel_count, has_verso)
    if not isinstance(raw, dict) or not isinstance(raw.get("frente"), list):
        return fallback
    frente = []
    for i, v in enumerate(raw["frente"]):
        try:
            n = int(v)
            frente.append(n if n > 0 else fallback["frente"][min(i, len(fallback["frente"]) - 1)])
        except (TypeError, ValueError):
            frente.append(fallback["frente"][min(i, len(fallback["frente"]) - 1)])
    while len(frente) < panel_count:
        frente.append(len(frente) + 1)
    frente = frente[:panel_count]
    if not has_verso:
        return {"frente": frente, "verso": None}
    src = raw.get("verso") if isinstance(raw.get("verso"), list) else fallback["verso"]
    verso = []
    for i in range(panel_count):
        try:
            n = int(src[i]) if src and i < len(src) else 0
            verso.append(n if n > 0 else fallback["verso"][i])
        except (TypeError, ValueError, IndexError):
            verso.append(fallback["verso"][i])
    return {"frente": frente, "verso": verso}
