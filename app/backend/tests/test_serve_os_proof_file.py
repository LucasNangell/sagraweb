"""Endpoint GET /email/os/{ano}/{os}/proof-file — PDF da pasta Sefoc."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.responses import FileResponse


class TestServeOsProofFile:
    def test_serves_pdf_from_sefoc(self, tmp_path, monkeypatch):
        from routers.email_routes import serve_os_proof_file

        sefoc = tmp_path / "Sefoc"
        sefoc.mkdir()
        pdf = sefoc / "05024-Nome-ProvaSefoc 2.pdf"
        pdf.write_bytes(b"%PDF-1.4 proof")

        monkeypatch.setattr(
            "services.proof_files_service.resolve_proof_pdf_path",
            lambda *_a, **_k: str(pdf),
        )

        response = serve_os_proof_file(
            2026,
            5024,
            filename="05024-Nome-ProvaSefoc 2.pdf",
            session={"ponto": "1"},  # type: ignore[arg-type]
        )
        assert isinstance(response, FileResponse)
        assert response.media_type == "application/pdf"
        assert Path(response.path).name == "05024-Nome-ProvaSefoc 2.pdf"

    def test_propagates_not_found(self, monkeypatch):
        from routers.email_routes import serve_os_proof_file

        def _raise(*_a, **_k):
            raise HTTPException(status_code=404, detail="PDF de prova não encontrado na pasta Sefoc.")

        monkeypatch.setattr(
            "services.proof_files_service.resolve_proof_pdf_path",
            _raise,
        )

        with pytest.raises(HTTPException) as exc:
            serve_os_proof_file(
                2026,
                5024,
                filename="ausente.pdf",
                session={"ponto": "1"},  # type: ignore[arg-type]
            )
        assert exc.value.status_code == 404
