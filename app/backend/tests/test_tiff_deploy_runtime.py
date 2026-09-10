from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("check_tiff_runtime", ROOT / "deploy/scripts/check_tiff_runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


def make_package(root):
    (root / "tiff-runtime.json").write_text(json.dumps({"python_tag": "310", "python_version": "3.10"}))
    for relative in (
        "python_pkgs/tifffile/__init__.py", "python_pkgs/imagecodecs/__init__.py",
        "python_pkgs/PIL/__init__.py", "python_pkgs/imagecodecs/_imcd.cp310-win_amd64.pyd",
        "app/backend/services/network_file_preview_service.py",
        "app/backend/services/tif_packed_statistics.py", "app/backend/services/tif_inspection_cache.py",
    ):
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"fixture")


def test_package_requires_tiff_libraries(tmp_path):
    make_package(tmp_path)
    assert runtime.check_package(tmp_path)["python_tag"] == "310"
    (tmp_path / "python_pkgs/tifffile/__init__.py").unlink()
    with pytest.raises(RuntimeError, match="Biblioteca ausente"):
        runtime.check_package(tmp_path)


def test_package_rejects_wrong_native_abi(tmp_path):
    make_package(tmp_path)
    (tmp_path / "python_pkgs/imagecodecs/_imcd.cp310-win_amd64.pyd").rename(
        tmp_path / "python_pkgs/imagecodecs/_imcd.cp314-win_amd64.pyd")
    with pytest.raises(RuntimeError, match="Codec nativo ausente/incompativel"):
        runtime.check_package(tmp_path)


def test_runtime_rejects_wrong_python_before_loading_dlls(tmp_path):
    with pytest.raises(RuntimeError, match="interpretador atual"):
        runtime.check_runtime(tmp_path, {"python_tag": "999", "python_version": "9.99"})


def test_native_lzw_and_real_extractor_in_current_runtime(monkeypatch):
    monkeypatch.setattr(sys, "path", list(sys.path))
    versions = runtime.check_runtime(ROOT, {
        "python_tag": f"{sys.version_info.major}{sys.version_info.minor}",
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}",
    })
    assert versions["tifffile"]
    assert versions["imagecodecs"]


def test_missing_imagecodecs_is_actionable_and_not_a_success(monkeypatch):
    from services.network_file_preview_service import _inspect_tif_graphics_uncached
    monkeypatch.setitem(sys.modules, "imagecodecs", None)
    result = _inspect_tif_graphics_uncached("not-opened.tif")
    assert result["graphics_status"] == "error"
    assert result["blank_graphics"] is None
    assert "pacote de produção" in result["reason"]


def test_publication_preflight_precedes_api_stop():
    # A ordem e critica: uma dependencia faltando nao deve causar indisponibilidade.
    script = (ROOT / "deploy/scripts/publicar-release-prod.ps1").read_text(encoding="utf-8-sig")
    assert script.index("& python $tiffCheck") < script.index("Stop-SagraApiForDeploy")
    assert script.index("& python $tiffCheck") < script.index('"activate-release.ps1"')
