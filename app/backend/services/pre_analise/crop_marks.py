"""

Detecção de marcas de corte e cálculo do formato (trim) a partir delas.



O formato final é o retângulo *dentro* das marcas (linha de corte), não o MediaBox.



Suporta: cantoneira em L, traços laterais, marcas japonesas, cruz, par sangria+corte,

marcas em content stream e TrimBox como referência de faixa de busca.

"""

from __future__ import annotations



import logging

import re

from dataclasses import dataclass

from typing import Any, Dict, List, Optional, Set, Tuple



logger = logging.getLogger(__name__)



try:

    import fitz

except ImportError:  # pragma: no cover

    fitz = None  # type: ignore



PT_TO_MM = 25.4 / 72.0

# Marcas típicas 3–15 mm; japonesas / registro até ~70 mm

MIN_MARK_MM = 0.35

MAX_MARK_MM = 70.0

MIN_MARK_PT = MIN_MARK_MM / PT_TO_MM

MAX_MARK_PT = MAX_MARK_MM / PT_TO_MM

ORTH_TOL_PT = 1.2

# Faixa de busca na sangria (fora do trim, não no miolo)

MARK_BAND_MAX_PT = 90.0

MARK_BAND_RATIO = 0.11

MARK_INSET_PT = 6.0

CLUSTER_TOL_PT = 5.0

CORNER_JOIN_TOL_PT = 4.0

L_CORNER_MAX_DIST_PT = 55.0

TRIMBOX_MATCH_TOL_MM = 4.0

TRIMBOX_MATCH_TOL_PT = TRIMBOX_MATCH_TOL_MM / PT_TO_MM





@dataclass

class Segment:

    x1: float

    y1: float

    x2: float

    y2: float

    horizontal: bool

    vertical: bool

    length_pt: float

    mid_x: float

    mid_y: float





def segment_from_line(p1: Any, p2: Any) -> Optional[Segment]:

    x1, y1 = float(p1.x), float(p1.y)

    x2, y2 = float(p2.x), float(p2.y)

    dx, dy = abs(x2 - x1), abs(y2 - y1)

    if dx < ORTH_TOL_PT and dy < ORTH_TOL_PT:

        return None

    horizontal = dy <= ORTH_TOL_PT

    vertical = dx <= ORTH_TOL_PT

    if not horizontal and not vertical:

        if dx > dy * 4:

            horizontal = True

        elif dy > dx * 4:

            vertical = True

        else:

            return None

    length = (dx * dx + dy * dy) ** 0.5

    if length < MIN_MARK_PT or length > MAX_MARK_PT:

        return None

    return Segment(

        x1=x1,

        y1=y1,

        x2=x2,

        y2=y2,

        horizontal=horizontal,

        vertical=vertical,

        length_pt=length,

        mid_x=(x1 + x2) / 2,

        mid_y=(y1 + y2) / 2,

    )





def _segments_from_rect(rect: Any) -> List[Segment]:

    x0, y0, x1, y1 = float(rect.x0), float(rect.y0), float(rect.x1), float(rect.y1)

    w, h = abs(x1 - x0), abs(y1 - y0)

    if max(w, h) > MAX_MARK_PT:

        return []

    if min(w, h) > MAX_MARK_PT * 0.65:

        return []

    out: List[Segment] = []

    if w >= h:

        seg = segment_from_line(

            fitz.Point(x0, (y0 + y1) / 2), fitz.Point(x1, (y0 + y1) / 2)

        )

    else:

        seg = segment_from_line(

            fitz.Point((x0 + x1) / 2, y0), fitz.Point((x0 + x1) / 2, y1)

        )

    if seg:

        out.append(seg)

    return out





def _reference_rect(page: Any) -> Any:

    """Rect de referência: TrimBox/CropBox se diferente do Media, senão MediaBox."""

    media = fitz.Rect(page.mediabox)

    if media.is_empty or media.is_infinite:

        media = page.rect

    for name in ("trimbox", "cropbox"):

        try:

            box = getattr(page, name)

            if box is None:

                continue

            rect = fitz.Rect(box)

            if rect.is_empty or rect.is_infinite:

                continue

            if abs(rect.width - media.width) > 2 or abs(rect.height - media.height) > 2:

                return rect

        except Exception:

            continue

    return media





