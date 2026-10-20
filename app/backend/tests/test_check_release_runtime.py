"""Testes do preflight de runtime da release."""
from __future__ import annotations

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "deploy" / "scripts" / "check_release_runtime.py"


def test_check_release_runtime_script_exists_and_is_importable(tmp_path, monkeypatch):
    assert SCRIPT.is_file()
    # Carrega o modulo pelo caminho (nao esta no PYTHONPATH do backend).
    import importlib.util

    spec = importlib.util.spec_from_file_location("check_release_runtime", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    req = tmp_path / "requirements.txt"
    req.write_text("# comment\nfastapi>=0.100\n", encoding="utf-8")
    # fastapi esta instalado no ambiente de testes.
    missing = mod._check_requirements(req)
    assert missing == []

    bad = tmp_path / "requirements-bad.txt"
    bad.write_text("pacote-inexistente-xyz-12345>=99.0\n", encoding="utf-8")
    missing_bad = mod._check_requirements(bad)
    assert any("pacote-inexistente-xyz-12345" in m for m in missing_bad)


def test_compile_skips_legacy_sync_tables(tmp_path):
    import importlib.util

    spec = importlib.util.spec_from_file_location("check_release_runtime", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)

    services = tmp_path / "app" / "services"
    legacy = services / "sync_tables"
    legacy.mkdir(parents=True)
    (legacy / "broken.py").write_text("def x(\\n", encoding="utf-8")  # sintaxe invalida
    ok_dir = services / "okpkg"
    ok_dir.mkdir()
    (ok_dir / "fine.py").write_text("x = 1\n", encoding="utf-8")

    errors = mod._compile_tree(tmp_path, [services])
    assert errors == []
