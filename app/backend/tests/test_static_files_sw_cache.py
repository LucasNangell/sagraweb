"""Testes de paths de service worker e headers de cache."""
from __future__ import annotations

from static_files import is_service_worker_script_path


def test_is_service_worker_script_path():
    assert is_service_worker_script_path("sw.js") is True
    assert is_service_worker_script_path("/sagra/sw.js") is True
    assert is_service_worker_script_path("workbox-abc123.js") is True
    assert is_service_worker_script_path("assets/index-xyz.js") is False
    assert is_service_worker_script_path("push-sw.js") is False
