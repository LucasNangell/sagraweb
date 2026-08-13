"""
Grafo de painéis a partir de uma faca: faces topológicas (shapely polygonize)
→ hinges com segmento 2D real → edges / operations.
"""
from __future__ import annotations

import math
from typing import Any, Optional

from shapely import set_precision
from shapely.geometry import LineString, MultiLineString, Point, Polygon
from shapely.ops import polygonize, unary_union

_MIN_FACE_MM2 = 64.0  # ~8×8 mm
_WELD_TOL_MM = 0.05
_FOLD_MATCH_TOL_MM = 0.8
_FOLD_COVER_FRAC = 0.5
_AXIS_ORTHO_TOL_MM = 0.8
_MIN_PANEL_MM = 8.0


def _seg_len(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def _polygon_area(poly: list[list[float]]) -> float:
    if len(poly) < 3:
        return 0.0
    a = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        a += x0 * y1 - x1 * y0
    return abs(a) * 0.5


def _poly_aabb(poly: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _rect_polygon(xa: float, ya: float, xb: float, yb: float) -> list[list[float]]:
    return [
        [round(xa, 2), round(ya, 2)],
        [round(xb, 2), round(ya, 2)],
        [round(xb, 2), round(yb, 2)],
        [round(xa, 2), round(yb, 2)],
    ]


def _coords_to_poly_mm(coords) -> list[list[float]]:
    pts = [[round(float(x), 2), round(float(y), 2)] for x, y in coords]
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def _normalize_seg_dict(s: dict[str, Any]) -> Optional[dict[str, Any]]:
    try:
        item: dict[str, Any] = {
            "x1": float(s["x1"]),
            "y1": float(s["y1"]),
            "x2": float(s["x2"]),
            "y2": float(s["y2"]),
        }
    except (KeyError, TypeError, ValueError):
        return None
    if _seg_len(item["x1"], item["y1"], item["x2"], item["y2"]) < 0.15:
        return None
    for key in (
        "name",
        "foldOrder",
        "foldAngleDeg",
        "foldTowards",
        "foldMovingSide",
    ):
        val = s.get(key)
        if val is not None and val != "":
            item[key] = val
    return item


def _lines_from_segs(segs: list[dict[str, Any]]) -> list[LineString]:
    lines: list[LineString] = []
    for s in segs:
        try:
            ls = LineString(
                [(float(s["x1"]), float(s["y1"])), (float(s["x2"]), float(s["y2"]))]
            )
        except (KeyError, TypeError, ValueError):
            continue
        if ls.length >= 0.15:
            lines.append(ls)
    return lines


def _polygonize_faces(
    cut_segs: list[dict[str, Any]],
    fold_segs: list[dict[str, Any]],
) -> tuple[list[Polygon], list[dict[str, Any]]]:
    """Extrai faces mínimas; warnings se o arranjo não fecha."""
    warnings: list[dict[str, Any]] = []
    lines = _lines_from_segs(cut_segs) + _lines_from_segs(fold_segs)
    if not lines:
        return [], [
            {
                "code": "no_geometry",
                "message": "Nenhum segmento de corte/dobra para polygonize.",
                "pointMm": None,
            }
        ]

    try:
        merged = unary_union(lines)
        noded = set_precision(merged, _WELD_TOL_MM)
    except Exception as exc:  # noqa: BLE001 — geometria degenerada
        warnings.append(
            {
                "code": "noding_failed",
                "message": f"Falha ao nodar geometria: {exc}",
                "pointMm": None,
            }
        )
        return [], warnings

    faces = [f for f in polygonize(noded) if isinstance(f, Polygon) and not f.is_empty]
    kept: list[Polygon] = []
    for face in faces:
        if face.area < _MIN_FACE_MM2:
            c = face.representative_point()
            warnings.append(
                {
                    "code": "face_too_small",
                    "message": f"Face descartada (área {face.area:.1f} mm² < {_MIN_FACE_MM2}).",
                    "pointMm": [round(c.x, 2), round(c.y, 2)],
                }
            )
            continue
        minx, miny, maxx, maxy = face.bounds
        if (maxx - minx) < 1.0 or (maxy - miny) < 1.0:
            continue
        kept.append(face)

    if not kept and lines:
        # Contorno aberto → polygonize vazio
        endpoints: list[Point] = []
        geom = noded if not isinstance(noded, MultiLineString) else noded
        parts = list(geom.geoms) if hasattr(geom, "geoms") else [geom]
        for part in parts:
            if isinstance(part, LineString) and len(part.coords) >= 2:
                endpoints.append(Point(part.coords[0]))
                endpoints.append(Point(part.coords[-1]))
        # Ponta com grau ímpar ≈ vão
        gap_pt = None
        for ep in endpoints:
            count = sum(1 for o in endpoints if ep.distance(o) <= _WELD_TOL_MM * 2)
            if count % 2 == 1:
                gap_pt = [round(ep.x, 2), round(ep.y, 2)]
                break
        warnings.append(
            {
                "code": "open_contour",
                "message": "Contorno de corte/dobra não fecha — nenhuma face extraída.",
                "pointMm": gap_pt,
            }
        )

    return kept, warnings


def _axis_from_segment(
    x1: float, y1: float, x2: float, y2: float
) -> tuple[str, float, float, float]:
    """Retorna (axis, positionMm, spanStartMm, spanEndMm)."""
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    if dx <= _AXIS_ORTHO_TOL_MM and dy > _AXIS_ORTHO_TOL_MM:
        return (
            "vertical",
            round((x1 + x2) / 2.0, 2),
            round(min(y1, y2), 2),
            round(max(y1, y2), 2),
        )
    if dy <= _AXIS_ORTHO_TOL_MM and dx > _AXIS_ORTHO_TOL_MM:
        return (
            "horizontal",
            round((y1 + y2) / 2.0, 2),
            round(min(x1, x2), 2),
            round(max(x1, x2), 2),
        )
    # Oblíquo: position = média; span ao longo do eixo dominante
    if dx >= dy:
        return (
            "oblique",
            round((y1 + y2) / 2.0, 2),
            round(min(x1, x2), 2),
            round(max(x1, x2), 2),
        )
    return (
        "oblique",
        round((x1 + x2) / 2.0, 2),
        round(min(y1, y2), 2),
        round(max(y1, y2), 2),
    )


def _segment_overlap_length(face: Polygon, fold_line: LineString) -> float:
    try:
        buffered = face.exterior.buffer(_FOLD_MATCH_TOL_MM, cap_style=2, join_style=2)
        inter = buffered.intersection(fold_line)
        if inter.is_empty:
            return 0.0
        return float(inter.length)
    except Exception:  # noqa: BLE001
        return 0.0


def _pair_fold_to_panels(
    fold_line: LineString,
    panels: list[dict[str, Any]],
    face_by_id: dict[str, Polygon],
) -> Optional[tuple[str, str]]:
    """Dois painéis cuja borda cobre ≥50% do segmento de dobra."""
    length = fold_line.length
    if length < 0.2:
        return None
    scored: list[tuple[float, str]] = []
    for p in panels:
        face = face_by_id.get(p["id"])
        if face is None:
            continue
        cover = _segment_overlap_length(face, fold_line)
        if cover / length >= _FOLD_COVER_FRAC:
            scored.append((cover, p["id"]))
    scored.sort(reverse=True)
    if len(scored) < 2:
        return None
    a, b = scored[0][1], scored[1][1]
    if a == b:
        return None
    return a, b


def _build_hinges_from_folds(
    fold_segs: list[dict[str, Any]],
    panels: list[dict[str, Any]],
    face_by_id: dict[str, Polygon],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Hinges + operations (quando data-fold-order presente) + warnings."""
    hinges: list[dict[str, Any]] = []
    operations: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    hid = 0
    oid = 0
    seen_pairs: set[tuple[str, str, str]] = set()

    for s in fold_segs:
        fold_line = LineString([(s["x1"], s["y1"]), (s["x2"], s["y2"])])
        pair = _pair_fold_to_panels(fold_line, panels, face_by_id)
        mid = [
            round((s["x1"] + s["x2"]) / 2.0, 2),
            round((s["y1"] + s["y2"]) / 2.0, 2),
        ]
        if not pair:
            warnings.append(
                {
                    "code": "fold_unmatched",
                    "message": "Dobra não separa duas faces detectadas.",
                    "pointMm": mid,
                }
            )
            continue
        panel_a, panel_b = pair
        axis, pos, span0, span1 = _axis_from_segment(
            s["x1"], s["y1"], s["x2"], s["y2"]
        )
        if axis == "oblique":
            warnings.append(
                {
                    "code": "oblique_fold",
                    "message": "Dobra oblíqua detectada.",
                    "pointMm": mid,
                }
            )
        key = (panel_a, panel_b, f"{round(s['x1'],1)}:{round(s['y1'],1)}")
        key2 = (panel_b, panel_a, f"{round(s['x1'],1)}:{round(s['y1'],1)}")
        if key in seen_pairs or key2 in seen_pairs:
            continue
        seen_pairs.add(key)
        hid += 1
        hinge_id = f"h{hid}"
        hinge: dict[str, Any] = {
            "id": hinge_id,
            "panelA": panel_a,
            "panelB": panel_b,
            "axis": axis,
            "positionMm": pos,
            "spanStartMm": span0,
            "spanEndMm": span1,
            "segmentMm": [
                [round(s["x1"], 2), round(s["y1"], 2)],
                [round(s["x2"], 2), round(s["y2"], 2)],
            ],
            "active": True,
            "kind": "fold",
        }
        name = s.get("name")
        if isinstance(name, str) and name.strip():
            hinge["name"] = name.strip()
        hinges.append(hinge)

        fold_order = s.get("foldOrder")
        if fold_order is not None and str(fold_order).strip() != "":
            try:
                order = int(fold_order)
            except (TypeError, ValueError):
                continue
            oid += 1
            try:
                angle = float(
                    s["foldAngleDeg"]
                    if s.get("foldAngleDeg") is not None
                    else 90
                )
            except (TypeError, ValueError):
                angle = 90.0
            towards = str(s.get("foldTowards") or "front").strip().lower()
            if towards not in ("front", "back"):
                towards = "front"
            side = str(s.get("foldMovingSide") or "positive").strip().lower()
            if side not in ("positive", "negative"):
                side = "positive"
            # Painel móvel = o de menor área (aba), fallback panelB
            pa = next((p for p in panels if p["id"] == panel_a), None)
            pb = next((p for p in panels if p["id"] == panel_b), None)
            moving = panel_b
            if pa and pb:
                moving = panel_a if pa["areaMm2"] <= pb["areaMm2"] else panel_b
            operations.append(
                {
                    "id": f"op{oid}",
                    "hingeId": hinge_id,
                    "panelId": moving,
                    "order": order,
                    "movingSide": side,
                    "towards": towards,
                    "targetAngleDeg": max(-180.0, min(180.0, angle)),
                }
            )

    # Painéis sem nenhuma dobra
    hinged = {h["panelA"] for h in hinges} | {h["panelB"] for h in hinges}
    for p in panels:
        if p["id"] not in hinged and p.get("role") != "base":
            warnings.append(
                {
                    "code": "panel_no_fold",
                    "message": f"Painel {p['id']} sem dobra associada.",
                    "pointMm": [
                        round(p["xMm"] + p["wMm"] / 2, 2),
                        round(p["yMm"] + p["hMm"] / 2, 2),
                    ],
                }
            )

    return hinges, operations, warnings


def _match_hinge_to_seg(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    hinges: list[dict[str, Any]],
) -> Optional[str]:
    seg = LineString([(x1, y1), (x2, y2)])
    if seg.length < 0.15:
        return None
    best = None
    best_score = 0.25
    for h in hinges:
        sm = h.get("segmentMm")
        if (
            isinstance(sm, list)
            and len(sm) >= 2
            and isinstance(sm[0], (list, tuple))
            and isinstance(sm[1], (list, tuple))
        ):
            hl = LineString(
                [(float(sm[0][0]), float(sm[0][1])), (float(sm[1][0]), float(sm[1][1]))]
            )
        else:
            # Fallback AABB-era
            if h.get("axis") == "vertical":
                hx = float(h["positionMm"])
                hl = LineString(
                    [(hx, float(h["spanStartMm"])), (hx, float(h["spanEndMm"]))]
                )
            else:
                hy = float(h["positionMm"])
                hl = LineString(
                    [(float(h["spanStartMm"]), hy), (float(h["spanEndMm"]), hy)]
                )
        try:
            d = seg.hausdorff_distance(hl)
        except Exception:  # noqa: BLE001
            continue
        # Score: proximidade + overlap relativo
        score = 1.0 / (1.0 + d)
        if d <= _FOLD_MATCH_TOL_MM * 2 and score > best_score:
            best_score = score
            best = h["id"]
    return best


def build_panel_graph_from_parsed(parsed: dict[str, Any]) -> dict[str, Any]:
    """
    Gera config inicial de modelo de caixa a partir do parse da faca.

    Painéis = faces mínimas do arranjo planar (corte ∪ dobra) via shapely
    polygonize. Hinges = segmentos de dobra que separam duas faces.
    """
    warnings: list[dict[str, Any]] = []

    cut = parsed.get("cutBboxMm") if isinstance(parsed.get("cutBboxMm"), dict) else None
    page_w = float(parsed.get("pageWidthMm") or 0)
    page_h = float(parsed.get("pageHeightMm") or 0)
    if not cut:
        cut = {
            "x0Mm": 0.0,
            "y0Mm": 0.0,
            "x1Mm": page_w or 100.0,
            "y1Mm": page_h or 100.0,
            "widthMm": page_w or 100.0,
            "heightMm": page_h or 100.0,
        }

    x0 = float(cut.get("x0Mm") or 0)
    y0 = float(cut.get("y0Mm") or 0)
    x1 = float(cut.get("x1Mm") or (x0 + float(cut.get("widthMm") or 100)))
    y1 = float(cut.get("y1Mm") or (y0 + float(cut.get("heightMm") or 100)))

    vs = [
        float(v)
        for v in (parsed.get("verticalCreasesMm") or [])
        if x0 + 1 < float(v) < x1 - 1
    ]
    hs = [
        float(h)
        for h in (parsed.get("horizontalCreasesMm") or [])
        if y0 + 1 < float(h) < y1 - 1
    ]

    fold_segs: list[dict[str, Any]] = []
    for s in parsed.get("foldSegmentsMm") or []:
        if isinstance(s, dict):
            item = _normalize_seg_dict(s)
            if item:
                fold_segs.append(item)
    cut_segs: list[dict[str, Any]] = []
    for s in parsed.get("cutSegmentsMm") or []:
        if isinstance(s, dict):
            item = _normalize_seg_dict(s)
            if item:
                cut_segs.append(item)

    explicit = parsed.get("explicitPanelsMm")
    panels: list[dict[str, Any]] = []
    face_by_id: dict[str, Polygon] = {}
    pid = 0

    if isinstance(explicit, list) and len(explicit) >= 1:
        for ep in explicit:
            if not isinstance(ep, dict):
                continue
            poly = ep.get("polygonMm")
            if not isinstance(poly, list) or len(poly) < 3:
                continue
            poly_n = [
                [round(float(p[0]), 2), round(float(p[1]), 2)]
                for p in poly
                if isinstance(p, (list, tuple)) and len(p) >= 2
            ]
            if len(poly_n) < 3:
                continue
            xa, ya, xb, yb = _poly_aabb(poly_n)
            w, h = xb - xa, yb - ya
            if w < 1 or h < 1:
                continue
            pid += 1
            panel_id = str(ep.get("id") or f"p{pid}")
            area = round(_polygon_area(poly_n), 2)
            panels.append(
                {
                    "id": panel_id,
                    "polygonMm": poly_n,
                    "xMm": round(xa, 2),
                    "yMm": round(ya, 2),
                    "wMm": round(w, 2),
                    "hMm": round(h, 2),
                    "areaMm2": area,
                    "role": "",
                    "label": str(ep.get("label") or panel_id),
                    "active": True,
                }
            )
            try:
                ring = poly_n + ([poly_n[0]] if poly_n[0] != poly_n[-1] else [])
                face_by_id[panel_id] = Polygon(ring)
            except Exception:  # noqa: BLE001
                pass
    else:
        faces, face_warnings = _polygonize_faces(cut_segs, fold_segs)
        warnings.extend(face_warnings)
        # Ordena por área desc para IDs estáveis relativos ao tamanho
        faces_sorted = sorted(faces, key=lambda f: (-f.area, f.bounds))
        for face in faces_sorted:
            poly_n = _coords_to_poly_mm(face.exterior.coords)
            if len(poly_n) < 3:
                continue
            xa, ya, xb, yb = face.bounds
            w, h = xb - xa, yb - ya
            if w < 1 or h < 1:
                continue
            pid += 1
            panel_id = f"p{pid}"
            panels.append(
                {
                    "id": panel_id,
                    "polygonMm": poly_n,
                    "xMm": round(xa, 2),
                    "yMm": round(ya, 2),
                    "wMm": round(w, 2),
                    "hMm": round(h, 2),
                    "areaMm2": round(float(face.area), 2),
                    "role": "",
                    "label": panel_id,
                    "active": True,
                }
            )
            face_by_id[panel_id] = face

    # Contorno da peça
    net_outline: list[list[float]] = []
    raw_outline = parsed.get("netOutlineMm")
    if isinstance(raw_outline, list) and len(raw_outline) >= 3:
        net_outline = [
            [round(float(p[0]), 2), round(float(p[1]), 2)]
            for p in raw_outline
            if isinstance(p, (list, tuple)) and len(p) >= 2
        ]
    if len(net_outline) < 3 and face_by_id:
        try:
            unioned = unary_union(list(face_by_id.values()))
            if isinstance(unioned, Polygon) and not unioned.is_empty:
                net_outline = _coords_to_poly_mm(unioned.exterior.coords)
            elif hasattr(unioned, "geoms"):
                biggest = max(
                    (g for g in unioned.geoms if isinstance(g, Polygon)),
                    key=lambda g: g.area,
                    default=None,
                )
                if biggest is not None:
                    net_outline = _coords_to_poly_mm(biggest.exterior.coords)
        except Exception:  # noqa: BLE001
            pass
    if len(net_outline) < 3:
        net_outline = _rect_polygon(x0, y0, x1, y1)

    # Base = maior área
    base_id = None
    if panels:
        base = max(panels, key=lambda p: p["areaMm2"])
        base_id = base["id"]
        base["role"] = "base"
        base["label"] = "base"

    hinges, operations, hinge_warnings = _build_hinges_from_folds(
        fold_segs, panels, face_by_id
    )
    warnings.extend(hinge_warnings)

    edges: list[dict[str, Any]] = []
    eid = 0
    for s in fold_segs:
        eid += 1
        hid_m = _match_hinge_to_seg(s["x1"], s["y1"], s["x2"], s["y2"], hinges)
        edge: dict[str, Any] = {
            "id": f"e{eid}",
            "kind": "fold",
            "x1": round(s["x1"], 2),
            "y1": round(s["y1"], 2),
            "x2": round(s["x2"], 2),
            "y2": round(s["y2"], 2),
            "hingeId": hid_m,
            "source": "fold",
        }
        name = s.get("name") if isinstance(s.get("name"), str) else None
        if name:
            edge["name"] = name
        edges.append(edge)
    for s in cut_segs:
        eid += 1
        hid_m = _match_hinge_to_seg(s["x1"], s["y1"], s["x2"], s["y2"], hinges)
        edge = {
            "id": f"e{eid}",
            "kind": "cut",
            "x1": round(s["x1"], 2),
            "y1": round(s["y1"], 2),
            "x2": round(s["x2"], 2),
            "y2": round(s["y2"], 2),
            "hingeId": hid_m,
            "source": "cut",
        }
        name = s.get("name") if isinstance(s.get("name"), str) else None
        if name:
            edge["name"] = name
        edges.append(edge)

    net_w = max(1.0, x1 - x0)
    net_h = max(1.0, y1 - y0)
    for p in panels:
        p["u0"] = round((p["xMm"] - x0) / net_w, 6)
        p["v0"] = round((p["yMm"] - y0) / net_h, 6)
        p["u1"] = round((p["xMm"] + p["wMm"] - x0) / net_w, 6)
        p["v1"] = round((p["yMm"] + p["hMm"] - y0) / net_h, 6)

    return {
        "version": 1,
        "pageWidthMm": page_w,
        "pageHeightMm": page_h,
        "cutBboxMm": {
            "x0Mm": round(x0, 2),
            "y0Mm": round(y0, 2),
            "x1Mm": round(x1, 2),
            "y1Mm": round(y1, 2),
            "widthMm": round(net_w, 2),
            "heightMm": round(net_h, 2),
        },
        "netOutlineMm": net_outline,
        "verticalCreasesMm": vs,
        "horizontalCreasesMm": hs,
        "foldSegmentsMm": fold_segs,
        "cutSegmentsMm": cut_segs,
        "edges": edges,
        "panels": panels,
        "hinges": hinges,
        "operations": operations,
        "basePanelId": base_id,
        "dimsHint": parsed.get("dims"),
        "parseWarnings": warnings,
    }
