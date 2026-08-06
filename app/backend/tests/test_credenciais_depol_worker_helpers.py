"""Helpers puros do gerador Credenciais DEPOL (sem COM)."""

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

WORKER_DIR = Path(__file__).resolve().parents[3] / "worker" / "papelaria_worker"
sys.path.insert(0, str(WORKER_DIR))

from credenciais_depol_generator import (  # noqa: E402
    DEPOL_L1_DIGIT_AFTER_DOT_PT,
    DEPOL_L1_ISOLATED_LETTER_PT,
    _CDR_MILLIMETER,
    _DEPOL_BLEED_MM,
    _DEPOL_MEDIA_H_MM,
    _DEPOL_MEDIA_W_MM,
    _aplicar_trimbox_sangria_pdf,
    _mm_to_pt,
    _position_shape_mm,
    _resolve_cdr_millimeter,
    _set_shape_box_bottom_left_mm,
    _set_shape_center_position_mm,
    compute_linha1_font_ranges,
    compute_visual_slot_targets,
    count_linhas_item,
    svg_filename_for_linhas,
    _materialize_local_file,
)


def test_cdr_millimeter_is_not_meter():
    """cdrMillimeter=3; cdrMeter=7 — confusão histórica gerava página ~km."""
    assert _CDR_MILLIMETER == 3
    assert _resolve_cdr_millimeter() == 3


def test_mm_to_pt():
    assert _mm_to_pt(25.4) == pytest.approx(72.0)
    assert _mm_to_pt(85) == pytest.approx(85 * 72 / 25.4)


def test_aplicar_trimbox_sangria_pdf(tmp_path):
    fitz = pytest.importorskip("fitz")
    pdf_path = tmp_path / "depol.pdf"
    doc = fitz.open()
    w = _mm_to_pt(_DEPOL_MEDIA_W_MM)
    h = _mm_to_pt(_DEPOL_MEDIA_H_MM)
    page = doc.new_page(width=w, height=h)
    page.draw_rect(page.rect, color=(0, 0, 0), width=0.5)
    doc.save(str(pdf_path))
    doc.close()

    logs: list[str] = []
    _aplicar_trimbox_sangria_pdf(str(pdf_path), logs)

    doc2 = fitz.open(str(pdf_path))
    try:
        p = doc2[0]
        media = fitz.Rect(p.mediabox)
        trim = fitz.Rect(p.trimbox)
        bleed = fitz.Rect(p.bleedbox)
        assert media.width == pytest.approx(w, abs=0.5)
        assert media.height == pytest.approx(h, abs=0.5)
        assert bleed.width == pytest.approx(media.width, abs=0.5)
        assert bleed.height == pytest.approx(media.height, abs=0.5)
        bleed_pt = _mm_to_pt(_DEPOL_BLEED_MM)
        assert trim.x0 == pytest.approx(media.x0 + bleed_pt, abs=0.5)
        assert trim.y0 == pytest.approx(media.y0 + bleed_pt, abs=0.5)
        assert trim.x1 == pytest.approx(media.x1 - bleed_pt, abs=0.5)
        assert trim.y1 == pytest.approx(media.y1 - bleed_pt, abs=0.5)
        assert trim.width / _mm_to_pt(1) == pytest.approx(75.0, abs=0.05)
        assert trim.height / _mm_to_pt(1) == pytest.approx(110.0, abs=0.05)
    finally:
        doc2.close()

    assert any("TrimBox" in line for line in logs)


def test_svg_filename_for_linhas():
    assert svg_filename_for_linhas(1) == "TXT01.svg"
    assert svg_filename_for_linhas(3) == "TXT03.svg"
    with pytest.raises(ValueError):
        svg_filename_for_linhas(4)


def test_count_linhas_item():
    assert count_linhas_item({"linha1": "a", "linha2": "", "linha3": ""}) == 1
    assert count_linhas_item({"linha1": "a", "linha2": "b", "linha3": ""}) == 2
    assert count_linhas_item({"linha1": "a", "linha2": "b", "linha3": "c"}) == 3
    assert count_linhas_item({"linha1": "", "linha2": "b"}) == 0