def _analysis_rect(page: Any) -> Any:

    """Área total: MediaBox unida ao bbox dos desenhos (marcas fora da página)."""

    media = fitz.Rect(page.mediabox)

    if media.is_empty or media.is_infinite:

        media = page.rect

    try:

        drawings = page.get_drawings()

    except Exception:

        return media

    union = fitz.Rect(media)

    for d in drawings:

        dr = d.get("rect")

        if dr is not None:

            r = fitz.Rect(dr)

            if not r.is_empty:

                union |= r

    pad = max(8.0, min(union.width, union.height) * 0.02)

    union.x0 -= pad

    union.y0 -= pad

    union.x1 += pad

    union.y1 += pad

    return union





def _mark_band_pt(ref: Any) -> float:

    return min(MARK_BAND_MAX_PT, max(24.0, ref.width * MARK_BAND_RATIO, ref.height * MARK_BAND_RATIO))





def _page_media_rect(page: Any) -> Any:

    media = fitz.Rect(page.mediabox)

    if media.is_empty or media.is_infinite:

        return page.rect

    return media





def _trim_box_rect(page: Any) -> Optional[Any]:

    """TrimBox explícita quando difere do MediaBox."""

    media = _page_media_rect(page)

    try:

        box = getattr(page, "trimbox", None)

        if box is None:

            return None

        rect = fitz.Rect(box)

        if rect.is_empty or rect.is_infinite:

            return None

        if abs(rect.width - media.width) <= 2 and abs(rect.height - media.height) <= 2:

            return None

        return rect

    except Exception:

        return None





def _bleed_bands_pt(page: Any, ref: Any) -> Tuple[float, float, float, float]:

    """

    Faixa de busca por lado: sangria entre trim (ref) e media, não o miolo.



    Evita confundir linhas de dobra/corte internas com marcas de corte externas.

    """

    media = _page_media_rect(page)

    left = max(8.0, min(MARK_BAND_MAX_PT, float(ref.x0 - media.x0) + MARK_INSET_PT))

    right = max(8.0, min(MARK_BAND_MAX_PT, float(media.x1 - ref.x1) + MARK_INSET_PT))

    top = max(8.0, min(MARK_BAND_MAX_PT, float(ref.y0 - media.y0) + MARK_INSET_PT))

    bottom = max(8.0, min(MARK_BAND_MAX_PT, float(media.y1 - ref.y1) + MARK_INSET_PT))

    return left, right, top, bottom





def _segment_in_bleed_zone(

    seg: Segment, ref: Any, side: str, bands: Tuple[float, float, float, float]

) -> bool:

    """Traço candidato a marca de corte apenas na sangria técnica (fora do trim)."""

    left_b, right_b, top_b, bottom_b = bands

    x0, y0, x1, y1 = float(ref.x0), float(ref.y0), float(ref.x1), float(ref.y1)

    min_x, max_x = min(seg.x1, seg.x2), max(seg.x1, seg.x2)

    min_y, max_y = min(seg.y1, seg.y2), max(seg.y1, seg.y2)



    if side == "left":

        return max_x <= x0 + 2.0 and min_x >= x0 - left_b

    if side == "right":

        return min_x >= x1 - 2.0 and max_x <= x1 + right_b

    if side == "top":

        return max_y <= y0 + 2.0 and min_y >= y0 - top_b

    if side == "bottom":

        return min_y >= y1 - 2.0 and max_y <= y1 + bottom_b

    return False





