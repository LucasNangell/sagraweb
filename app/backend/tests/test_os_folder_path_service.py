"""Cache curto da resolução de pasta da OS."""
from __future__ import annotations


def test_resolve_os_folder_path_cacheia_resultado(monkeypatch):
    from services import os_folder_path_service as svc

    svc.clear_os_folder_path_cache()
    calls = {"n": 0}

    def _uncached(ano, nro):
        calls["n"] += 1
        return fr"\\fake\os\{ano}\{nro:05d}-X"

    monkeypatch.setattr(svc, "_resolve_uncached", _uncached)

    first = svc.resolve_os_folder_path(2026, 5024)
    second = svc.resolve_os_folder_path(2026, 5024)

    assert first == second == r"\\fake\os\2026\05024-X"
    assert calls["n"] == 1


def test_resolve_os_folder_path_pode_bypass_cache(monkeypatch):
    from services import os_folder_path_service as svc

    svc.clear_os_folder_path_cache()
    calls = {"n": 0}

    def _uncached(ano, nro):
        calls["n"] += 1
        return fr"\\fake\os\{ano}\{nro:05d}-Y"

    monkeypatch.setattr(svc, "_resolve_uncached", _uncached)

    svc.resolve_os_folder_path(2026, 5025, use_cache=False)
    svc.resolve_os_folder_path(2026, 5025, use_cache=False)

    assert calls["n"] == 2
