from __future__ import annotations

from unittest.mock import patch
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def isolate_disk_cache(monkeypatch):
    monkeypatch.setattr("services.network_file_preview_service.read_inspection", lambda *args: None)
    monkeypatch.setattr("services.network_file_preview_service.write_inspection", lambda *args: None)


class _FakePage:
    bitspersample = 1

    def __init__(self, pixels: np.ndarray):
        self._pixels = pixels
        self.shape = pixels.shape

    def segments(self, maxworkers=1):
        yield self._pixels, (0, 0, 0), self._pixels.shape


class _FakeTiffFile:
    def __init__(self, _source: str, pixels: np.ndarray):
        self.pages = [_FakePage(pixels)]

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def _inspect_pixels(pixels: np.ndarray):
    with (
        patch("os.path.getsize", return_value=1000),
        patch("tifffile.TiffFile", lambda source: _FakeTiffFile(source, pixels)),
    ):
        from services import network_file_preview_service as svc

        return svc._inspect_tif_graphics_uncached("fake.tif", "fake.tif")


def test_inspect_tif_graphics_detects_empty_plate():
    result = _inspect_pixels(np.zeros((200, 200), dtype=bool))

    assert result["graphics_status"] == "blank_graphics"
    assert result["blank_graphics"] is True


def test_inspect_tif_graphics_detects_central_graphics():
    pixels = np.zeros((200, 200), dtype=bool)
    pixels[70:130, 70:130] = True
    result = _inspect_pixels(pixels)

    assert result["graphics_status"] == "with_graphics"
    assert result["blank_graphics"] is False


def test_inspect_tif_graphics_never_treats_full_ink_as_blank():
    result = _inspect_pixels(np.ones((200, 200), dtype=bool))

    assert result["graphics_status"] == "with_graphics"
    assert result["blank_graphics"] is False


def test_lateral_marks_on_side_b_are_blank_but_central_ink_is_not():
    pixels = np.zeros((1000, 1000), dtype=bool)
    pixels[610:620, 50:65] = True
    pixels[610:620, 935:950] = True
    assert _inspect_pixels(pixels)["blank_graphics"] is True
    pixels[613:617, 500:504] = True
    assert _inspect_pixels(pixels)["blank_graphics"] is False


def test_minisblack_uses_zero_as_ink():
    class BlackPage(_FakePage):
        photometric = 1

    fake = _FakeTiffFile("fake", np.ones((200, 200), dtype=bool))
    fake.pages = [BlackPage(np.ones((200, 200), dtype=bool))]
    with patch("os.path.getsize", return_value=1000), patch("tifffile.TiffFile", return_value=fake):
        from services.network_file_preview_service import _inspect_tif_graphics_uncached
        assert _inspect_tif_graphics_uncached("fake")["blank_graphics"] is True


@pytest.mark.parametrize("filename", [
    "2026_OS 00801-PM-Coedi-Livro_Congre (Cad 0 A) (C).tif",
    "2026_OS 00801-PM-Coedi-Livro_Congre (Cad 0 B) (C).tif",
    "2026_OS 00801-PM-Coedi-Livro_Congre (Cad 0 B) (M).tif",
    "2026_OS 00801-PM-Coedi-Livro_Congre (Cad 0 B) (Y).tif",
])
def test_user_supplied_blank_plates(filename):
    from services.network_file_preview_service import inspect_tif_graphics, _inspect_tif_graphics_uncached
    source = Path(__file__).resolve().parents[3] / "docs" / filename
    if not source.is_file():
        pytest.skip("Amostra de chapa local não disponível neste checkout.")
    result = inspect_tif_graphics(str(source))
    assert result["blank_graphics"] is True
    assert len(result["features"]) == 259
    assert len(result["content_sha256"]) == 64
    legacy = _inspect_tif_graphics_uncached(str(source), use_packed=False)
    assert {k: v for k, v in result.items() if k not in ("inspection_token", "content_sha256")} == legacy


def test_inspection_cache_invalidates_when_source_changes(monkeypatch):
    from services import network_file_preview_service as svc
    svc._cached_inspection.cache_clear()
    monkeypatch.setattr(svc, "inspection_token", lambda _: "first")
    with patch.object(svc, "_inspect_tif_graphics_uncached", return_value={"graphics_status": "inconclusive"}) as decode:
        svc.inspect_tif_graphics("same.tif")
        svc.inspect_tif_graphics("same.tif")
        assert decode.call_count == 1
        monkeypatch.setattr(svc, "inspection_token", lambda _: "changed")
        svc.inspect_tif_graphics("same.tif")
        assert decode.call_count == 2


def test_validate_network_file_batch_limits_size():
    from services.network_file_preview_service import MAX_INSPECTION_FILES, validate_network_file_batch

    with pytest.raises(HTTPException) as exc:
        validate_network_file_batch(
            [
                {"absolute_path": rf"\\server\share\{idx}.tif", "nome": f"{idx}.tif"}
                for idx in range(MAX_INSPECTION_FILES + 1)
            ]
        )

    assert exc.value.status_code == 413


def test_network_preview_route_requires_gravacao_permission():
    from routers.network_files_routes import preview_network_file

    request = type("Request", (), {"state": type("State", (), {"sagra_permissions": {}})()})()

    with pytest.raises(HTTPException) as exc:
        preview_network_file(request, {"absolute_path": "x.pdf", "nome": "x.pdf"})

    assert exc.value.status_code == 403


def test_network_preview_route_serves_tif_with_path_validation():
    from routers.network_files_routes import preview_network_file

    request = type(
        "Request",
        (),
        {"state": type("State", (), {"sagra_permissions": {"sb_gravacao_pendente": True}})()},
    )
    source = r"\\server\share\plate.tif"

    with (
        patch("routers.network_files_routes.resolve_network_file_path", return_value=source) as resolve,
        patch("routers.network_files_routes.get_or_build_preview_png", return_value=b"png") as preview,
    ):
        response = preview_network_file(
            request,
            {"absolute_path": source, "nome": "plate.tif"},
        )

    resolve.assert_called_once_with(source)
    preview.assert_called_once_with(source, filename="plate.tif")
    assert response.media_type == "image/png"
