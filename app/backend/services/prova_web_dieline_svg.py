"""
Parser de faca SVG para modelos de caixa (Admin).

Regra: stroke contínuo = corte; stroke-dasharray (pontilhado) = dobra.
Override por id/class contendo cut/corte ou fold/dobra.
"""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from typing import Any, Optional

_NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
_PATH_CMD = re.compile(
    r"([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)"
)
_UNIT_MM = re.compile(r"^([-+]?\d*\.?\d+)\s*(mm|cm|in|pt|px)?$", re.I)

_DASH_SEG_MAX_MM = 4.5
_DASH_GAP_MAX_MM = 6.0
_AXIS_TOL_MM = 0.8
# Densidade alvo ao amostrar curvas (mm entre pontos no espaço do SVG)
_CURVE_STEP_MM = 0.75
_CURVE_MIN_STEPS = 8
_CURVE_MAX_STEPS = 64


def _local(tag: str) -> str:
    if tag.startswith("{"):
        return tag.rsplit("}", 1)[-1]
    return tag


def _parse_length(raw: Optional[str]) -> Optional[float]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    m = _UNIT_MM.match(s)
    if not m:
        try:
            return float(s)
        except ValueError:
            return None
    val = float(m.group(1))
    unit = (m.group(2) or "").lower()
    if unit == "cm":
        return val * 10.0
    if unit == "in":
        return val * 25.4
    if unit == "pt":
        return val * (25.4 / 72.0)
    if unit == "px":
        return val * (25.4 / 96.0)
    return val


def _parse_viewbox(raw: Optional[str]) -> Optional[tuple[float, float, float, float]]:
    if not raw:
        return None
    nums = [float(x) for x in _NUM.findall(raw)]
    if len(nums) < 4:
        return None
    return nums[0], nums[1], nums[2], nums[3]


def _parse_transform(raw: Optional[str]) -> list[tuple[str, list[float]]]:
    if not raw:
        return []
    out: list[tuple[str, list[float]]] = []
    for m in re.finditer(
        r"(matrix|translate|scale|rotate)\s*\(([^)]*)\)", raw, flags=re.I
    ):
        name = m.group(1).lower()
        args = [float(x) for x in _NUM.findall(m.group(2))]
        out.append((name, args))
    return out


def _apply_matrix(
    x: float, y: float, a: float, b: float, c: float, d: float, e: float, f: float
) -> tuple[float, float]:
    return a * x + c * y + e, b * x + d * y + f


def _transform_point(
    x: float, y: float, transforms: list[tuple[str, list[float]]]
) -> tuple[float, float]:
    for name, args in reversed(transforms):
        if name == "translate":
            tx = args[0] if args else 0.0
            ty = args[1] if len(args) > 1 else 0.0
            x, y = x + tx, y + ty
        elif name == "scale":
            sx = args[0] if args else 1.0
            sy = args[1] if len(args) > 1 else sx
            x, y = x * sx, y * sy
        elif name == "matrix" and len(args) >= 6:
            x, y = _apply_matrix(x, y, *args[:6])
        elif name == "rotate" and args:
            ang = math.radians(args[0])
            cx = args[1] if len(args) > 1 else 0.0
            cy = args[2] if len(args) > 2 else 0.0
            cos_a, sin_a = math.cos(ang), math.sin(ang)
            x0, y0 = x - cx, y - cy
            x, y = cx + x0 * cos_a - y0 * sin_a, cy + x0 * sin_a + y0 * cos_a
    return x, y


def _attr_style_map(el: ET.Element) -> dict[str, str]:
    out: dict[str, str] = {}
    style = el.get("style") or ""
    for part in style.split(";"):
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        out[k.strip().lower()] = v.strip()
    for k, v in el.attrib.items():
        lk = k.lower()
        if lk in (
            "stroke-dasharray",
            "stroke",
            "fill",
            "transform",
            "d",
            "x1",
            "y1",
            "x2",
            "y2",
            "points",
            "x",
            "y",
            "width",
            "height",
            "id",
            "class",
        ):
            out[lk] = v
    return out


def _inherited_attrs(
    el: ET.Element, parent_map: dict[ET.Element, ET.Element]
) -> dict[str, str]:
    """Acumula atributos de apresentação (stroke-dasharray, class, id) dos ancestrais."""
    chain: list[ET.Element] = []
    cur: Optional[ET.Element] = el
    while cur is not None:
        chain.append(cur)
        cur = parent_map.get(cur)
    chain.reverse()
    merged: dict[str, str] = {}
    class_parts: list[str] = []
    id_parts: list[str] = []
    for node in chain:
        attrs = _attr_style_map(node)
        for k in ("stroke-dasharray", "stroke", "fill"):
            if k in attrs and attrs[k]:
                merged[k] = attrs[k]
        if attrs.get("class"):
            class_parts.append(attrs["class"])
        if attrs.get("id"):
            id_parts.append(attrs["id"])
    own = _attr_style_map(el)
    merged.update(own)
    if class_parts:
        merged["class"] = " ".join(class_parts)
    if id_parts:
        merged["id"] = " ".join(id_parts)
    return merged