def _segments_from_content(page: Any, doc: Any) -> List[Segment]:

    """Extrai segmentos ortogonais curtos do content stream (m l)."""

    segments: List[Segment] = []

    try:

        content = page.read_contents() or b""

    except Exception:

        return segments

    if not content and doc is not None:

        try:

            parts = []

            for xref in page.get_contents() or []:

                parts.append(doc.xref_stream(xref) or b"")

            content = b"".join(parts)

        except Exception:

            return segments

    if not content:

        return segments



    text = content.decode("latin-1", errors="ignore")

    # Pares de coordenadas seguidos de m/l (simplificado, espaço usuário)

    nums = re.findall(r"-?\d+\.?\d*|-?\.\d+", text)

    try:

        floats = [float(n) for n in nums]

    except ValueError:

        return segments



    i = 0

    cur_x, cur_y = None, None

    tokens = re.split(r"\s+", text)

    j = 0

    while j < len(tokens):

        tok = tokens[j]

        if tok in ("m", "l") and j >= 2:

            try:

                y = float(tokens[j - 1])

                x = float(tokens[j - 2])

            except ValueError:

                j += 1

                continue

            if tok == "m":

                cur_x, cur_y = x, y

            elif tok == "l" and cur_x is not None:

                seg = segment_from_line(fitz.Point(cur_x, cur_y), fitz.Point(x, y))

                if seg:

                    segments.append(seg)

                cur_x, cur_y = x, y

        j += 1

    return segments





def collect_crop_mark_segments(page: Any, doc: Any = None) -> List[Segment]:

    """Coleta segmentos candidatos a marcas de corte (drawings + content stream)."""

    segments: List[Segment] = []

    if fitz is None:

        return segments



    seen: Set[Tuple[int, int, int, int]] = set()



    def add_seg(seg: Optional[Segment]) -> None:

        if seg is None:

            return

        key = (

            int(seg.x1 * 2),

            int(seg.y1 * 2),

            int(seg.x2 * 2),

            int(seg.y2 * 2),

        )

        key2 = (key[2], key[3], key[0], key[1])

        if key in seen or key2 in seen:

            return

        seen.add(key)

        segments.append(seg)



    try:

        for drawing in page.get_drawings():

            for item in drawing.get("items") or []:

                kind = item[0]

                if kind == "l" and len(item) >= 3:

                    add_seg(segment_from_line(item[1], item[2]))

                elif kind == "re" and len(item) >= 2:

                    for s in _segments_from_rect(item[1]):

                        add_seg(s)

                elif kind == "qu" and len(item) >= 5:

                    add_seg(segment_from_line(item[1], item[4]))

    except Exception as exc:

        logger.debug("get_drawings: %s", exc)



    for seg in _segments_from_content(page, doc):

        add_seg(seg)



    ref = _reference_rect(page)

    w, h = ref.width, ref.height

    filtered: List[Segment] = []

    for seg in segments:

        if seg.horizontal and seg.length_pt > w * 0.45:

            continue

        if seg.vertical and seg.length_pt > h * 0.45:

            continue

        filtered.append(seg)

    return filtered





def _cluster_values(values: List[float], tol: float = CLUSTER_TOL_PT) -> List[List[float]]:

    if not values:

        return []

    ordered = sorted(values)

    clusters: List[List[float]] = [[ordered[0]]]

    for v in ordered[1:]:

        if v - clusters[-1][-1] <= tol:

            clusters[-1].append(v)

        else:

            clusters.append([v])

    return clusters





def _pick_cluster_inner(clusters: List[List[float]], side: str) -> Optional[float]:

    if not clusters:

        return None

    centroids = [(sum(c) / len(c), c) for c in clusters]



    if side == "left":

        return max(centroids, key=lambda t: t[0])[0]

    if side == "right":

        return min(centroids, key=lambda t: t[0])[0]

    if side == "top":

        return max(centroids, key=lambda t: t[0])[0]

    if side == "bottom":

        return min(centroids, key=lambda t: t[0])[0]

    return centroids[0][0]





def _segment_endpoints(seg: Segment) -> List[Tuple[float, float]]:

    return [(seg.x1, seg.y1), (seg.x2, seg.y2)]





