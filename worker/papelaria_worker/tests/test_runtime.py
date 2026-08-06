"""Testes de runtime (sem COM)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from runtime import (  # noqa: E402
    _is_genpy_cache_error,
    clear_corrupted_corel_genpy_cache,
    dispatch_corel_application,
)


class TestGenpyCacheHelpers:
    def test_is_genpy_cache_error(self):
        assert _is_genpy_cache_error(
            AttributeError(
                "module 'win32com.gen_py.95E23C91-BC5A-49F3-8CD1-1FC515597048x0x19x0' "
                "has no attribute 'CLSIDToClassMap'"
            )
        )
        assert _is_genpy_cache_error(
            AttributeError("has no attribute 'CLSIDToPackageMap'")
        )
        assert not _is_genpy_cache_error(AttributeError("other error"))

    def test_clear_corrupted_corel_genpy_cache(self, tmp_path, monkeypatch):
        corel_dir = tmp_path / "95E23C91-BC5A-49F3-8CD1-1FC515597048x0x19x0"
        corel_dir.mkdir()
        (corel_dir / "stub.py").write_text("# stale", encoding="utf-8")
        rebuild_calls: list[str] = []

        import win32com.client.gencache as gencache

        monkeypatch.setattr(gencache, "GetGeneratePath", lambda: str(tmp_path))
        monkeypatch.setattr(
            gencache,
            "Rebuild",
            lambda: rebuild_calls.append("rebuild"),
        )
        removed = clear_corrupted_corel_genpy_cache()
        assert removed == [corel_dir.name]
        assert rebuild_calls == ["rebuild"]
        assert not corel_dir.exists()

    def test_dispatch_retries_after_genpy_error(self, monkeypatch):
        calls = {"n": 0}

        def fake_dispatch(progid):
            calls["n"] += 1
            if calls["n"] == 1:
                raise AttributeError(
                    "module 'win32com.gen_py.95E23C91' has no attribute 'CLSIDToPackageMap'"
                )
            return object()

        import win32com.client

        monkeypatch.setattr(win32com.client, "Dispatch", fake_dispatch)
        monkeypatch.setattr(
            "runtime.clear_corrupted_corel_genpy_cache",
            lambda: ["95E23C91-BC5A-49F3-8CD1-1FC515597048x0x19x0"],
        )
        app = dispatch_corel_application()
        assert app is not None
        assert calls["n"] == 2
