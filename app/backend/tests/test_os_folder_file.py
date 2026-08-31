"""Testes do endpoint folder-file (pastas Original da OS)."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.responses import FileResponse


def _os_root(tmp_path: Path) -> Path:
    root = tmp_path / "os"
    (root / "Original").mkdir(parents=True)
    (root / "Sefoc").mkdir()
    return root


class TestIsOriginalOsRelative:
    def test_accepts_original_and_versioned(self):
        from routers.os_routes import is_original_os_relative

        assert is_original_os_relative("Original/arte.pdf") is True
        assert is_original_os_relative("Original V2/sub/a.pdf") is True
        assert is_original_os_relative("orignal/x.pdf") is True

    def test_rejects_other_folders(self):
        from routers.os_routes import is_original_os_relative

        assert is_original_os_relative("Sefoc/prova.pdf") is False
        assert is_original_os_relative("") is False


class TestServeOsFolderFile:
    def test_blocks_path_traversal(self, tmp_path, monkeypatch):
        from routers.os_routes import serve_os_folder_file

        root = _os_root(tmp_path)
        monkeypatch.setattr(
            "routers.os_routes._resolve_os_root_path",
            lambda *_args, **_kwargs: str(root),
        )

        with pytest.raises(HTTPException) as exc:
            serve_os_folder_file(2026, 3100, relative="Original/../Sefoc/x.pdf")
        assert exc.value.status_code == 400

    def test_rejects_file_outside_original(self, tmp_path, monkeypatch):
        from routers.os_routes import serve_os_folder_file

        root = _os_root(tmp_path)
        pdf = root / "Sefoc" / "prova.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        monkeypatch.setattr(
            "routers.os_routes._resolve_os_root_path",
            lambda *_args, **_kwargs: str(root),
        )

        with pytest.raises(HTTPException) as exc:
            serve_os_folder_file(2026, 3100, relative="Sefoc/prova.pdf")
        assert exc.value.status_code == 403

    def test_rejects_blocked_extension(self, tmp_path, monkeypatch):
        from routers.os_routes import serve_os_folder_file

        root = _os_root(tmp_path)
        blocked = root / "Original" / "layout.ai"
        blocked.write_bytes(b"%AI")
        monkeypatch.setattr(
            "routers.os_routes._resolve_os_root_path",
            lambda *_args, **_kwargs: str(root),
        )
        monkeypatch.setattr(
            "security.file_access.get_allowed_roots",
            lambda: [str(root.resolve())],
        )

        with pytest.raises(HTTPException) as exc:
            serve_os_folder_file(2026, 3100, relative="Original/layout.ai")
        assert exc.value.status_code == 403

    def test_serves_pdf_under_original(self, tmp_path, monkeypatch):
        from routers.os_routes import serve_os_folder_file

        root = _os_root(tmp_path)
        pdf = root / "Original" / "arte.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")
        monkeypatch.setattr(
            "routers.os_routes._resolve_os_root_path",
            lambda *_args, **_kwargs: str(root),
        )
        monkeypatch.setattr(
            "security.file_access.get_allowed_roots",
            lambda: [str(root.resolve())],
        )

        response = serve_os_folder_file(2026, 3100, relative="Original/arte.pdf")
        assert isinstance(response, FileResponse)
        assert Path(response.path).resolve() == pdf.resolve()
