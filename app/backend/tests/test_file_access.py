"""Testes de path traversal e allowlist — files/serve."""
from __future__ import annotations

import pytest
from fastapi import HTTPException


class TestFileAccess:
    def test_blocks_path_traversal(self, storage_root):
        from security.file_access import resolve_allowed_file_path

        with pytest.raises(HTTPException) as exc:
            resolve_allowed_file_path(str(storage_root / ".." / "secret.pdf"))
        assert exc.value.status_code == 403

    def test_blocks_dotdot_in_string(self, storage_root):
        from security.file_access import resolve_allowed_file_path

        with pytest.raises(HTTPException) as exc:
            resolve_allowed_file_path(f"{storage_root}/../outside/file.pdf")
        assert exc.value.status_code == 403

    def test_blocks_env_extension(self, storage_root):
        from security.file_access import resolve_allowed_file_path

        env_file = storage_root / "secrets.env"
        env_file.write_text("SECRET=1", encoding="utf-8")

        with pytest.raises(HTTPException) as exc:
            resolve_allowed_file_path(str(env_file))
        assert exc.value.status_code == 403

    def test_blocks_config_directory_segment(self, storage_root):
        from security.file_access import resolve_allowed_file_path

        config_dir = storage_root / "config"
        config_dir.mkdir()
        blocked = config_dir / "settings.pdf"
        blocked.write_bytes(b"%PDF-1.4")

        with pytest.raises(HTTPException) as exc:
            resolve_allowed_file_path(str(blocked))
        assert exc.value.status_code == 403

    def test_blocks_absolute_path_outside_roots(self, tmp_path, monkeypatch):
        from security.file_access import resolve_allowed_file_path

        outside = tmp_path / "outside"
        outside.mkdir()
        pdf = outside / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        monkeypatch.setattr(
            "security.file_access.get_allowed_roots",
            lambda: [str((tmp_path / "storage").resolve())],
        )

        with pytest.raises(HTTPException) as exc:
            resolve_allowed_file_path(str(pdf.resolve()))
        assert exc.value.status_code == 403

    def test_allows_valid_pdf_inside_root(self, storage_root):
        from security.file_access import resolve_allowed_file_path

        pdf = storage_root / "documento.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")

        resolved = resolve_allowed_file_path(str(pdf))
        assert resolved.name == "documento.pdf"
        assert resolved.is_file()