def _normalize_hex_color(raw: Optional[str]) -> Optional[str]:
    """Normaliza #RGB / #RRGGBB / rgb() → '#rrggbb' ou None."""
    if not raw:
        return None
    s = str(raw).strip().lower().replace(" ", "")
    if s in ("none", "transparent"):
        return None
    if s.startswith("rgb(") and s.endswith(")"):
        nums = _NUM.findall(s[4:-1])
        if len(nums) >= 3:
            r, g, b = (max(0, min(255, int(float(nums[i])))) for i in range(3))
            return f"#{r:02x}{g:02x}{b:02x}"
        return None
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3 and all(c in "0123456789abcdef" for c in h):
            return f"#{h[0]*2}{h[1]*2}{h[2]*2}"
        if len(h) >= 6 and all(c in "0123456789abcdef" for c in h[:6]):
            return f"#{h[:6]}"
    return None


# Cores canônicas da faca Sagra (export Corel/Illustrator)
_FOLD_COLORS = frozenset(
    {
        "#00afef",  # ciano — dobras
        "#00a0e3",
        "#00b0f0",
        "#00aeef",
    }
)
_CUT_COLORS = frozenset(
    {
        "#ed3237",  # vermelho — cortes
        "#ed1c24",
        "#e30613",
        "#ff0000",
        "#ee2a2f",
    }
)


def _color_distance(a: str, b: str) -> int:
    """Distância Manhattan RGB aproximada (0–765)."""
    try:
        ar, ag, ab = int(a[1:3], 16), int(a[3:5], 16), int(a[5:7], 16)
        br, bg, bb = int(b[1:3], 16), int(b[3:5], 16), int(b[5:7], 16)
    except ValueError:
        return 999
    return abs(ar - br) + abs(ag - bg) + abs(ab - bb)


def _kind_from_color(stroke_raw: Optional[str]) -> Optional[str]:
    hex_c = _normalize_hex_color(stroke_raw)
    if not hex_c:
        return None
    if hex_c in _FOLD_COLORS:
        return "fold"
    if hex_c in _CUT_COLORS:
        return "cut"
    # Tolerância a pequenas variações de export
    for ref in _FOLD_COLORS:
        if _color_distance(hex_c, ref) <= 30:
            return "fold"
    for ref in _CUT_COLORS:
        if _color_distance(hex_c, ref) <= 30:
            return "cut"
    return None


def _layer_blob(el: ET.Element, parent_map: dict[ET.Element, ET.Element]) -> str:
    """Junta id/class/label (incl. inkscape:label) da cadeia de ancestrais."""
    parts: list[str] = []
    cur: Optional[ET.Element] = el
    while cur is not None:
        for k, v in cur.attrib.items():
            lk = k.lower()
            local = lk.rsplit("}", 1)[-1]
            if local in ("id", "class", "label", "name", "data-name") or local.endswith(
                ":label"
            ):
                parts.append(str(v))
        cur = parent_map.get(cur)
    return " ".join(parts).lower()


def _kind_from_layer(blob: str) -> Optional[str]:
    if not blob:
        return None
    # Camadas "dobras" / "corte" (e variações)
    fold_tokens = (
        "dobras",
        "dobra",
        "fold",
        "folds",
        "crease",
        "creases",
        "vinco",
        "vincos",
        "score",
    )
    cut_tokens = (
        "cortes",
        "corte",
        "cut",
        "cuts",
        "knife",
        "dieline-cut",
        "through",
    )
    # Preferência: token de dobra antes de corte (evita "cutter-fold")
    for tok in fold_tokens:
        if tok in blob:
            return "fold"
    for tok in cut_tokens:
        if tok in blob:
            return "cut"
    return None


def _kind_from_attrs(attrs: dict[str, str], *, layer_blob: str = "") -> Optional[str]:
    """Classifica por camada/id/nome → cor do stroke → None."""
    name_blob = " ".join(
        [
            layer_blob,
            attrs.get("id", ""),
            attrs.get("class", ""),
            attrs.get("name", ""),
            attrs.get("data-name", ""),
        ]
    ).lower()
    kind = _kind_from_layer(name_blob)
    if kind:
        return kind
    return _kind_from_color(attrs.get("stroke"))


def _stroke_name(el: ET.Element, attrs: dict[str, str]) -> Optional[str]:
    """Nome estável do traço (id / data-name / name) para debug e matching."""
    for key in ("id", "data-name", "name"):
        raw = (el.get(key) or attrs.get(key) or "").strip()
        if raw:
            return raw
    return None


def _fold_meta_from_el(el: ET.Element, attrs: dict[str, str]) -> dict[str, Any]:
    """Atributos opcionais de sequência embutidos no SVG (contrato Sagra)."""
    meta: dict[str, Any] = {}
    order = el.get("data-fold-order") or attrs.get("data-fold-order")
    if order is not None and str(order).strip() != "":
        try:
            meta["foldOrder"] = int(str(order).strip())
        except ValueError:
            pass
    angle = el.get("data-fold-angle") or attrs.get("data-fold-angle")
    if angle is not None and str(angle).strip() != "":
        try:
            meta["foldAngleDeg"] = float(str(angle).strip())
        except ValueError:
            pass
    towards = (
        el.get("data-fold-towards") or attrs.get("data-fold-towards") or ""
    ).strip().lower()
    if towards in ("front", "back"):
        meta["foldTowards"] = towards
    side = (
        el.get("data-fold-side") or attrs.get("data-fold-side") or ""
    ).strip().lower()
    if side in ("positive", "negative"):
        meta["foldMovingSide"] = side
    return meta


