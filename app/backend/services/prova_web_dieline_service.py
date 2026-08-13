"""
Parser de faca (dieline) para Prova WEB modo caixa.

Classifica traços do PDF (PyMuPDF get_drawings): pontilhado = dobra,
contínuo = corte. Estima L×W×H de um tuck-end a partir da grade de vincos.
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional

PT_TO_MM = 25.4 / 72.0

_DASH_SOLID_RE = re.compile(r"^\[\s*\]")


def pt_to_mm(value: float) -> float:
    return float(value) * PT_TO_MM


def mm_to_pt(value: float) -> float:
    return float(value) / PT_TO_MM


def is_dashed_stroke(dashes: Any) -> bool:
    """True quando o stroke é pontilhado (dobra); False = contínuo (corte)."""
    if dashes is None:
        return False
    if isinstance(dashes, (list, tuple)):
        if not dashes:
            return False
        arr = dashes[0] if isinstance(dashes[0], (list, tuple)) else dashes
        try:
            return bool(arr) and any(float(x) > 0 for x in arr)
        except (TypeError, ValueError):
            return bool(arr)
    s = str(dashes).strip()
    if not s:
        return False
    if _DASH_SOLID_RE.match(s):
        return False
    if s.startswith("["):
        return True
    return False


def _cluster(values: list[float], tol: float) -> list[float]:
    if not values:
        return []
    ordered = sorted(values)
    out: list[list[float]] = []
    for v in ordered:
        if not out or abs(v - out[-1][0]) > tol:
            out.append([v, 1.0])
        else:
            n = out[-1][1]
            out[-1][0] = (out[-1][0] * n + v) / (n + 1.0)
            out[-1][1] = n + 1.0
    return [round(x[0], 4) for x in out]


def _line_segments(drawing: dict[str, Any]) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    segs: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for item in drawing.get("items") or []:
        if not item:
            continue
        kind = item[0]
        if kind == "l" and len(item) >= 3:
            p1, p2 = item[1], item[2]
            segs.append(((float(p1.x), float(p1.y)), (float(p2.x), float(p2.y))))
        elif kind == "re" and len(item) >= 2:
            rect = item[1]
            x0, y0 = float(rect.x0), float(rect.y0)
            x1, y1 = float(rect.x1), float(rect.y1)
            segs.extend(
                [
                    ((x0, y0), (x1, y0)),
                    ((x1, y0), (x1, y1)),
                    ((x1, y1), (x0, y1)),
                    ((x0, y1), (x0, y0)),
                ]
            )
        elif kind == "c" and len(item) >= 5:
            # Cubics do PyMuPDF: (c, p1, p2, p3, p4) — p1=atual, p2/p3=ctrl, p4=fim
            from services.prova_web_dieline_svg import _cubic_bezier_points

            pts = [item[i] for i in range(1, 5)]
            p0 = (float(pts[0].x), float(pts[0].y))
            p1 = (float(pts[1].x), float(pts[1].y))
            p2 = (float(pts[2].x), float(pts[2].y))
            p3 = (float(pts[3].x), float(pts[3].y))
            curve = [p0] + _cubic_bezier_points(p0, p1, p2, p3)
            for i in range(len(curve) - 1):
                segs.append((curve[i], curve[i + 1]))
        elif kind == "qu" and len(item) >= 2:
            # Quad: lista de pontos do path
            qpts = list(item[1]) if hasattr(item[1], "__iter__") else []
            coords = [(float(p.x), float(p.y)) for p in qpts]
            for i in range(len(coords) - 1):
                segs.append((coords[i], coords[i + 1]))
    return segs


def _path_points(drawing: dict[str, Any]) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for item in drawing.get("items") or []:
        if not item:
            continue
        kind = item[0]
        if kind == "l" and len(item) >= 3:
            for p in (item[1], item[2]):
                pts.append((float(p.x), float(p.y)))
        elif kind == "c" and len(item) >= 5:
            for p in item[1:5]:
                pts.append((float(p.x), float(p.y)))
        elif kind == "re" and len(item) >= 2:
            rect = item[1]
            pts.extend(
                [
                    (float(rect.x0), float(rect.y0)),
                    (float(rect.x1), float(rect.y1)),
                ]
            )
        elif kind == "qu" and len(item) >= 2:
            # quad points
            for p in item[1]:
                pts.append((float(p.x), float(p.y)))
    if not pts:
        rect = drawing.get("rect")
        if rect is not None:
            pts = [
                (float(rect.x0), float(rect.y0)),
                (float(rect.x1), float(rect.y1)),
            ]
    return pts


def classify_drawings(
    drawings: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cuts: list[dict[str, Any]] = []
    folds: list[dict[str, Any]] = []
    for d in drawings:
        width = float(d.get("width") or 0)
        dashed = is_dashed_stroke(d.get("dashes"))
        # Backup: stroke mais grosso e sólido → corte
        if dashed:
            folds.append(d)
        elif width >= 0.75 or not dashed:
            cuts.append(d)
        else:
            folds.append(d)
    return cuts, folds


def _bbox_from_drawings(drawings: list[dict[str, Any]]) -> Optional[dict[str, float]]:
    xs: list[float] = []
    ys: list[float] = []
    for d in drawings:
        for x, y in _path_points(d):
            xs.append(x)
            ys.append(y)
    if not xs or not ys:
        return None
    return {
        "x0": min(xs),
        "y0": min(ys),
        "x1": max(xs),
        "y1": max(ys),
    }


def _fold_axes(
    folds: list[dict[str, Any]], *, axis_tol_pt: float = 1.5, min_len_pt: float = 8.0
) -> tuple[list[float], list[float]]:
    vs: list[float] = []
    hs: list[float] = []
    for d in folds:
        for (p1, p2) in _line_segments(d):
            dx = abs(p1[0] - p2[0])
            dy = abs(p1[1] - p2[1])
            length = math.hypot(dx, dy)
            if length < min_len_pt:
                continue
            if dx <= axis_tol_pt and dy > min_len_pt:
                vs.append((p1[0] + p2[0]) / 2.0)
            elif dy <= axis_tol_pt and dx > min_len_pt:
                hs.append((p1[1] + p2[1]) / 2.0)
    return _cluster(vs, tol=4.0), _cluster(hs, tol=4.0)


def _deltas(positions: list[float]) -> list[float]:
    return [positions[i + 1] - positions[i] for i in range(len(positions) - 1)]


def estimate_tuck_end_dims(
    vertical_mm: list[float],
    horizontal_mm: list[float],
) -> dict[str, Any]:
    """
    Heurística tuck-end: grade de vincos → length/width/height/glueMm.

    Layout típico (eixo X = painéis do corpo; eixo Y = flaps + face):
      [glue?][L][H][L][H]  ×  [H][W][H]
    """
    vd = [round(x, 2) for x in _deltas(vertical_mm)]
    hd = [round(x, 2) for x in _deltas(horizontal_mm)]

    confidence = 0.2
    notes: list[str] = []

    height: Optional[float] = None
    length: Optional[float] = None
    width: Optional[float] = None
    glue: Optional[float] = None

    # Height: menor espaçamento frequente (~lado / flap)
    all_d = [d for d in vd + hd if d > 8]
    if all_d:
        buckets: dict[int, list[float]] = {}
        for d in all_d:
            key = int(round(d / 2.0) * 2)
            buckets.setdefault(key, []).append(d)
        best_key = max(buckets.keys(), key=lambda k: (len(buckets[k]), -abs(k)))
        if len(buckets[best_key]) >= 2:
            height = sum(buckets[best_key]) / len(buckets[best_key])
            confidence += 0.25
            notes.append("height_from_repeated_spacing")

    # Width: maior delta horizontal (painel central da face)
    if hd:
        width = max(hd)
        if height and width > height * 1.2:
            confidence += 0.2
            notes.append("width_from_max_h_delta")
        elif not height:
            notes.append("width_guess_max_h")

    # Length: maiores deltas verticais (excluindo height aproximado)
    if vd:
        candidates = sorted(vd, reverse=True)
        if height:
            majors = [d for d in candidates if abs(d - height) > max(8.0, height * 0.25)]
        else:
            majors = candidates
        if len(majors) >= 2 and abs(majors[0] - majors[1]) / max(majors[0], 1) < 0.15:
            length = (majors[0] + majors[1]) / 2.0
            confidence += 0.25
            notes.append("length_from_paired_panels")
        elif majors:
            length = majors[0]
            confidence += 0.1
            notes.append("length_from_largest_v")

        # Glue: último (ou primeiro) painel estreito próximo de H
        if height and vd:
            edge_candidates = [vd[0], vd[-1]]
            glue_hits = [d for d in edge_candidates if abs(d - height) <= max(6.0, height * 0.35)]
            if glue_hits:
                glue = glue_hits[-1]
                notes.append("glue_from_edge_panel")
            elif vd[-1] < (length or 999) * 0.6:
                glue = vd[-1]
                notes.append("glue_from_last_panel")

    if glue is None and height:
        glue = round(height * 0.5, 2)

    # Fallbacks
    if length is None and vd:
        length = max(vd)
    if width is None and hd:
        width = max(hd)
    if height is None and all_d:
        height = min(all_d)

    ready = all(x is not None and x > 5 for x in (length, width, height))
    if ready:
        confidence = min(1.0, confidence + 0.15)

    return {
        "lengthMm": round(float(length or 80.0), 2),
        "widthMm": round(float(width or 100.0), 2),
        "heightMm": round(float(height or 40.0), 2),
        "glueMm": round(float(glue or 20.0), 2),
        "confidence": round(confidence, 3),
        "ready": ready,
        "notes": notes,
        "verticalDeltasMm": vd,
        "horizontalDeltasMm": hd,
    }


def page_looks_like_faca(page: Any) -> dict[str, Any]:
    """Heurística: página com muitos strokes dashed/solid e poucas imagens."""
    drawings = list(page.get_drawings() or [])
    cuts, folds = classify_drawings(drawings)
    images = 0
    try:
        images = len(page.get_images(full=True) or [])
    except Exception:
        images = 0
    score = len(folds) * 2 + len(cuts) - images * 0.5
    return {
        "score": score,
        "cutCount": len(cuts),
        "foldCount": len(folds),
        "imageCount": images,
        "isFaca": len(folds) >= 4 and len(cuts) >= 1,
    }


def page_looks_like_arte(page: Any) -> dict[str, Any]:
    drawings = list(page.get_drawings() or [])
    cuts, folds = classify_drawings(drawings)
    images = 0
    try:
        images = len(page.get_images(full=True) or [])
    except Exception:
        images = 0
    fills = sum(1 for d in drawings if d.get("fill") is not None and not d.get("color"))
    score = images * 2 + fills * 0.2 - len(folds) * 2
    return {
        "score": score,
        "cutCount": len(cuts),
        "foldCount": len(folds),
        "imageCount": images,
        "isArte": images >= 1 or (len(folds) <= 2 and fills >= 5),
    }


def parse_dieline_page(page: Any) -> dict[str, Any]:
    """Extrai cortes, vincos e dims sugeridas de uma página de faca."""
    media = page.mediabox
    page_w_mm = pt_to_mm(float(media.width))
    page_h_mm = pt_to_mm(float(media.height))
    drawings = list(page.get_drawings() or [])
    cuts, folds = classify_drawings(drawings)
    cut_bbox_pt = _bbox_from_drawings(cuts)
    fold_v_pt, fold_h_pt = _fold_axes(folds)

    cut_bbox_mm = None
    if cut_bbox_pt:
        cut_bbox_mm = {
            "left": round(pt_to_mm(cut_bbox_pt["x0"]), 2),
            "top": round(pt_to_mm(cut_bbox_pt["y0"]), 2),
            "right": round(pt_to_mm(float(media.width) - cut_bbox_pt["x1"]), 2),
            "bottom": round(pt_to_mm(float(media.height) - cut_bbox_pt["y1"]), 2),
            "x0Mm": round(pt_to_mm(cut_bbox_pt["x0"]), 2),
            "y0Mm": round(pt_to_mm(cut_bbox_pt["y0"]), 2),
            "x1Mm": round(pt_to_mm(cut_bbox_pt["x1"]), 2),
            "y1Mm": round(pt_to_mm(cut_bbox_pt["y1"]), 2),
            "widthMm": round(pt_to_mm(cut_bbox_pt["x1"] - cut_bbox_pt["x0"]), 2),
            "heightMm": round(pt_to_mm(cut_bbox_pt["y1"] - cut_bbox_pt["y0"]), 2),
        }

    vertical_mm = [round(pt_to_mm(x), 2) for x in fold_v_pt]
    horizontal_mm = [round(pt_to_mm(y), 2) for y in fold_h_pt]
    dims = estimate_tuck_end_dims(vertical_mm, horizontal_mm)

    fold_segments_mm: list[dict[str, Any]] = []
    for d in folds:
        for (p1, p2) in _line_segments(d):
            fold_segments_mm.append(
                {
                    "x1": round(pt_to_mm(p1[0]), 2),
                    "y1": round(pt_to_mm(p1[1]), 2),
                    "x2": round(pt_to_mm(p2[0]), 2),
                    "y2": round(pt_to_mm(p2[1]), 2),
                }
            )

    cut_segments_mm: list[dict[str, Any]] = []
    for d in cuts:
        for (p1, p2) in _line_segments(d):
            cut_segments_mm.append(
                {
                    "x1": round(pt_to_mm(p1[0]), 2),
                    "y1": round(pt_to_mm(p1[1]), 2),
                    "x2": round(pt_to_mm(p2[0]), 2),
                    "y2": round(pt_to_mm(p2[1]), 2),
                }
            )

    return {
        "pageWidthMm": round(page_w_mm, 2),
        "pageHeightMm": round(page_h_mm, 2),
        "cutCount": len(cuts),
        "foldCount": len(folds),
        "cutBboxMm": cut_bbox_mm,
        "verticalCreasesMm": vertical_mm,
        "horizontalCreasesMm": horizontal_mm,
        "foldSegmentsMm": fold_segments_mm,
        "cutSegmentsMm": cut_segments_mm,
        "dims": dims,
        "classification": page_looks_like_faca(page),
    }


def detect_page_roles(doc: Any) -> dict[str, Any]:
    """Em PDF combinado, escolhe índices de faca e arte."""
    n = len(doc)
    if n < 1:
        return {"facaPage": 0, "artePage": 0, "combined": False}
    scores = []
    for i in range(n):
        page = doc.load_page(i)
        faca = page_looks_like_faca(page)
        arte = page_looks_like_arte(page)
        scores.append({"index": i, "faca": faca, "arte": arte})
    faca_idx = max(scores, key=lambda s: s["faca"]["score"])["index"]
    arte_idx = max(scores, key=lambda s: s["arte"]["score"])["index"]
    if n >= 2 and faca_idx == arte_idx:
        # Preferência clássica: pág.1 faca, pág.2 arte
        faca_idx = 0
        arte_idx = 1
    return {
        "facaPage": int(faca_idx),
        "artePage": int(arte_idx),
        "combined": n >= 2,
        "pages": scores,
    }


def parse_dieline_pdf(path: str, *, page_index: Optional[int] = None) -> dict[str, Any]:
    """Abre PDF e parseia a página de faca (ou a indicada)."""
    import fitz

    with fitz.open(path) as doc:
        roles = detect_page_roles(doc)
        idx = page_index if page_index is not None else int(roles["facaPage"])
        idx = max(0, min(len(doc) - 1, idx))
        parsed = parse_dieline_page(doc.load_page(idx))
        parsed["facaPage"] = idx
        parsed["artePage"] = int(roles["artePage"])
        parsed["pageCount"] = len(doc)
        parsed["roles"] = roles
        return parsed