def _dist(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:

    return ((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2) ** 0.5





def _trim_from_l_corners(

    segments: List[Segment], ref: Any

) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:

    """

    Detecta cantoneiras em L: vértice interno de cada canto define o trim.

    """

    cx = (ref.x0 + ref.x1) / 2

    cy = (ref.y0 + ref.y1) / 2

    inner_pts: List[Tuple[float, float]] = []



    for i, s1 in enumerate(segments):

        for s2 in segments[i + 1 :]:

            if s1.horizontal == s2.horizontal:

                continue

            for p in _segment_endpoints(s1):

                for q in _segment_endpoints(s2):

                    if _dist(p, q) > CORNER_JOIN_TOL_PT:

                        continue

                    # Vértice compartilhado da L; os outros dois pontos são para o miolo

                    others = [

                        ep

                        for ep in _segment_endpoints(s1) + _segment_endpoints(s2)

                        if _dist(ep, p) > 1.0

                    ]

                    if len(others) < 2:

                        continue

                    # Ponto interno: mais próximo do centro da página

                    toward = min(

                        others,

                        key=lambda ep: _dist(ep, (cx, cy)),

                    )

                    if _dist(toward, (cx, cy)) < _dist(p, (cx, cy)):

                        inner_pts.append(toward)

                    else:

                        # às vezes o join é o ponto interno

                        inner_pts.append(p)



    if len(inner_pts) < 2:

        return None, None, None, None



    left_vals = [p[0] for p in inner_pts if p[0] <= cx]

    right_vals = [p[0] for p in inner_pts if p[0] > cx]

    top_vals = [p[1] for p in inner_pts if p[1] <= cy]

    bottom_vals = [p[1] for p in inner_pts if p[1] > cy]



    left = max(left_vals) if left_vals else None

    right = min(right_vals) if right_vals else None

    top = max(top_vals) if top_vals else None

    bottom = min(bottom_vals) if bottom_vals else None

    return left, right, top, bottom





def _edge_trim_from_segments(

    segments: List[Segment], ref: Any, page: Any

) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:

    """

    Bordas do trim a partir de traços na sangria (entre trim e media), não no miolo.

    """

    bands = _bleed_bands_pt(page, ref)

    left_x: List[float] = []

    right_x: List[float] = []

    top_y: List[float] = []

    bottom_y: List[float] = []



    for seg in segments:

        if seg.vertical:

            x_inner = max(seg.x1, seg.x2)

            x_outer = min(seg.x1, seg.x2)

            if _segment_in_bleed_zone(seg, ref, "left", bands):

                left_x.append(x_inner)

            elif _segment_in_bleed_zone(seg, ref, "right", bands):

                right_x.append(x_outer if x_outer < x_inner else min(seg.x1, seg.x2))

        if seg.horizontal:

            y_inner = max(seg.y1, seg.y2)

            y_outer = min(seg.y1, seg.y2)

            if _segment_in_bleed_zone(seg, ref, "top", bands):

                top_y.append(y_inner)

            elif _segment_in_bleed_zone(seg, ref, "bottom", bands):

                bottom_y.append(y_outer if y_outer < y_inner else min(seg.y1, seg.y2))



    left = _pick_cluster_inner(_cluster_values(left_x), "left")

    right = _pick_cluster_inner(_cluster_values(right_x), "right")

    top = _pick_cluster_inner(_cluster_values(top_y), "top")

    bottom = _pick_cluster_inner(_cluster_values(bottom_y), "bottom")

    return left, right, top, bottom





def _corner_inner_points(

    segments: List[Segment], ref: Any, page: Any

) -> Dict[str, List[Tuple[float, float]]]:

    left_b, right_b, top_b, bottom_b = _bleed_bands_pt(page, ref)

    x0, y0, x1, y1 = float(ref.x0), float(ref.y0), float(ref.x1), float(ref.y1)

    points: Dict[str, List[Tuple[float, float]]] = {

        "tl": [],

        "tr": [],

        "bl": [],

        "br": [],

    }



    for seg in segments:

        for corner, cx, cy, bx, by in (

            ("tl", x0, y0, left_b, top_b),

            ("tr", x1, y0, right_b, top_b),

            ("bl", x0, y1, left_b, bottom_b),

            ("br", x1, y1, right_b, bottom_b),

        ):

            if abs(seg.mid_x - cx) > bx or abs(seg.mid_y - cy) > by:

                continue

            xs = (seg.x1, seg.x2)

            ys = (seg.y1, seg.y2)

            if corner == "tl":

                points["tl"].append((max(xs), max(ys)))

            elif corner == "tr":

                points["tr"].append((min(xs), max(ys)))

            elif corner == "bl":

                points["bl"].append((max(xs), min(ys)))

            else:

                points["br"].append((min(xs), min(ys)))

    return points





def _merge_corner_into_edges(

    left: Optional[float],

    right: Optional[float],

    top: Optional[float],

    bottom: Optional[float],

    corners: Dict[str, List[Tuple[float, float]]],

) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:

    for corner, pts in corners.items():

        for px, py in pts:

            if corner in ("tl", "bl"):

                left = px if left is None else max(left, px)

            if corner in ("tr", "br"):

                right = px if right is None else min(right, px)

            if corner in ("tl", "tr"):

                top = py if top is None else max(top, py)

            if corner in ("bl", "br"):

                bottom = py if bottom is None else min(bottom, py)

    return left, right, top, bottom





def _merge_sides(

    a: Tuple[Optional[float], Optional[float], Optional[float], Optional[float]],

    b: Tuple[Optional[float], Optional[float], Optional[float], Optional[float]],

) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:

    """Combina dois resultados parciais (mais restritivo no perímetro interno)."""

    la, ra, ta, ba = a

    lb, rb, tb, bb = b

    left = la if la is not None else lb

    if la is not None and lb is not None:

        left = max(la, lb)

    right = ra if ra is not None else rb

    if ra is not None and rb is not None:

        right = min(ra, rb)

    top = ta if ta is not None else tb

    if ta is not None and tb is not None:

        top = max(ta, tb)

    bottom = ba if ba is not None else bb

    if ba is not None and bb is not None:

        bottom = min(ba, bb)

    return left, right, top, bottom





def _compute_trim_with_ref(

    segments: List[Segment], ref: Any, page: Any

) -> Optional[Any]:

    """Calcula trim para um retângulo de referência (TrimBox ou MediaBox)."""

    l_left, l_right, l_top, l_bottom = _trim_from_l_corners(segments, ref)

    e_left, e_right, e_top, e_bottom = _edge_trim_from_segments(segments, ref, page)

    corners = _corner_inner_points(segments, ref, page)

    c_left, c_right, c_top, c_bottom = _merge_corner_into_edges(

        None, None, None, None, corners

    )



    left, right, top, bottom = _merge_sides(

        (l_left, l_right, l_top, l_bottom),

        (e_left, e_right, e_top, e_bottom),

    )

    left, right, top, bottom = _merge_sides(

        (left, right, top, bottom),

        (c_left, c_right, c_top, c_bottom),

    )



    sides = sum(1 for v in (left, right, top, bottom) if v is not None)

    if sides < 3:

        return None



    if left is None and right is not None:

        left = ref.x0 + (ref.x1 - right)

    if right is None and left is not None:

        right = ref.x1 - (left - ref.x0)

    if top is None and bottom is not None:

        top = ref.y0 + (ref.y1 - bottom)

    if bottom is None and top is not None:

        bottom = ref.y1 - (top - ref.y0)



    if left is None or right is None or top is None or bottom is None:

        return None



    if right <= left or bottom <= top:

        return None



    width = right - left

    height = bottom - top

    ref_w = float(ref.width)

    ref_h = float(ref.height)



    if width < ref_w * 0.12 or height < ref_h * 0.12:

        return None

    if width > ref_w * 1.08 or height > ref_h * 1.08:

        return None



    return fitz.Rect(left, top, right, bottom)





def _rect_matches_trimbox(computed: Any, trimbox: Any, tol_pt: float = TRIMBOX_MATCH_TOL_PT) -> bool:

    return (

        abs(computed.x0 - trimbox.x0) <= tol_pt

        and abs(computed.y0 - trimbox.y0) <= tol_pt

        and abs(computed.x1 - trimbox.x1) <= tol_pt

        and abs(computed.y1 - trimbox.y1) <= tol_pt

    )





def trim_box_dimensions_mm(page: Any) -> Optional[Tuple[float, float]]:

    """Altura e largura em mm da TrimBox quando definida."""

    tb = _trim_box_rect(page)

    if tb is None:

        return None

    return (

        round(float(tb.height) * PT_TO_MM, 2),

        round(float(tb.width) * PT_TO_MM, 2),

    )





def compute_trim_rect_from_marks(page: Any, doc: Any = None) -> Optional[Any]:

    """

    Retorna fitz.Rect do formato final (área dentro das marcas de corte).



    Se a TrimBox do PDF divergir pouco da medição por marcas, prioriza a TrimBox.

    """

    if fitz is None:

        return None



    trimbox = _trim_box_rect(page)

    if trimbox is not None:

        segments = collect_crop_mark_segments(page, doc)

        if len(segments) >= 2:

            for ref in (_reference_rect(page),):

                rect = _compute_trim_with_ref(segments, ref, page)

                if rect is not None and _rect_matches_trimbox(rect, trimbox):

                    return rect

        return trimbox



    segments = collect_crop_mark_segments(page, doc)

    if len(segments) < 2:

        return None



    refs: List[Any] = []

    seen_keys: Set[Tuple[int, int, int, int]] = set()

    for r in (_reference_rect(page), _analysis_rect(page)):

        key = (round(r.x0), round(r.y0), round(r.x1), round(r.y1))

        if key not in seen_keys:

            seen_keys.add(key)

            refs.append(r)



    for ref in refs:

        rect = _compute_trim_with_ref(segments, ref, page)

        if rect is not None:

            return rect

    return None





def trim_mm_from_page(page: Any, doc: Any = None) -> Optional[Tuple[float, float, float, float]]:

    """Retorna (altura_mm, largura_mm, left_pt, top_pt) ou None."""

    rect = compute_trim_rect_from_marks(page, doc)

    if rect is None:

        dims = trim_box_dimensions_mm(page)

        if dims is None:

            return None

        h_mm, w_mm = dims

        tb = _trim_box_rect(page)

        if tb is None:

            return None

        return (h_mm, w_mm, float(tb.x0), float(tb.y0))

    w_pt = float(rect.width)

    h_pt = float(rect.height)

    return (

        round(h_pt * PT_TO_MM, 2),

        round(w_pt * PT_TO_MM, 2),

        float(rect.x0),

        float(rect.y0),

    )





def find_duplicate_crop_marks(page: Any) -> List[str]:

    """

    Detecta duplicata real (mesma marca desenhada duas vezes), não cantoneiras em L normais.

    """

    issues: List[str] = []

    ref = _reference_rect(page)

    bands = _bleed_bands_pt(page, ref)

    segments = [

        s

        for s in collect_crop_mark_segments(page)

        if any(

            _segment_in_bleed_zone(s, ref, side, bands)

            for side in ("left", "right", "top", "bottom")

        )

    ]

    if len(segments) < 2:

        return issues



    left_b, right_b, top_b, bottom_b = bands

    x0, y0, x1, y1 = float(ref.x0), float(ref.y0), float(ref.x1), float(ref.y1)



    def corner_of(seg: Segment) -> Optional[str]:

        corners: List[str] = []

        for px, py in ((seg.x1, seg.y1), (seg.x2, seg.y2), (seg.mid_x, seg.mid_y)):

            if px <= x0 + left_b and py <= y0 + top_b:

                corners.append("tl")

            if px >= x1 - right_b and py <= y0 + top_b:

                corners.append("tr")

            if px <= x0 + left_b and py >= y1 - bottom_b:

                corners.append("bl")

            if px >= x1 - right_b and py >= y1 - bottom_b:

                corners.append("br")

        return max(set(corners), key=corners.count) if corners else None



    by_corner: dict[str, List[Segment]] = {"tl": [], "tr": [], "bl": [], "br": []}

    for seg in segments:

        c = corner_of(seg)

        if c:

            by_corner[c].append(seg)



    for corner, segs in by_corner.items():

        for i, a in enumerate(segs):

            for b in segs[i + 1 :]:

                if a.horizontal != b.horizontal:

                    continue

                if a.horizontal:

                    dist = abs(a.mid_y - b.mid_y)

                    overlap = abs(a.mid_x - b.mid_x) < max(a.length_pt, b.length_pt) * 0.35

                else:

                    dist = abs(a.mid_x - b.mid_x)

                    overlap = abs(a.mid_y - b.mid_y) < max(a.length_pt, b.length_pt) * 0.35

                # Vértice da cantoneira em L (distância ~0) não é duplicata de arquivo.

                if dist <= 0.5:

                    continue

                if dist <= 1.5 and overlap:

                    issues.append(f"canto {corner}: marcas sobrepostas (~{dist:.1f} pt)")



    return issues


