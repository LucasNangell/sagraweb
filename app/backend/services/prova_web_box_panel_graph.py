"""
Grafo de painéis a partir de uma faca: grade eixo-alinhada (vincos V/H)
→ células retangulares → hinges nas arestas compartilhadas.
"""
from __future__ import annotations

import math
from typing import Any, Optional


_MIN_PANEL_MM = 8.0
_EDGE_COVER_FRAC = 0.35
_EDGE_TOL_MM = 2.5
_MASK_STEP_MM = 1.5


def _seg_len(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)


def _overlap_1d(a0: float, a1: float, b0: float, b1: float) -> float:
    lo0, hi0 = (a0, a1) if a0 <= a1 else (a1, a0)
    lo1, hi1 = (b0, b1) if b0 <= b1 else (b1, b0)
    return max(0.0, min(hi0, hi1) - max(lo0, lo1))


def _edge_cover_ratio(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    segments: list[dict[str, float]],
    *,
    tol: float = _EDGE_TOL_MM,
) -> float:
    """Fração do comprimento da aresta coberta por segmentos colineares."""
    length = _seg_len(x1, y1, x2, y2)
    if length < 1e-6:
        return 0.0
    covered = 0.0
    axis_v = abs(x1 - x2) <= tol and abs(y1 - y2) > tol
    axis_h = abs(y1 - y2) <= tol and abs(x1 - x2) > tol
    if not axis_v and not axis_h:
        return 0.0
    for s in segments:
        sx1, sy1, sx2, sy2 = s["x1"], s["y1"], s["x2"], s["y2"]
        if axis_v:
            if abs(((sx1 + sx2) / 2.0) - x1) > tol:
                continue
            covered += _overlap_1d(y1, y2, sy1, sy2)
        else:
            if abs(((sy1 + sy2) / 2.0) - y1) > tol:
                continue
            covered += _overlap_1d(x1, x2, sx1, sx2)
    return min(1.0, covered / length)


def _fold_span_on_edge(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    fold_segs: list[dict[str, float]],
    *,
    tol: float = _EDGE_TOL_MM,
    min_cover: float = _EDGE_COVER_FRAC,
) -> Optional[tuple[float, float]]:
    """
    Intervalo 1D (spanStart, spanEnd) da aresta coberto por dobras reais.
    None se a cobertura for insuficiente — não inventa hinge no vão.
    """
    length = _seg_len(x1, y1, x2, y2)
    if length < 1e-6:
        return None
    axis_v = abs(x1 - x2) <= tol and abs(y1 - y2) > tol
    axis_h = abs(y1 - y2) <= tol and abs(x1 - x2) > tol
    if not axis_v and not axis_h:
        return None

    intervals: list[tuple[float, float]] = []
    for s in fold_segs:
        sx1, sy1, sx2, sy2 = s["x1"], s["y1"], s["x2"], s["y2"]
        if axis_v:
            if abs(((sx1 + sx2) / 2.0) - x1) > tol:
                continue
            lo = max(min(y1, y2), min(sy1, sy2))
            hi = min(max(y1, y2), max(sy1, sy2))
        else:
            if abs(((sy1 + sy2) / 2.0) - y1) > tol:
                continue
            lo = max(min(x1, x2), min(sx1, sx2))
            hi = min(max(x1, x2), max(sx1, sx2))
        if hi - lo > 0.2:
            intervals.append((lo, hi))
    if not intervals:
        return None
    intervals.sort()
    merged: list[list[float]] = [[intervals[0][0], intervals[0][1]]]
    for lo, hi in intervals[1:]:
        if lo <= merged[-1][1] + tol:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    best = max(merged, key=lambda it: it[1] - it[0])
    if (best[1] - best[0]) / length < min_cover:
        return None
    return (round(best[0], 2), round(best[1], 2))


def _draw_line_mask(
    mask: list[list[bool]],
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    *,
    ox: float,
    oy: float,
    step: float,
) -> None:
    """Rasteriza segmento no mask (True = borda de corte)."""
    length = _seg_len(x0, y0, x1, y1)
    n = max(1, int(math.ceil(length / max(0.25, step * 0.5))))
    rows = len(mask)
    cols = len(mask[0]) if rows else 0
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * t
        c = int((x - ox) / step)
        r = int((y - oy) / step)
        if 0 <= r < rows and 0 <= c < cols:
            mask[r][c] = True


