"""Testes de paths de service worker e headers de cache."""
from __future__ import annotations

from static_files import (
    apply_hashed_asset_cache_headers,
    apply_sw_cache_headers,
    is_hashed_vite_asset_path,
    is_service_worker_script_path,
    strip_spa_base_prefix,
)


class _FakeResponse:
    def __init__(self, status_code: int = 200):
        self.status_code = status_code
        self.headers: dict[str, str] = {}


def test_strip_spa_base_prefix():
    assert strip_spa_base_prefix("assets/index.js") == "assets/index.js"
    assert strip_spa_base_prefix("sagra/assets/index.js") == "assets/index.js"
    assert strip_spa_base_prefix("/sagra/sw.js") == "sw.js"
    assert strip_spa_base_prefix("sagra") == ""
    assert strip_spa_base_prefix("sagra/") == ""


def test_is_service_worker_script_path():
    assert is_service_worker_script_path("sw.js") is True
    assert is_service_worker_script_path("/sagra/sw.js") is True
    assert is_service_worker_script_path("workbox-abc123.js") is True
    assert is_service_worker_script_path("assets/index-xyz.js") is False
    assert is_service_worker_script_path("push-sw.js") is True
    assert is_service_worker_script_path("/sagra/push-sw.js") is True


def test_is_hashed_vite_asset_path():
    assert is_hashed_vite_asset_path("assets/index-DY-IhfeQ.js") is True
    assert is_hashed_vite_asset_path("assets/index-DGy-lBUq.css") is True
    assert is_hashed_vite_asset_path("assets/pdf.worker.min-yatZIOMy.mjs") is True
    assert is_hashed_vite_asset_path("sagra/assets/vendor-react-abc123.js") is True
    assert is_hashed_vite_asset_path("assets/logo-Cjt2b1Oo.png") is True
    assert is_hashed_vite_asset_path("index.html") is False
    assert is_hashed_vite_asset_path("sw.js") is False
    assert is_hashed_vite_asset_path("build-id.txt") is False
    assert is_hashed_vite_asset_path("assets/") is False


def test_apply_hashed_asset_cache_headers():
    ok = _FakeResponse()
    apply_hashed_asset_cache_headers("assets/index-DYIhfeQ1.js", ok)
    assert ok.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    html = _FakeResponse()
    apply_hashed_asset_cache_headers("index.html", html)
    assert "Cache-Control" not in html.headers

    sw = _FakeResponse()
    apply_sw_cache_headers("sw.js", sw)
    apply_hashed_asset_cache_headers("sw.js", sw)
    assert sw.headers["Cache-Control"] == "no-cache, no-store, must-revalidate"
