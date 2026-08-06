"""Testes — prévia PNG de jobs Papelaria."""
from __future__ import annotations

import os
from unittest.mock import patch

import fitz
import pytest


def _make_pdf(path: str, pages: int = 1) -> None:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=420, height=297)
        page.insert_text((72, 72), f"Prova pagina {i + 1}")
    doc.save(path)
    doc.close()


class TestPapelariaPreviewService:
    def test_ensure_job_preview_pages_cria_png(self, tmp_path, monkeypatch):
        sefoc_base = tmp_path / "Sefoc"
        sefoc_base.mkdir()
        (sefoc_base / "Papelaria").mkdir()
        pdf_path = sefoc_base / "prova.pdf"
        _make_pdf(str(pdf_path), pages=2)
        cache_dir = sefoc_base / "Papelaria" / ".preview" / "job_42"
        job = {
            "id": 42,
            "ano_protocolo": 2026,
            "nro_protocolo": 5557,
            "status": "completed",
        }

        monkeypatch.setattr(
            "services.papelaria_preview_service._get_sefoc_base_for_job",
            lambda _jid: str(sefoc_base),
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.resolve_job_file_path",
            lambda _jid, _tipo: (str(pdf_path), "prova.pdf"),
        )
        monkeypatch.setattr(
            "services.papelaria_jobs_service.get_job",
            lambda _jid: job,
        )

        monkeypatch.setenv("SAGRA_PAPELARIA_PREVIEW_SCALE", "4")
        from services import papelaria_preview_service as preview_svc

        meta = preview_svc.ensure_job_preview_pages(42)
        assert len(meta["pages"]) == 2
        assert (cache_dir / "page_1.png").is_file()
        assert (cache_dir / "page_2.png").is_file()
        from PIL import Image

        scale = float((cache_dir / ".render_scale").read_text().strip())
        with Image.open(cache_dir / "page_1.png") as png:
            assert png.size[0] >= 420 * scale * 0.9

    def test_regenera_png_quando_escala_aumenta(self, tmp_path, monkeypatch):
        sefoc_base = tmp_path / "Sefoc"
        sefoc_base.mkdir()
        pdf_path = sefoc_base / "prova.pdf"
        _make_pdf(str(pdf_path), pages=1)
        cache_dir = sefoc_base / ".preview" / "job_99"
        cache_dir.mkdir(parents=True)

        monkeypatch.setenv("SAGRA_PAPELARIA_PREVIEW_SCALE", "2")
        from services import papelaria_preview_service as preview_svc

        from PIL import Image

        preview_svc._render_pdf_pages(str(pdf_path), str(cache_dir))
        with Image.open(cache_dir / "page_1.png") as low:
            low_w = low.size[0]

        monkeypatch.setenv("SAGRA_PAPELARIA_PREVIEW_SCALE", "4")
        preview_svc._render_pdf_pages(str(pdf_path), str(cache_dir))
        with Image.open(cache_dir / "page_1.png") as high:
            high_w = high.size[0]

        assert high_w > low_w * 1.5

    def test_build_preview_pages_payload_urls(self, monkeypatch):
        monkeypatch.setattr(
            "services.papelaria_preview_service.ensure_job_preview_pages",
            lambda _jid: {
                "pages": [
                    {"page": 1, "path": "/tmp/page_1.png"},
                    {"page": 2, "path": "/tmp/page_2.png"},
                ],
                "total_pages": 2,
                "truncated": False,
            },
        )
        from services import papelaria_preview_service as preview_svc

        payload = preview_svc.build_preview_pages_payload(26)
        assert payload["pages"][0]["url"] == "/api/papelaria/jobs/26/preview-pages/1.png"
        assert payload["total_pages"] == 2

    def test_resolve_preview_page_path_seguranca(self, tmp_path, monkeypatch):
        sefoc_base = tmp_path / "Sefoc"
        preview_dir = sefoc_base / ".preview" / "job_7"
        preview_dir.mkdir(parents=True)
        png = preview_dir / "page_1.png"
        png.write_bytes(b"png")

        monkeypatch.setattr(
            "services.papelaria_preview_service._get_sefoc_base_for_job",
            lambda _jid: str(sefoc_base),
        )
        monkeypatch.setattr(
            "services.papelaria_preview_service.ensure_job_preview_pages",
            lambda _jid: {"pages": [{"page": 1, "path": str(png)}]},
        )

        from services import papelaria_preview_service as preview_svc

        resolved = preview_svc.resolve_preview_page_path(7, 1)
        assert os.path.isfile(resolved)

        with pytest.raises(FileNotFoundError):
            preview_svc.resolve_preview_page_path(7, 9)