def _is_dashed_attr(attrs: dict[str, str]) -> bool:
    dash = (attrs.get("stroke-dasharray") or "").strip().lower()
    if not dash or dash in ("none", "0", "0 0"):
        return False
    nums = [float(x) for x in _NUM.findall(dash)]
    return bool(nums) and any(n > 0 for n in nums)


def _curve_steps(*points: tuple[float, float]) -> int:
    """Quantidade de amostras proporcional ao comprimento do polígono de controle."""
    length = 0.0
    for i in range(len(points) - 1):
        length += math.hypot(
            points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]
        )
    n = int(math.ceil(length / max(0.2, _CURVE_STEP_MM)))
    return max(_CURVE_MIN_STEPS, min(_CURVE_MAX_STEPS, n))


def _cubic_bezier_points(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
    p3: tuple[float, float],
) -> list[tuple[float, float]]:
    steps = _curve_steps(p0, p1, p2, p3)
    out: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        s = i / steps
        u = 1.0 - s
        x = (
            u**3 * p0[0]
            + 3 * u**2 * s * p1[0]
            + 3 * u * s**2 * p2[0]
            + s**3 * p3[0]
        )
        y = (
            u**3 * p0[1]
            + 3 * u**2 * s * p1[1]
            + 3 * u * s**2 * p2[1]
            + s**3 * p3[1]
        )
        out.append((x, y))
    return out


def _quad_bezier_points(
    p0: tuple[float, float],
    p1: tuple[float, float],
    p2: tuple[float, float],
) -> list[tuple[float, float]]:
    steps = _curve_steps(p0, p1, p2)
    out: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        s = i / steps
        u = 1.0 - s
        out.append(
            (
                u * u * p0[0] + 2 * u * s * p1[0] + s * s * p2[0],
                u * u * p0[1] + 2 * u * s * p1[1] + s * s * p2[1],
            )
        )
    return out


def _arc_to_points(
    x1: float,
    y1: float,
    rx: float,
    ry: float,
    phi_deg: float,
    large_arc: bool,
    sweep: bool,
    x2: float,
    y2: float,
) -> list[tuple[float, float]]:
    """Converte arco SVG (endpoint) em polyline; ver SVG 1.1 F.6."""
    rx = abs(rx)
    ry = abs(ry)
    if rx < 1e-9 or ry < 1e-9 or (abs(x1 - x2) < 1e-9 and abs(y1 - y2) < 1e-9):
        return [(x2, y2)]

    phi = math.radians(phi_deg % 360.0)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)
    dx = (x1 - x2) / 2.0
    dy = (y1 - y2) / 2.0
    x1p = cos_phi * dx + sin_phi * dy
    y1p = -sin_phi * dx + cos_phi * dy

    # Corrige raios se o arco for impossível
    lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lam > 1.0:
        s = math.sqrt(lam)
        rx *= s
        ry *= s

    rx2, ry2 = rx * rx, ry * ry
    num = max(0.0, rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p)
    den = rx2 * y1p * y1p + ry2 * x1p * x1p
    if den < 1e-12:
        return [(x2, y2)]
    coef = math.sqrt(num / den)
    if large_arc == sweep:
        coef = -coef
    cxp = coef * (rx * y1p) / ry
    cyp = coef * (-ry * x1p) / rx
    cx = cos_phi * cxp - sin_phi * cyp + (x1 + x2) / 2.0
    cy = sin_phi * cxp + cos_phi * cyp + (y1 + y2) / 2.0

    def angle(ux: float, uy: float, vx: float, vy: float) -> float:
        dot = ux * vx + uy * vy
        n1 = math.hypot(ux, uy) * math.hypot(vx, vy)
        if n1 < 1e-12:
            return 0.0
        cos_a = max(-1.0, min(1.0, dot / n1))
        ang = math.acos(cos_a)
        if ux * vy - uy * vx < 0:
            ang = -ang
        return ang

    ux, uy = (x1p - cxp) / rx, (y1p - cyp) / ry
    vx, vy = (-x1p - cxp) / rx, (-y1p - cyp) / ry
    theta1 = angle(1.0, 0.0, ux, uy)
    delta = angle(ux, uy, vx, vy)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    elif sweep and delta < 0:
        delta += 2 * math.pi

    # Comprimento aproximado do arco
    arc_len = abs(delta) * (rx + ry) * 0.5
    steps = max(_CURVE_MIN_STEPS, min(_CURVE_MAX_STEPS, int(math.ceil(arc_len / _CURVE_STEP_MM))))
    out: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        t = theta1 + delta * (i / steps)
        xp = rx * math.cos(t)
        yp = ry * math.sin(t)
        out.append(
            (
                cos_phi * xp - sin_phi * yp + cx,
                sin_phi * xp + cos_phi * yp + cy,
            )
        )
    # Garante ponto final exato
    if out:
        out[-1] = (x2, y2)
    else:
        out.append((x2, y2))
    return out