def test_set_shape_box_bottom_left():
    shape = SimpleNamespace()
    _set_shape_box_bottom_left_mm(shape, 5.0, 90.0, 75.0, 22.0)
    assert shape.LeftX == 5.0
    assert shape.BottomY == 90.0
    assert shape.SizeWidth == 75.0
    assert shape.SizeHeight == 22.0


def test_set_shape_center_preserves_native_size():
    shape = SimpleNamespace(SizeWidth=39.0, SizeHeight=14.0, CenterX=42.5, CenterY=60.0)
    _set_shape_center_position_mm(shape, 42.5, 40.0)
    assert shape.CenterX == 42.5
    assert shape.CenterY == 40.0
    assert shape.SizeWidth == 39.0
    assert shape.SizeHeight == 14.0


def test_position_shape_mm_does_not_resize():
    shape = SimpleNamespace(SizeWidth=39.0, SizeHeight=14.0, CenterX=10.0, CenterY=10.0)
    logs: list[str] = []
    _position_shape_mm(
        shape,
        {"x_mm": 42.5, "y_mm": 40.0},
        logs,
    )
    assert shape.CenterX == 42.5
    assert shape.CenterY == 40.0
    assert shape.SizeWidth == 39.0
    assert shape.SizeHeight == 14.0
    assert any("nativo" in line for line in logs)


def test_position_shape_mm_missing_shape():
    logs: list[str] = []
    _position_shape_mm(None, {"x_mm": 1, "y_mm": 2}, logs)
    assert logs and "ausente" in logs[0]


def test_is_bitmap_shape():
    from credenciais_depol_generator import _is_bitmap_shape

    assert _is_bitmap_shape(SimpleNamespace(Type=5, Name="x")) is True
    assert _is_bitmap_shape(SimpleNamespace(Type=7, Name="DepolSvg")) is False
    assert _is_bitmap_shape(SimpleNamespace(Type=1, Name="DepolJpg")) is True


def test_pick_imported_shape_prefers_vector_for_svg():
    from credenciais_depol_generator import _pick_imported_shape

    jpg = SimpleNamespace(Type=5, StaticID=1, Name="old", SizeWidth=85, SizeHeight=120)
    svg = SimpleNamespace(Type=7, StaticID=2, Name="new", SizeWidth=39, SizeHeight=14, Text=object())

    class FakePage:
        def __init__(self):
            self._shapes = [jpg, svg]

        @property
        def Shapes(self):
            return self

        @property
        def Count(self):
            return len(self._shapes)

        def Item(self, i):
            return self._shapes[i - 1]

    logs: list[str] = []
    # before_ids = {1} → só StaticID 2 é novo
    picked = _pick_imported_shape(
        None, FakePage(), {1}, logs, kind="svg"
    )
    assert picked is svg


def test_position_rejects_bitmap():
    from credenciais_depol_generator import CorelGenerationError, _position_shape_mm

    bmp = SimpleNamespace(
        Type=5, SizeWidth=85, SizeHeight=120, CenterX=42.5, CenterY=60.0
    )
    with pytest.raises(CorelGenerationError, match="bitmap"):
        _position_shape_mm(bmp, {"x_mm": 40, "y_mm": 40}, [])


def test_compute_linha1_font_ranges_25_1_s():
    text = "25.1 S"
    ranges = compute_linha1_font_ranges(text)
    by_start = {r["start"]: r for r in ranges}
    # "1" após o ponto
    assert by_start[3]["end"] == 4
    assert by_start[3]["size_pt"] == DEPOL_L1_DIGIT_AFTER_DOT_PT
    # "S" letra isolada
    assert by_start[5]["end"] == 6
    assert by_start[5]["size_pt"] == DEPOL_L1_ISOLATED_LETTER_PT
    assert len(ranges) == 2


def test_compute_linha1_font_ranges_monolithic():
    assert compute_linha1_font_ranges("12345") == []
    assert compute_linha1_font_ranges("ABC") == []
    assert compute_linha1_font_ranges("A") == []


