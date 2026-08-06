"""Testes de navegação na rede (raízes CGraf + Apogee)."""
from __future__ import annotations

import os

import pytest


class TestNetworkBrowseRoots:
    def test_includes_cgraf_and_apogee(self, monkeypatch):
        from security.file_access import get_network_browse_roots

        monkeypatch.setattr(
            "config_manager.config_manager.get",
            lambda key, default=None: default if key != "network_paths" else {},
        )
        monkeypatch.setattr(
            "config_manager.config_manager._drive_path_to_unc",
            lambda path: None,
        )

        roots = get_network_browse_roots()
        assert r"\\redecamara\DfsData\CGraf" in roots
        assert r"\\cgrafsysvm\ApogeeFiles" in roots

    def test_apogee_config_override(self, monkeypatch):
        from security.file_access import get_network_browse_roots

        monkeypatch.setattr(
            "config_manager.config_manager.get",
            lambda key, default=None: (
                {"apogee_files": r"\\cgrafsysvm\custom"}
                if key == "network_paths"
                else default
            ),
        )
        monkeypatch.setattr(
            "config_manager.config_manager._drive_path_to_unc",
            lambda path: None,
        )

        roots = get_network_browse_roots()
        assert r"\\cgrafsysvm\custom" in roots
        assert r"\\cgrafsysvm\ApogeeFiles" not in roots

    def test_excludes_local_storage(self, monkeypatch, tmp_path):
        from security import file_access

        storage = tmp_path / "storage"
        storage.mkdir()

        monkeypatch.setattr(file_access, "PROJECT_ROOT", tmp_path, raising=False)
        monkeypatch.setattr(
            "config_manager.PROJECT_ROOT",
            tmp_path,
        )
        monkeypatch.setattr(
            "config_manager.config_manager.get",
            lambda key, default=None: default if key != "network_paths" else {},
        )
        monkeypatch.setattr(
            "config_manager.config_manager._drive_path_to_unc",
            lambda path: None,
        )

        # get_allowed_roots still includes storage; browse must not.
        allowed = file_access.get_allowed_roots()
        storage_resolved = str(storage.resolve())
        assert any(
            os.path.normcase(os.path.normpath(r))
            == os.path.normcase(os.path.normpath(storage_resolved))
            for r in allowed
        )

        browse_roots = file_access.get_network_browse_roots()
        assert not any(
            os.path.normcase(os.path.normpath(r))
            == os.path.normcase(os.path.normpath(storage_resolved))
            for r in browse_roots
        )


class TestBrowseNetworkFolder:
    def test_empty_relative_lists_roots(self, monkeypatch):
        from services.network_files_service import browse_network_folder

        roots = [r"\\redecamara\DfsData\CGraf", r"\\cgrafsysvm\ApogeeFiles"]
        monkeypatch.setattr(
            "services.network_files_service.get_network_browse_roots",
            lambda: roots,
        )

        result = browse_network_folder("")
        assert result["current_path"] == ""
        assert len(result["entries"]) == 2
        names = [entry["name"] for entry in result["entries"]]
        assert set(names) == {"CGraf", "ApogeeFiles"}
        assert names == sorted(names, key=str.lower)
        paths = {entry["path"] for entry in result["entries"]}
        assert paths == set(roots)

    def test_resolve_apogee_path(self, monkeypatch, tmp_path):
        from services.network_files_service import browse_network_folder

        apogee = tmp_path / "apogee"
        apogee.mkdir()
        (apogee / "doc.pdf").write_bytes(b"%PDF-1.4")

        roots = [r"\\redecamara\DfsData\CGraf", str(apogee)]
        monkeypatch.setattr(
            "services.network_files_service.get_network_browse_roots",
            lambda: roots,
        )
        monkeypatch.setattr(
            "services.network_files_service.resolve_network_file_path",
            lambda path, must_be_dir=False: (
                str(apogee) if must_be_dir else os.path.join(str(apogee), "doc.pdf")
            ),
        )
        monkeypatch.setattr(
            "services.network_files_service.match_network_browse_root",
            lambda path: str(apogee),
        )

        result = browse_network_folder(str(apogee))
        assert result["root_path"] == str(apogee)
        file_entries = [e for e in result["entries"] if e["type"] == "file"]
        assert any(e["name"] == "doc.pdf" for e in file_entries)