def _path_to_polylines(d: str) -> list[list[tuple[float, float]]]:
    tokens: list[Any] = []
    for m in _PATH_CMD.finditer(d or ""):
        if m.group(1):
            tokens.append(m.group(1))
        else:
            tokens.append(float(m.group(2)))

    polylines: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    cx = cy = 0.0
    start = (0.0, 0.0)
    i = 0
    cmd = "M"
    last_cmd = ""
    # Último ponto de controle (para S/T)
    last_c2: Optional[tuple[float, float]] = None
    last_q: Optional[tuple[float, float]] = None

    def take(n: int) -> list[float]:
        nonlocal i
        vals = tokens[i : i + n]
        i += n
        return [float(v) for v in vals]

    def add(x: float, y: float) -> None:
        nonlocal cx, cy
        cx, cy = x, y
        cur.append((x, y))

    while i < len(tokens):
        t = tokens[i]
        if isinstance(t, str):
            cmd = t
            i += 1

        if cmd in ("M", "m"):
            if cur:
                polylines.append(cur)
                cur = []
            vals = take(2)
            if len(vals) < 2:
                break
            if cmd == "M":
                add(vals[0], vals[1])
            else:
                add(cx + vals[0], cy + vals[1])
            start = (cx, cy)
            last_c2 = last_q = None
            last_cmd = cmd
            cmd = "L" if cmd == "M" else "l"
            continue
        elif cmd in ("L", "l"):
            vals = take(2)
            if len(vals) < 2:
                break
            if cmd == "L":
                add(vals[0], vals[1])
            else:
                add(cx + vals[0], cy + vals[1])
            last_c2 = last_q = None
        elif cmd in ("H", "h"):
            vals = take(1)
            if not vals:
                break
            add(vals[0] if cmd == "H" else cx + vals[0], cy)
            last_c2 = last_q = None
        elif cmd in ("V", "v"):
            vals = take(1)
            if not vals:
                break
            add(cx, vals[0] if cmd == "V" else cy + vals[0])
            last_c2 = last_q = None
        elif cmd in ("Z", "z"):
            if cur and (cur[0] != cur[-1]):
                cur.append(cur[0])
            polylines.append(cur)
            cur = []
            cx, cy = start
            last_c2 = last_q = None
        elif cmd in ("C", "c"):
            vals = take(6)
            if len(vals) < 6:
                break
            x0, y0 = cx, cy
            if cmd == "C":
                x1, y1, x2, y2, x3, y3 = vals
            else:
                x1, y1 = x0 + vals[0], y0 + vals[1]
                x2, y2 = x0 + vals[2], y0 + vals[3]
                x3, y3 = x0 + vals[4], y0 + vals[5]
            for pt in _cubic_bezier_points((x0, y0), (x1, y1), (x2, y2), (x3, y3)):
                add(pt[0], pt[1])
            last_c2 = (x2, y2)
            last_q = None
        elif cmd in ("S", "s"):
            vals = take(4)
            if len(vals) < 4:
                break
            x0, y0 = cx, cy
            if last_c2 is not None and last_cmd in ("C", "c", "S", "s"):
                x1, y1 = 2 * x0 - last_c2[0], 2 * y0 - last_c2[1]
            else:
                x1, y1 = x0, y0
            if cmd == "S":
                x2, y2, x3, y3 = vals
            else:
                x2, y2 = x0 + vals[0], y0 + vals[1]
                x3, y3 = x0 + vals[2], y0 + vals[3]
            for pt in _cubic_bezier_points((x0, y0), (x1, y1), (x2, y2), (x3, y3)):
                add(pt[0], pt[1])
            last_c2 = (x2, y2)
            last_q = None
        elif cmd in ("Q", "q"):
            vals = take(4)
            if len(vals) < 4:
                break
            x0, y0 = cx, cy
            if cmd == "Q":
                x1, y1, x2, y2 = vals
            else:
                x1, y1 = x0 + vals[0], y0 + vals[1]
                x2, y2 = x0 + vals[2], y0 + vals[3]
            for pt in _quad_bezier_points((x0, y0), (x1, y1), (x2, y2)):
                add(pt[0], pt[1])
            last_q = (x1, y1)
            last_c2 = None
        elif cmd in ("T", "t"):
            vals = take(2)
            if len(vals) < 2:
                break
            x0, y0 = cx, cy
            if last_q is not None and last_cmd in ("Q", "q", "T", "t"):
                x1, y1 = 2 * x0 - last_q[0], 2 * y0 - last_q[1]
            else:
                x1, y1 = x0, y0
            if cmd == "T":
                x2, y2 = vals
            else:
                x2, y2 = x0 + vals[0], y0 + vals[1]
            for pt in _quad_bezier_points((x0, y0), (x1, y1), (x2, y2)):
                add(pt[0], pt[1])
            last_q = (x1, y1)
            last_c2 = None
        elif cmd in ("A", "a"):
            vals = take(7)
            if len(vals) < 7:
                break
            x0, y0 = cx, cy
            rx, ry, phi, large, sweep, x2, y2 = vals
            if cmd == "a":
                x2, y2 = x0 + x2, y0 + y2
            for pt in _arc_to_points(
                x0,
                y0,
                rx,
                ry,
                phi,
                bool(round(large)),
                bool(round(sweep)),
                x2,
                y2,
            ):
                add(pt[0], pt[1])
            last_c2 = last_q = None
        else:
            i += 1
            continue
        last_cmd = cmd

    if cur:
        polylines.append(cur)
    return [pl for pl in polylines if len(pl) >= 2]