def test_compute_linha1_font_ranges_digit_after_dot():
    ranges = compute_linha1_font_ranges("10.2")
    assert ranges == [{"start": 3, "end": 4, "size_pt": DEPOL_L1_DIGIT_AFTER_DOT_PT}]


def test_compute_linha1_font_ranges_isolated_letters():
    text = "A B C"
    ranges = compute_linha1_font_ranges(text)
    assert [(r["start"], r["size_pt"]) for r in ranges] == [
        (0, DEPOL_L1_ISOLATED_LETTER_PT),
        (2, DEPOL_L1_ISOLATED_LETTER_PT),
        (4, DEPOL_L1_ISOLATED_LETTER_PT),
    ]


def test_text_shapes_ordered_by_txt_ids_not_centery():
    """TXT01 = linha 1 mesmo com CenterY menor que TXT02 (como no SVG real)."""
    from credenciais_depol_generator import _collect_text_shapes

    txt02 = SimpleNamespace(
        Name="TXT02",
        Type=6,
        CenterY=90.0,  # visualmente acima
        StaticID=2,
        Text=SimpleNamespace(Story="b"),
    )
    txt01 = SimpleNamespace(
        Name="TXT01",
        Type=6,
        CenterY=40.0,  # visualmente abaixo, mas é Linha 1 (fonte grande)
        StaticID=1,
        Text=SimpleNamespace(Story="a"),
    )

    class Shapes:
        def __init__(self, items):
            self._items = items

        @property
        def Count(self):
            return len(self._items)

        def Item(self, i):
            return self._items[i - 1]

    page = SimpleNamespace(Shapes=Shapes([txt02, txt01]))
    ordered = _collect_text_shapes(page)
    assert [s.Name for s in ordered] == ["TXT01", "TXT02"]


def test_compute_visual_slot_targets_swaps_inverted_geometry():
    """Caso TXT02.svg: papel TXT01 abaixo → alvo move TXT01 para o slot de cima."""
    # role order: TXT01 (baixo), TXT02 (cima)
    centers = [(10.0, 40.0), (10.0, 90.0)]
    targets = compute_visual_slot_targets(centers)
    assert targets == [(10.0, 90.0), (10.0, 40.0)]


def test_compute_visual_slot_targets_noop_when_aligned():
    centers = [(10.0, 90.0), (10.0, 40.0)]
    assert compute_visual_slot_targets(centers) is None


def test_compute_visual_slot_targets_noop_when_y_collapsed():
    centers = [(10.0, 50.0), (12.0, 50.2)]
    assert compute_visual_slot_targets(centers) is None


def test_align_role_shapes_moves_txt01_to_top_slot():
    from credenciais_depol_generator import _align_role_shapes_to_visual_slots

    txt01 = SimpleNamespace(Name="TXT01", CenterX=10.0, CenterY=40.0, SizeWidth=20, SizeHeight=8)
    txt02 = SimpleNamespace(Name="TXT02", CenterX=10.0, CenterY=90.0, SizeWidth=20, SizeHeight=5)
    logs: list[str] = []
    _align_role_shapes_to_visual_slots([txt01, txt02], logs)
    assert txt01.CenterY == pytest.approx(90.0)
    assert txt02.CenterY == pytest.approx(40.0)
    assert any("Realinhou 'TXT01'" in line for line in logs)

def test_text_shapes_prefer_linha_names():
    from credenciais_depol_generator import _collect_text_shapes

    l2 = SimpleNamespace(
        Name="LINHA2",
        Type=6,
        CenterY=90.0,
        StaticID=2,
        Text=SimpleNamespace(Story="b"),
    )
    l1 = SimpleNamespace(
        Name="LINHA1",
        Type=6,
        CenterY=10.0,
        StaticID=1,
        Text=SimpleNamespace(Story="a"),
    )

    class Shapes:
        def __init__(self, items):
            self._items = items

        @property
        def Count(self):
            return len(self._items)

        def Item(self, i):
            return self._items[i - 1]

    page = SimpleNamespace(Shapes=Shapes([l2, l1]))
    ordered = _collect_text_shapes(page)
    assert [s.Name for s in ordered] == ["LINHA1", "LINHA2"]

