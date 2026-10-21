"""Testes do parser de nomenclatura de chapas TIF."""

from io import BytesIO
import tempfile

import pytest
from PIL import Image

from services.plate_filename_utils import (
    caderno_until_from_filenames,
    parse_chapa_label_from_filename,
    parse_plate_color_from_filename,
    parse_plate_filename,
)
from services.gravacao_externa_service import (
    _apply_plate_separation_tint,
    render_tif_preview_png,
)

OS_1857_FILES = [
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (C).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (K).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (M).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A) (Y).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (C).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (K).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (M).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 A) (Y).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (C).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (K).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (M).tif",
    "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 2 B) (Y).tif",
]


def test_parse_plate_color_suffix():
    assert parse_plate_color_from_filename("arquivo (M).tif") == "M"
    assert parse_plate_color_from_filename("arquivo (c).TIF") == "C"
    assert parse_plate_color_from_filename("sem_cor.tif") is None


def test_parse_chapa_label():
    assert parse_chapa_label_from_filename(OS_1857_FILES[0]) == "Cad 1 A"
    assert parse_chapa_label_from_filename("simples.tif") is None


def test_caderno_until_from_tiff_filenames():
    assert caderno_until_from_filenames(OS_1857_FILES) == 2
    assert caderno_until_from_filenames(["arte.pdf", "capa.tif"]) is None
    assert caderno_until_from_filenames([]) is None


def test_os_1857_grouping_keys():
    groups: dict[str, set[str]] = {}
    for nome in OS_1857_FILES:
        parsed = parse_plate_filename(nome)
        assert parsed.color is not None
        assert parsed.kind == "cmyk"
        assert parsed.chapa_label is not None
        assert parsed.group_key is not None
        groups.setdefault(parsed.group_key, set()).add(parsed.color)

    assert len(groups) == 3
    for colors in groups.values():
        assert colors == {"C", "K", "M", "Y"}


def test_pantone_shares_group_key_without_cmyk_color():
    base = "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A)"
    pantone = parse_plate_filename(f"{base} (Pantone 185).tif")
    cmyk = parse_plate_filename(f"{base} (C).tif")
    assert pantone.kind == "pantone"
    assert pantone.color is None
    assert pantone.group_key == base
    assert pantone.group_key == cmyk.group_key
    assert pantone.channel_token == "Pantone 185"

    spot = parse_plate_filename(f"{base} (Spot).tif")
    assert spot.kind == "pantone"
    assert spot.group_key == base


def test_apply_plate_separation_tint_produces_rgb():
    img = Image.new("1", (4, 4), 0)
    tinted = _apply_plate_separation_tint(img, "M")
    assert tinted.mode == "RGB"
    assert tinted.getpixel((0, 0)) != (255, 255, 255)


def test_render_tif_preview_with_magenta_filename():
    buf = BytesIO()
    Image.new("1", (8, 8), 0).save(buf, format="TIFF")
    buf.seek(0)
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        tmp.write(buf.getvalue())
        tmp.flush()
        png = render_tif_preview_png(tmp.name, filename="test (M).tif")
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    preview = Image.open(BytesIO(png))
    assert preview.mode == "RGB"


def test_render_tif_preview_grayscale_without_color_suffix():
    buf = BytesIO()
    Image.new("1", (8, 8), 1).save(buf, format="TIFF")
    buf.seek(0)
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        tmp.write(buf.getvalue())
        tmp.flush()
        png = render_tif_preview_png(tmp.name, filename="sem_cor.tif")
    preview = Image.open(BytesIO(png))
    assert preview.mode in ("L", "RGB")
