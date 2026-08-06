"""Testes — inspeção de .cdr via worker."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def inspect_svc():
    from services import papelaria_cdr_inspect_service as svc

    svc._table_ready = True
    return svc


class TestInspectStorage:
    def test_inspect_dir_dev_usa_modelos_locais(self, inspect_svc, monkeypatch):
        from config_manager import config_manager

        monkeypatch.setattr(config_manager, "is_development", lambda: True)
        monkeypatch.delenv("SAGRA_PAPELARIA_INSPECT_DIR", raising=False)
        dest = inspect_svc._inspect_dir()
        assert dest.name == "_inspect"
        assert "Modelos" in str(dest)

    def test_resolve_stored_cdr_path_legado_absoluto(self, inspect_svc, tmp_path):
        cdr = tmp_path / "abc.cdr"
        cdr.write_bytes(b"RIFF")
        resolved = inspect_svc._resolve_stored_cdr_path(str(cdr))
        assert resolved == cdr

    def test_resolve_stored_cdr_path_relativo(self, inspect_svc, monkeypatch, tmp_path):
        monkeypatch.setenv("SAGRA_PAPELARIA_INSPECT_DIR", str(tmp_path))
        cdr = tmp_path / "token123.cdr"
        cdr.write_bytes(b"RIFF")
        resolved = inspect_svc._resolve_stored_cdr_path("token123.cdr")
        assert resolved == cdr

    def test_create_inspect_request_salva_nome_relativo(
        self, inspect_svc, monkeypatch, tmp_path
    ):
        monkeypatch.setenv("SAGRA_PAPELARIA_INSPECT_DIR", str(tmp_path))
        monkeypatch.setattr(inspect_svc.db, "execute_query", lambda *a, **k: [])

        with patch.object(inspect_svc, "get_inspect_request", return_value={"inspect_id": "x"}):
            inspect_svc.create_inspect_request(b"RIFF", "Modelo.cdr")

        saved = list(tmp_path.glob("*.cdr"))
        assert len(saved) == 1
        assert saved[0].name.endswith(".cdr")
