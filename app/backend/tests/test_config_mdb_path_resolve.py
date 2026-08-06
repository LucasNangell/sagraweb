"""Resolução de caminho MDB (unidade mapeada → UNC)."""
from __future__ import annotations

import os
from unittest.mock import patch

from config_manager import config_manager


class TestResolveMdbPath:
    def test_existing_file_unchanged(self, tmp_path):
        mdb = tmp_path / "test.mdb"
        mdb.write_bytes(b"x")
        assert config_manager.resolve_mdb_path(str(mdb)) == os.path.normpath(str(mdb))

    def test_resolves_drive_to_unc_on_windows(self, monkeypatch):
        configured = r"I:\ControleDeTrabalhos\BaseDeDados\Sagra Base - OS Atual.mdb"
        monkeypatch.setattr(os.path, "isfile", lambda path: False)
        monkeypatch.setattr(os, "name", "nt")
        monkeypatch.setattr(
            config_manager,
            "_windows_unc_for_drive",
            lambda letter: r"\\redecamara\DfsData\CGraf" if letter.upper() == "I" else None,
        )
        resolved = config_manager.resolve_mdb_path(configured)
        assert resolved.startswith(r"\\redecamara\DfsData\CGraf")
        assert resolved.endswith("Sagra Base - OS Atual.mdb")

    def test_prefers_unc_even_when_mapped_drive_is_visible(self, monkeypatch):
        """ODBC Access falha com letra de unidade mesmo se os.path.isfile retorna True."""
        configured = r"I:\ControleDeTrabalhos\BaseDeDados\Sagra Base - OS Atual.mdb"
        monkeypatch.setattr(os.path, "isfile", lambda path: True)
        monkeypatch.setattr(os, "name", "nt")
        monkeypatch.setattr(
            config_manager,
            "_windows_unc_for_drive",
            lambda letter: None,
        )
        resolved = config_manager.resolve_mdb_path(configured)
        assert resolved.startswith(r"\\redecamara\DfsData\CGraf")
        assert resolved.endswith("Sagra Base - OS Atual.mdb")

    def test_unc_path_unchanged(self, monkeypatch):
        configured = r"\\redecamara\DfsData\CGraf\ControleDeTrabalhos\file.mdb"
        monkeypatch.setattr(os.path, "isfile", lambda path: False)
        monkeypatch.setattr(os, "name", "nt")
        resolved = config_manager.resolve_mdb_path(configured)
        assert resolved == os.path.normpath(configured)
