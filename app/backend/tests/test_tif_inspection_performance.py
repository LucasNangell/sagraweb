from __future__ import annotations

import io
import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
import tifffile

from services import network_file_preview_service as inspection
from services import tif_inspection_cache as cache
from services.tif_packed_statistics import packed_statistics, supports_packed


@pytest.mark.parametrize("width", [17, 31, 64, 65, 201])
@pytest.mark.parametrize("compression", [None, "lzw"])
@pytest.mark.parametrize("photometric", ["miniswhite", "minisblack"])
def test_packed_statistics_match_all_pixels_and_grid(width, compression, photometric):
    rng = np.random.default_rng(42)
    pixels = rng.random((97, width)) < .08
    pixels[-1, -1] = True  # Último pixel e último strip parcial.
    pixels[0, :] = False
    data = io.BytesIO()
    tifffile.imwrite(data, pixels, compression=compression, photometric=photometric, rowsperstrip=19)
    data.seek(0)
    with tifffile.TiffFile(data) as tif:
        page = tif.pages[0]
        old = inspection._decoded_statistics(page, width, 97)
        new = packed_statistics(page, width, 97, inspection.GRID_SIZE)
        for expected, actual in zip(old, new):
            np.testing.assert_array_equal(expected, actual)


def test_other_compressions_and_fillorder_use_existing_decoder():
    assert not supports_packed(SimpleNamespace(compression=8))
    assert not supports_packed(SimpleNamespace(compression=5, fillorder=2))
    assert not supports_packed(SimpleNamespace(compression=5, predictor=2))


def test_truncated_strip_is_rejected():
    stream = io.BytesIO()
    tifffile.imwrite(stream, np.zeros((32, 65), dtype=bool), rowsperstrip=16)
    stream.seek(0)
    with tifffile.TiffFile(stream) as tif:
        tif.pages[0].databytecounts = (999999, 999999)
        with pytest.raises(ValueError, match="truncado"):
            packed_statistics(tif.pages[0], 65, 32, 16)


def cached_result():
    return {
        "feature_version": inspection.FEATURE_VERSION, "features": [1.0] + [0.0] * 258,
        "content_sha256": "a" * 64, "blank_graphics": True,
        "graphics_status": "blank_graphics", "width": 200, "height": 200,
    }


@pytest.fixture
def disk_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("SAGRA_TIF_INSPECTION_CACHE_DIR", str(tmp_path / "cache"))
    inspection._cached_inspection.cache_clear()
    return tmp_path


def test_persistent_cache_survives_memory_clear_and_checks_source(disk_cache, monkeypatch):
    source = disk_cache / "plate.tif"
    source.write_bytes(b"test")
    token = inspection.inspection_token(str(source))
    cache.write_inspection(token, cached_result(), inspection.FEATURE_VERSION)
    decode = Mock(side_effect=AssertionError("Não deve decodificar novamente"))
    monkeypatch.setattr(inspection, "_inspect_tif_graphics_uncached", decode)
    for _ in range(2):
        inspection._cached_inspection.cache_clear()
        assert inspection.inspect_tif_graphics(str(source))["blank_graphics"] is True
    assert not decode.called
    source.write_bytes(b"changed content")
    assert cache.read_inspection(inspection.inspection_token(str(source)), inspection.FEATURE_VERSION) is None


def test_persistent_cache_handles_300_files(disk_cache):
    result = cached_result()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda i: cache.write_inspection(f"token-{i}", result, inspection.FEATURE_VERSION), range(300)))
    inspection._cached_inspection.cache_clear()
    for i in range(300):
        assert cache.read_inspection(f"token-{i}", inspection.FEATURE_VERSION) == result


def test_cache_rejects_expired_corrupt_and_wrong_version(disk_cache, monkeypatch):
    cache.write_inspection("one", cached_result(), inspection.FEATURE_VERSION)
    assert cache.read_inspection("one", "different-features") is None
    with cache._connect() as connection:
        connection.execute("UPDATE inspection_cache SET payload=? WHERE token='one'", ("{broken",))
    assert cache.read_inspection("one", inspection.FEATURE_VERSION) is None
    cache.write_inspection("one", cached_result(), inspection.FEATURE_VERSION)
    with cache._connect() as connection:
        connection.execute("UPDATE inspection_cache SET created_at=0")
    assert cache.read_inspection("one", inspection.FEATURE_VERSION) is None


def test_cache_is_bounded_and_corrupt_database_does_not_block(disk_cache, monkeypatch):
    monkeypatch.setattr(cache, "MAX_ENTRIES", 3)
    for i in range(5):
        cache.write_inspection(str(i), cached_result(), inspection.FEATURE_VERSION)
    assert cache.read_inspection("0", inspection.FEATURE_VERSION) is None
    assert cache.read_inspection("4", inspection.FEATURE_VERSION) is not None
    broken = disk_cache / "broken.sqlite3"
    broken.write_bytes(b"not a database")
    monkeypatch.setattr(cache, "cache_path", lambda: broken)
    assert cache.read_inspection("4", inspection.FEATURE_VERSION) is None
    cache.write_inspection("4", cached_result(), inspection.FEATURE_VERSION)


def test_one_bad_file_does_not_interrupt_inspection_batch(monkeypatch):
    from routers import network_files_routes as routes
    from fastapi import HTTPException
    request = SimpleNamespace(state=SimpleNamespace(sagra_permissions={"sb_gravacao_pendente": True}))
    def resolve(path):
        if path == "bad.tif":
            raise HTTPException(403, "Forbidden")
        return path
    monkeypatch.setattr(routes, "resolve_network_file_path", resolve)
    monkeypatch.setattr(routes, "inspect_network_file", lambda *args: {"status": "done", "blank_graphics": True})
    response = routes.inspect_network_files(request, {"files": [
        {"absolute_path": "bad.tif", "nome": "bad.tif"},
        {"absolute_path": "good.tif", "nome": "good.tif"},
    ]})
    assert response["files"][0]["status"] == "error"
    assert response["files"][0]["blank_graphics"] is None
    assert response["files"][1]["blank_graphics"] is True