def _build_inside_cut_mask(
    cut_segs: list[dict[str, float]],
    *,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    step: float = _MASK_STEP_MM,
) -> tuple[list[list[bool]], float, float, float]:
    """
    Máscara: True = interior da peça (dentro do contorno de corte).
    Flood-fill a partir das bordas do bbox = exterior; o que sobrar = interior.
    """
    w = max(step, x1 - x0)
    h = max(step, y1 - y0)
    cols = max(2, int(math.ceil(w / step)) + 1)
    rows = max(2, int(math.ceil(h / step)) + 1)
    border = [[False] * cols for _ in range(rows)]
    for s in cut_segs:
        _draw_line_mask(
            border,
            float(s["x1"]),
            float(s["y1"]),
            float(s["x2"]),
            float(s["y2"]),
            ox=x0,
            oy=y0,
            step=step,
        )
    # Exterior: células alcançáveis do perímetro sem atravessar bordas
    exterior = [[False] * cols for _ in range(rows)]
    stack: list[tuple[int, int]] = []
    for c in range(cols):
        stack.append((0, c))
        stack.append((rows - 1, c))
    for r in range(rows):
        stack.append((r, 0))
        stack.append((r, cols - 1))
    while stack:
        r, c = stack.pop()
        if r < 0 or c < 0 or r >= rows or c >= cols:
            continue
        if exterior[r][c] or border[r][c]:
            continue
        exterior[r][c] = True
        stack.extend(((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)))
    inside = [
        [not exterior[r][c] and not border[r][c] for c in range(cols)]
        for r in range(rows)
    ]
    # Se flood fill engoliu tudo (corte aberto), cai no bbox inteiro
    if not any(any(row) for row in inside):
        inside = [[True] * cols for _ in range(rows)]
    return inside, x0, y0, step


def _point_inside_mask(
    x: float,
    y: float,
    inside: list[list[bool]],
    ox: float,
    oy: float,
    step: float,
) -> bool:
    rows = len(inside)
    cols = len(inside[0]) if rows else 0
    c = int((x - ox) / step)
    r = int((y - oy) / step)
    if r < 0 or c < 0 or r >= rows or c >= cols:
        return False
    return inside[r][c]


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