def _polyline_segments(
    points: list[tuple[float, float]],
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    return [(points[i], points[i + 1]) for i in range(len(points) - 1)]


def _seg_len(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _merge_colinear_short_dashes(
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> tuple[
    list[tuple[tuple[float, float], tuple[float, float]]],
    list[tuple[tuple[float, float], tuple[float, float]]],
]:
    if not segments:
        return [], []

    used = [False] * len(segments)
    folds: list[tuple[tuple[float, float], tuple[float, float]]] = []
    remain: list[tuple[tuple[float, float], tuple[float, float]]] = []

    for i, seg in enumerate(segments):
        if used[i]:
            continue
        length = _seg_len(*seg)
        if length > _DASH_SEG_MAX_MM or length < 0.15:
            remain.append(seg)
            used[i] = True
            continue

        chain = [seg]
        used[i] = True
        changed = True
        while changed:
            changed = False
            tip = chain[-1][1]
            for j, other in enumerate(segments):
                if used[j]:
                    continue
                ol = _seg_len(*other)
                if ol > _DASH_SEG_MAX_MM or ol < 0.15:
                    continue
                gap = math.hypot(other[0][0] - tip[0], other[0][1] - tip[1])
                gap2 = math.hypot(other[1][0] - tip[0], other[1][1] - tip[1])
                if gap <= _DASH_GAP_MAX_MM:
                    chain.append(other)
                    tip = other[1]
                    used[j] = True
                    changed = True
                elif gap2 <= _DASH_GAP_MAX_MM:
                    chain.append((other[1], other[0]))
                    tip = other[0]
                    used[j] = True
                    changed = True

        if len(chain) >= 3:
            # Mantém segmentos reais — não une pontas atravessando o vão
            folds.extend(chain)
        else:
            remain.extend(chain)

    for i, seg in enumerate(segments):
        if not used[i]:
            remain.append(seg)
    return folds, remain


def _cluster_mm(values: list[float], tol: float = 1.5) -> list[float]:
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
    return [round(x[0], 2) for x in out]


def _fold_axes_from_segs(
    fold_segs: list[dict[str, float]],
    *,
    min_len_mm: float = 3.0,
) -> tuple[list[float], list[float]]:
    vs: list[float] = []
    hs: list[float] = []
    for s in fold_segs:
        x1, y1, x2, y2 = s["x1"], s["y1"], s["x2"], s["y2"]
        dx, dy = abs(x2 - x1), abs(y2 - y1)
        length = math.hypot(dx, dy)
        if length < min_len_mm:
            continue
        if dx <= _AXIS_TOL_MM and dy > min_len_mm:
            vs.append((x1 + x2) / 2.0)
        elif dy <= _AXIS_TOL_MM and dx > min_len_mm:
            hs.append((y1 + y2) / 2.0)
    return _cluster_mm(vs), _cluster_mm(hs)


def _collect_ancestor_transforms(
    el: ET.Element, parent_map: dict[ET.Element, ET.Element]
) -> list[tuple[str, list[float]]]:
    chain: list[ET.Element] = []
    cur: Optional[ET.Element] = el
    while cur is not None:
        chain.append(cur)
        cur = parent_map.get(cur)
    chain.reverse()
    transforms: list[tuple[str, list[float]]] = []
    for node in chain:
        attrs = _attr_style_map(node)
        transforms.extend(
            _parse_transform(attrs.get("transform") or node.get("transform"))
        )
    return transforms


def looks_like_svg(data: bytes, filename: Optional[str] = None) -> bool:
    name = (filename or "").lower()
    if name.endswith(".svg"):
        return True
    head = data[:512].lstrip().lower()
    return head.startswith(b"<?xml") or head.startswith(b"<svg") or b"<svg" in head


def _is_cut_outline_el(el: ET.Element, attrs: dict[str, str], layer_blob: str) -> bool:
    sagra = (el.get("data-sagra") or attrs.get("data-sagra") or "").strip().lower()
    if sagra in ("cut-outline", "corte_perimetro", "outline"):
        return True
    eid = (el.get("id") or attrs.get("id") or "").strip().lower()
    if eid in ("corte_perimetro", "cut_outline", "cut-outline"):
        return True
    return "corte_perimetro" in layer_blob


def _is_explicit_panel_el(el: ET.Element, attrs: dict[str, str], layer_blob: str) -> bool:
    sagra = (el.get("data-sagra") or attrs.get("data-sagra") or "").strip().lower()
    if sagra == "panel":
        return True
    return "paineis" in layer_blob or "painéis" in layer_blob or " panels" in f" {layer_blob}"


def _polyline_mm_from_el(
    el: ET.Element,
    tag: str,
    attrs: dict[str, str],
    transforms: list[tuple[str, list[float]]],
    to_mm,
) -> list[tuple[float, float]]:
    """Extrai polyline fechada/aberta em mm a partir do elemento SVG."""
    segs_uu: list[tuple[tuple[float, float], tuple[float, float]]] = []
    pts_out: list[tuple[float, float]] = []

    if tag == "line":
        try:
            x1 = float(el.get("x1") or attrs.get("x1") or 0)
            y1 = float(el.get("y1") or attrs.get("y1") or 0)
            x2 = float(el.get("x2") or attrs.get("x2") or 0)
            y2 = float(el.get("y2") or attrs.get("y2") or 0)
        except ValueError:
            return []
        segs_uu.append(((x1, y1), (x2, y2)))
    elif tag in ("polyline", "polygon"):
        pts_raw = el.get("points") or attrs.get("points") or ""
        nums = [float(x) for x in _NUM.findall(pts_raw)]
        pts = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        if tag == "polygon" and pts and pts[0] != pts[-1]:
            pts.append(pts[0])
        for i in range(len(pts) - 1):
            segs_uu.append((pts[i], pts[i + 1]))
    elif tag == "path":
        d = el.get("d") or attrs.get("d") or ""
        for pl in _path_to_polylines(d):
            for i in range(len(pl) - 1):
                segs_uu.append((pl[i], pl[i + 1]))
            if pl:
                # Preferir a polyline mais longa do path
                cand = [to_mm(p[0], p[1], transforms) for p in pl]
                if len(cand) > len(pts_out):
                    pts_out = cand
    elif tag == "rect":
        try:
            x = float(el.get("x") or attrs.get("x") or 0)
            y = float(el.get("y") or attrs.get("y") or 0)
            w = float(el.get("width") or attrs.get("width") or 0)
            h = float(el.get("height") or attrs.get("height") or 0)
        except ValueError:
            return []
        segs_uu.extend(
            [
                ((x, y), (x + w, y)),
                ((x + w, y), (x + w, y + h)),
                ((x + w, y + h), (x, y + h)),
                ((x, y + h), (x, y)),
            ]
        )

    if pts_out:
        return pts_out
    if not segs_uu:
        return []
    # Encadeia pontos a partir dos segmentos
    pts_out = [to_mm(segs_uu[0][0][0], segs_uu[0][0][1], transforms)]
    for a, b in segs_uu:
        pb = to_mm(b[0], b[1], transforms)
        pts_out.append(pb)
    return pts_out


def parse_dieline_svg(svg_bytes: bytes) -> dict[str, Any]:
    """Parse SVG → mesmo contrato de parse_dieline_page (coordenadas em mm)."""
    if not svg_bytes:
        raise ValueError("SVG da faca vazio.")
    text = svg_bytes.decode("utf-8", errors="replace")
    if "<svg" not in text.lower():
        raise ValueError("Arquivo não parece um SVG válido.")
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"SVG inválido: {exc}") from exc

    parent_map = {c: p for p in root.iter() for c in p}

    vb = _parse_viewbox(root.get("viewBox"))
    w_mm = _parse_length(root.get("width"))
    h_mm = _parse_length(root.get("height"))
    if vb:
        vb_x, vb_y, vb_w, vb_h = vb
    else:
        vb_x, vb_y = 0.0, 0.0
        vb_w = float(w_mm or 100.0)
        vb_h = float(h_mm or 100.0)

    if w_mm and vb_w > 0:
        sx = w_mm / vb_w
    else:
        sx = 1.0
    if h_mm and vb_h > 0:
        sy = h_mm / vb_h
    else:
        sy = sx

    page_w = float(w_mm or (vb_w * sx))
    page_h = float(h_mm or (vb_h * sy))

    def to_mm(
        x: float, y: float, transforms: list[tuple[str, list[float]]]
    ) -> tuple[float, float]:
        tx, ty = _transform_point(x, y, transforms)
        return (tx - vb_x) * sx, (ty - vb_y) * sy

    raw_cut: list[tuple[tuple[float, float], tuple[float, float], Optional[str]]] = []
    # fold: (a, b, name, meta) — meta carrega data-fold-* do SVG
    raw_fold: list[
        tuple[tuple[float, float], tuple[float, float], Optional[str], dict[str, Any]]
    ] = []
    unlabeled: list[tuple[tuple[float, float], tuple[float, float]]] = []
    net_outline_mm: list[list[float]] = []
    explicit_panels: list[dict[str, Any]] = []

    shape_tags = {"path", "line", "polyline", "polygon", "rect", "circle", "ellipse"}

    for el in root.iter():
        tag = _local(el.tag).lower()
        if tag not in shape_tags:
            continue
        attrs = _inherited_attrs(el, parent_map)
        layer_blob = _layer_blob(el, parent_map)
        stroke = (attrs.get("stroke") or "").strip().lower()
        kind_override = _kind_from_attrs(attrs, layer_blob=layer_blob)
        is_outline = _is_cut_outline_el(el, attrs, layer_blob)
        is_panel = _is_explicit_panel_el(el, attrs, layer_blob)

        transforms = _collect_ancestor_transforms(el, parent_map)
        stroke_name = _stroke_name(el, attrs)
        fold_meta = _fold_meta_from_el(el, attrs)

        # Painéis explícitos (fill fechado) — contrato Sagra
        if is_panel and tag in ("path", "polygon", "polyline", "rect"):
            pts = _polyline_mm_from_el(el, tag, attrs, transforms, to_mm)
            if len(pts) >= 3:
                poly = [[round(p[0], 2), round(p[1], 2)] for p in pts]
                if poly[0] != poly[-1]:
                    poly.append(poly[0][:])
                pid = (
                    el.get("data-panel-id")
                    or attrs.get("data-panel-id")
                    or el.get("id")
                    or f"panel_{len(explicit_panels) + 1}"
                )
                explicit_panels.append(
                    {"id": str(pid), "polygonMm": poly, "label": str(pid)}
                )
            # Continua: pode também ser stroke de corte se houver

        # Contorno canônico
        if is_outline and tag in ("path", "polygon", "polyline", "rect"):
            pts = _polyline_mm_from_el(el, tag, attrs, transforms, to_mm)
            if len(pts) >= 3 and len(pts) > len(net_outline_mm):
                net_outline_mm = [[round(p[0], 2), round(p[1], 2)] for p in pts]
                if net_outline_mm[0] != net_outline_mm[-1]:
                    net_outline_mm.append(net_outline_mm[0][:])

        # Sem stroke e sem camada nomeada → ignora (fills decorativos)
        if stroke in ("none", "") and not kind_override and not is_outline:
            continue

        segs_uu: list[tuple[tuple[float, float], tuple[float, float]]] = []

        if tag == "line":
            try:
                x1 = float(el.get("x1") or attrs.get("x1") or 0)
                y1 = float(el.get("y1") or attrs.get("y1") or 0)
                x2 = float(el.get("x2") or attrs.get("x2") or 0)
                y2 = float(el.get("y2") or attrs.get("y2") or 0)
            except ValueError:
                continue
            segs_uu.append(((x1, y1), (x2, y2)))
        elif tag in ("polyline", "polygon"):
            pts_raw = el.get("points") or attrs.get("points") or ""
            nums = [float(x) for x in _NUM.findall(pts_raw)]
            pts = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
            if tag == "polygon" and pts and pts[0] != pts[-1]:
                pts.append(pts[0])
            segs_uu.extend(_polyline_segments(pts))
        elif tag == "rect":
            try:
                x = float(el.get("x") or attrs.get("x") or 0)
                y = float(el.get("y") or attrs.get("y") or 0)
                w = float(el.get("width") or attrs.get("width") or 0)
                h = float(el.get("height") or attrs.get("height") or 0)
                rx = float(el.get("rx") or attrs.get("rx") or 0)
                ry = float(el.get("ry") or attrs.get("ry") or rx)
            except ValueError:
                continue
            rx = max(0.0, min(rx, w / 2.0))
            ry = max(0.0, min(ry, h / 2.0))
            if rx < 0.2 and ry < 0.2:
                segs_uu.extend(
                    [
                        ((x, y), (x + w, y)),
                        ((x + w, y), (x + w, y + h)),
                        ((x + w, y + h), (x, y + h)),
                        ((x, y + h), (x, y)),
                    ]
                )
            else:
                pts = (
                    [(x + rx, y)]
                    + _arc_to_points(x + w - rx, y, rx, ry, 0, False, True, x + w, y + ry)
                    + _arc_to_points(x + w, y + h - ry, rx, ry, 0, False, True, x + w - rx, y + h)
                    + _arc_to_points(x + rx, y + h, rx, ry, 0, False, True, x, y + h - ry)
                    + _arc_to_points(x, y + ry, rx, ry, 0, False, True, x + rx, y)
                )
                if pts and pts[0] != pts[-1]:
                    pts.append(pts[0])
                segs_uu.extend(_polyline_segments(pts))
        elif tag == "circle":
            try:
                cx0 = float(el.get("cx") or attrs.get("cx") or 0)
                cy0 = float(el.get("cy") or attrs.get("cy") or 0)
                r = float(el.get("r") or attrs.get("r") or 0)
            except ValueError:
                continue
            if r < 0.2:
                continue
            steps = max(
                _CURVE_MIN_STEPS,
                min(_CURVE_MAX_STEPS, int(math.ceil(2 * math.pi * r / _CURVE_STEP_MM))),
            )
            pts = [
                (
                    cx0 + r * math.cos(2 * math.pi * i / steps),
                    cy0 + r * math.sin(2 * math.pi * i / steps),
                )
                for i in range(steps + 1)
            ]
            segs_uu.extend(_polyline_segments(pts))
        elif tag == "ellipse":
            try:
                cx0 = float(el.get("cx") or attrs.get("cx") or 0)
                cy0 = float(el.get("cy") or attrs.get("cy") or 0)
                rx = float(el.get("rx") or attrs.get("rx") or 0)
                ry = float(el.get("ry") or attrs.get("ry") or 0)
            except ValueError:
                continue
            if rx < 0.2 or ry < 0.2:
                continue
            peri = math.pi * (3 * (rx + ry) - math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
            steps = max(
                _CURVE_MIN_STEPS,
                min(_CURVE_MAX_STEPS, int(math.ceil(peri / _CURVE_STEP_MM))),
            )
            pts = [
                (
                    cx0 + rx * math.cos(2 * math.pi * i / steps),
                    cy0 + ry * math.sin(2 * math.pi * i / steps),
                )
                for i in range(steps + 1)
            ]
            segs_uu.extend(_polyline_segments(pts))
        elif tag == "path":
            d = el.get("d") or attrs.get("d") or ""
            for pl in _path_to_polylines(d):
                segs_uu.extend(_polyline_segments(pl))

        segs_mm: list[tuple[tuple[float, float], tuple[float, float]]] = []
        for a, b in segs_uu:
            pa = to_mm(a[0], a[1], transforms)
            pb = to_mm(b[0], b[1], transforms)
            if _seg_len(pa, pb) < 0.15:
                continue
            segs_mm.append((pa, pb))

        if not segs_mm:
            continue

        dashed = _is_dashed_attr(attrs)
        kind = kind_override or ("fold" if dashed else None)
        if is_outline and not kind:
            kind = "cut"
        if kind == "fold":
            for a, b in segs_mm:
                raw_fold.append((a, b, stroke_name, fold_meta))
        elif kind == "cut":
            for a, b in segs_mm:
                raw_cut.append((a, b, stroke_name))
        else:
            unlabeled.extend(segs_mm)

    heur_folds, leftover = _merge_colinear_short_dashes(unlabeled)
    for a, b in heur_folds:
        raw_fold.append((a, b, None, {}))
    for a, b in leftover:
        raw_cut.append((a, b, None))

    def _as_dicts_cut(
        segs: list[tuple[tuple[float, float], tuple[float, float], Optional[str]]],
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for a, b, name in segs:
            item: dict[str, Any] = {
                "x1": round(a[0], 2),
                "y1": round(a[1], 2),
                "x2": round(b[0], 2),
                "y2": round(b[1], 2),
            }
            if name:
                item["name"] = name
            out.append(item)
        return out

    def _as_dicts_fold(
        segs: list[
            tuple[
                tuple[float, float],
                tuple[float, float],
                Optional[str],
                dict[str, Any],
            ]
        ],
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for a, b, name, meta in segs:
            item: dict[str, Any] = {
                "x1": round(a[0], 2),
                "y1": round(a[1], 2),
                "x2": round(b[0], 2),
                "y2": round(b[1], 2),
            }
            if name:
                item["name"] = name
            if isinstance(meta, dict):
                item.update(meta)
            out.append(item)
        return out

    fold_segments_mm = _as_dicts_fold(raw_fold)
    cut_segments_mm = _as_dicts_cut(raw_cut)
    vertical_mm, horizontal_mm = _fold_axes_from_segs(fold_segments_mm)

    all_x: list[float] = []
    all_y: list[float] = []
    for s in cut_segments_mm + fold_segments_mm:
        all_x.extend([s["x1"], s["x2"]])
        all_y.extend([s["y1"], s["y2"]])
    for p in net_outline_mm:
        all_x.append(p[0])
        all_y.append(p[1])
    if all_x and all_y:
        x0, x1 = min(all_x), max(all_x)
        y0, y1 = min(all_y), max(all_y)
        cut_bbox_mm = {
            "left": round(x0, 2),
            "top": round(y0, 2),
            "right": round(max(0.0, page_w - x1), 2),
            "bottom": round(max(0.0, page_h - y1), 2),
            "x0Mm": round(x0, 2),
            "y0Mm": round(y0, 2),
            "x1Mm": round(x1, 2),
            "y1Mm": round(y1, 2),
            "widthMm": round(x1 - x0, 2),
            "heightMm": round(y1 - y0, 2),
        }
    else:
        cut_bbox_mm = {
            "left": 0.0,
            "top": 0.0,
            "right": 0.0,
            "bottom": 0.0,
            "x0Mm": 0.0,
            "y0Mm": 0.0,
            "x1Mm": round(page_w, 2),
            "y1Mm": round(page_h, 2),
            "widthMm": round(page_w, 2),
            "heightMm": round(page_h, 2),
        }

    from services.prova_web_dieline_service import estimate_tuck_end_dims

    dims = estimate_tuck_end_dims(vertical_mm, horizontal_mm)

    result: dict[str, Any] = {
        "pageWidthMm": round(page_w, 2),
        "pageHeightMm": round(page_h, 2),
        "cutCount": len(cut_segments_mm),
        "foldCount": len(fold_segments_mm),
        "cutBboxMm": cut_bbox_mm,
        "verticalCreasesMm": vertical_mm,
        "horizontalCreasesMm": horizontal_mm,
        "foldSegmentsMm": fold_segments_mm,
        "cutSegmentsMm": cut_segments_mm,
        "dims": dims,
        "source": "svg",
        "classification": {
            "score": len(fold_segments_mm) * 2 + len(cut_segments_mm),
            "cutCount": len(cut_segments_mm),
            "foldCount": len(fold_segments_mm),
            "isFaca": len(fold_segments_mm) >= 2 and len(cut_segments_mm) >= 1,
        },
    }
    if len(net_outline_mm) >= 3:
        result["netOutlineMm"] = net_outline_mm
    if explicit_panels:
        result["explicitPanelsMm"] = explicit_panels
    return result
