"""Testes do preview composto CMYK."""

from io import BytesIO
import tempfile

import pytest
from fastapi import HTTPException
from PIL import Image

from services.gravacao_externa_service import (
    collect_plate_separations_for_group,
    render_plate_composite_png,
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


def _write_tif(path: str, *, ink: int = 0) -> None:
    Image.new("1", (8, 8), ink).save(path, format="TIFF")


def test_collect_plate_separations_os_1857():
    arquivos = [{"id": i + 1, "nome": nome} for i, nome in enumerate(OS_1857_FILES)]
    group_key = "2026_OS 00612-Gr-WaldenorPereira-Informativo_Walden (Cad 1 A)"
    separations = collect_plate_separations_for_group(arquivos, group_key)
    assert set(separations.keys()) == {"C", "K", "M", "Y"}
    assert len(separations) == 4


def test_render_plate_composite_four_colors():
    paths: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmpdir:
        for channel in ("C", "M", "Y", "K"):
            path = f"{tmpdir}/{channel}.tif"
            _write_tif(path, ink=0)
            paths[channel] = path
        png = render_plate_composite_png(paths)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"
    preview = Image.open(BytesIO(png))
    assert preview.mode == "RGB"
    assert preview.getpixel((0, 0)) != (255, 255, 255)


def test_render_plate_composite_two_colors():
    paths: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmpdir:
        for channel in ("C", "M"):
            path = f"{tmpdir}/{channel}.tif"
            _write_tif(path, ink=0)
            paths[channel] = path
        png = render_plate_composite_png(paths)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


def test_render_plate_composite_rejects_single_color():
    paths: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as tmpdir:
        path = f"{tmpdir}/M.tif"
        _write_tif(path)
        paths["M"] = path
        with pytest.raises(HTTPException) as exc:
            render_plate_composite_png(paths)
        assert exc.value.status_code == 400