def build_panel_graph_from_parsed(parsed: dict[str, Any]) -> dict[str, Any]:
    """
    Gera config inicial de modelo de caixa a partir do parse da faca.

    Painéis = células da grade (cut bbox + vincos V/H) cuja borda é
    coberta o suficiente por segmentos de dobra ou pela moldura do corte.
    """
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
    xs = sorted({round(x0, 2), *[round(v, 2) for v in vs], round(x1, 2)})
    ys = sorted({round(y0, 2), *[round(h, 2) for h in hs], round(y1, 2)})

    fold_segs = []
    for s in parsed.get("foldSegmentsMm") or []:
        if not isinstance(s, dict):
            continue
        item: dict[str, Any] = {
            "x1": float(s["x1"]),
            "y1": float(s["y1"]),
            "x2": float(s["x2"]),
            "y2": float(s["y2"]),
        }
        name = s.get("name")
        if isinstance(name, str) and name.strip():
            item["name"] = name.strip()
        fold_segs.append(item)
    cut_segs = []
    for s in parsed.get("cutSegmentsMm") or []:
        if not isinstance(s, dict):
            continue
        item = {
            "x1": float(s["x1"]),
            "y1": float(s["y1"]),
            "x2": float(s["x2"]),
            "y2": float(s["y2"]),
        }
        name = s.get("name")
        if isinstance(name, str) and name.strip():
            item["name"] = name.strip()
        cut_segs.append(item)
    # Só geometria real do SVG — sem moldura AABB (evita painéis fantasmas)
    cover_segs = fold_segs + cut_segs
    if not cover_segs:
        cover_segs = [
            {"x1": x0, "y1": y0, "x2": x1, "y2": y0},
            {"x1": x1, "y1": y0, "x2": x1, "y2": y1},
            {"x1": x1, "y1": y1, "x2": x0, "y2": y1},
            {"x1": x0, "y1": y1, "x2": x0, "y2": y0},
        ]

    inside_mask, mask_ox, mask_oy, mask_step = _build_inside_cut_mask(
        cut_segs or cover_segs,
        x0=x0,
        y0=y0,
        x1=x1,
        y1=y1,
    )

    panels: list[dict[str, Any]] = []
    grid_index: dict[tuple[int, int], str] = {}
    pid = 0
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            xa, xb = xs[i], xs[i + 1]
            ya, yb = ys[j], ys[j + 1]
            w = xb - xa
            h = yb - ya
            if w < _MIN_PANEL_MM or h < _MIN_PANEL_MM:
                continue
            cx = (xa + xb) / 2.0
            cy = (ya + yb) / 2.0
            # Descartar células fora da peça cortada
            if not _point_inside_mask(
                cx, cy, inside_mask, mask_ox, mask_oy, mask_step
            ):
                continue
            edges = [
                (xa, ya, xb, ya),
                (xb, ya, xb, yb),
                (xb, yb, xa, yb),
                (xa, yb, xa, ya),
            ]
            covers = [
                _edge_cover_ratio(e[0], e[1], e[2], e[3], cover_segs) for e in edges
            ]
            strong = sum(1 for c in covers if c >= _EDGE_COVER_FRAC)
            fold_strong = sum(
                1
                for e, c in zip(edges, covers)
                if c >= _EDGE_COVER_FRAC
                and _edge_cover_ratio(e[0], e[1], e[2], e[3], fold_segs)
                >= _EDGE_COVER_FRAC
            )
            # Exige contorno real (corte/dobra); não basta 1 vinco solto
            if strong < 2 and fold_strong < 1:
                continue
            pid += 1
            panel_id = f"p{pid}"
            poly = [
                [round(xa, 2), round(ya, 2)],
                [round(xb, 2), round(ya, 2)],
                [round(xb, 2), round(yb, 2)],
                [round(xa, 2), round(yb, 2)],
            ]
            area = round(w * h, 2)
            panels.append(
                {
                    "id": panel_id,
                    "polygonMm": poly,
                    "xMm": round(xa, 2),
                    "yMm": round(ya, 2),
                    "wMm": round(w, 2),
                    "hMm": round(h, 2),
                    "areaMm2": area,
                    "role": "",
                    "label": panel_id,
                    "active": True,
                }
            )
            grid_index[(i, j)] = panel_id

    # Hinges só onde a aresta compartilhada tem segmento real de dobra
    hinges: list[dict[str, Any]] = []
    hid = 0
    by_id = {p["id"]: p for p in panels}
    for (i, j), a_id in list(grid_index.items()):
        a = by_id[a_id]
        right = grid_index.get((i + 1, j))
        if right:
            x = float(a["xMm"] + a["wMm"])
            y0e = float(a["yMm"])
            y1e = float(a["yMm"] + a["hMm"])
            span = _fold_span_on_edge(x, y0e, x, y1e, fold_segs)
            if span:
                hid += 1
                hinges.append(
                    {
                        "id": f"h{hid}",
                        "panelA": a_id,
                        "panelB": right,
                        "axis": "vertical",
                        "positionMm": round(x, 2),
                        "spanStartMm": span[0],
                        "spanEndMm": span[1],
                        "active": True,
                        "kind": "fold",
                    }
                )
        below = grid_index.get((i, j + 1))
        if below:
            y = float(a["yMm"] + a["hMm"])
            x0e = float(a["xMm"])
            x1e = float(a["xMm"] + a["wMm"])
            span = _fold_span_on_edge(x0e, y, x1e, y, fold_segs)
            if span:
                hid += 1
                hinges.append(
                    {
                        "id": f"h{hid}",
                        "panelA": a_id,
                        "panelB": below,
                        "axis": "horizontal",
                        "positionMm": round(y, 2),
                        "spanStartMm": span[0],
                        "spanEndMm": span[1],
                        "active": True,
                        "kind": "fold",
                    }
                )

    # Base = maior área
    base_id = None
    if panels:
        base = max(panels, key=lambda p: p["areaMm2"])
        base_id = base["id"]
        base["role"] = "base"
        base["label"] = "base"

    # Sequência começa vazia — o admin monta clicando nas dobras
    operations: list[dict[str, Any]] = []

    def _match_hinge(
        x1: float, y1: float, x2: float, y2: float
    ) -> Optional[str]:
        best = None
        best_cover = 0.25
        for h in hinges:
            is_v = h["axis"] == "vertical"
            if is_v:
                hx1 = hx2 = float(h["positionMm"])
                hy1 = float(h["spanStartMm"])
                hy2 = float(h["spanEndMm"])
            else:
                hy1 = hy2 = float(h["positionMm"])
                hx1 = float(h["spanStartMm"])
                hx2 = float(h["spanEndMm"])
            cover = _edge_cover_ratio(
                x1, y1, x2, y2, [{"x1": hx1, "y1": hy1, "x2": hx2, "y2": hy2}]
            )
            # Também mede cobertura da hinge pelo segmento
            cover2 = _edge_cover_ratio(
                hx1, hy1, hx2, hy2, [{"x1": x1, "y1": y1, "x2": x2, "y2": y2}]
            )
            score = max(cover, cover2)
            if score > best_cover:
                best_cover = score
                best = h["id"]
        return best

    # Arestas = só geometria do SVG (corte/dobra). Sem linhas sintéticas.
    edges: list[dict[str, Any]] = []
    eid = 0
    for s in fold_segs:
        eid += 1
        hid_m = _match_hinge(s["x1"], s["y1"], s["x2"], s["y2"])
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
        hid_m = _match_hinge(s["x1"], s["y1"], s["x2"], s["y2"])
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

    # UV relativo ao cut bbox
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
    }
