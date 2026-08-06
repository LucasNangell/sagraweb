"""Testes — PDF consolidado de problemas técnicos."""
from __future__ import annotations

import base64
import os

import pytest

from services.pt_report_html_service import embed_indication_images_for_pdf
from services.pt_report_pdf_service import (
    _build_pdf_html_document,
    analysis_pdf_filename,
    html_to_pdf_bytes,
    refresh_pt_analysis_pdf,
    save_pt_consolidated_pdf,
)


class TestAnalysisPdfFilename:
    def test_versioned_name(self):
        assert analysis_pdf_filename("v2") == "Análise v2.pdf"

    def test_empty_fallback(self):
        assert analysis_pdf_filename("") == "Análise.pdf"


class TestHtmlToPdfBytes:
    def test_produces_valid_pdf_header(self):
        doc = _build_pdf_html_document(
            '<div class="pt-email-report"><p>Teste</p></div>'
        )
        data = html_to_pdf_bytes(doc)
        assert data.startswith(b"%PDF")
        assert len(data) > 1000


class TestEmbedIndicationImagesForPdf:
    def test_embeds_api_url_as_data_uri(self, tmp_path, monkeypatch):
        item_id = 42
        storage_dir = tmp_path / "storage" / "analise_indications" / str(item_id)
        storage_dir.mkdir(parents=True)
        filename = "mark.png"
        image_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
        (storage_dir / filename).write_bytes(image_bytes)
        monkeypatch.chdir(tmp_path)

        html = (
            f'<img src="/api/analise/item/{item_id}/indication/{filename}" alt="Indicação">'
        )
        out = embed_indication_images_for_pdf(html)
        assert "data:image/png;base64," in out
        assert f"/api/analise/item/{item_id}/indication/" not in out
        payload = out.split("base64,")[1].split('"')[0]
        assert base64.b64decode(payload) == image_bytes


class TestSavePtConsolidatedPdf:
    def test_saves_pdf_in_admin_docs(self, tmp_path, monkeypatch):
        os_dir = tmp_path / "05999-Teste-Produto"
        admin_docs = os_dir / "Sefoc" / "AdminDocs"
        admin_docs.mkdir(parents=True)
        monkeypatch.setattr(
            "services.pt_report_pdf_service.resolve_admin_docs_dir",
            lambda ano, os_id: str(admin_docs),
        )

        inner_html = """
        <div style="font-family: Arial, sans-serif;">
            <p style="font-weight: bold;">PROBLEMAS TÉCNICOS - ARQUIVO V1</p>
            <div class='item-snapshot'><h2>1. Formato</h2><p>Descrição</p></div>
        </div>
        """
        result = save_pt_consolidated_pdf(2026, 5999, inner_html, versao="v1")
        assert result is not None
        assert os.path.isfile(result)
        assert result.endswith("Análise v1.pdf")
        with open(result, "rb") as handle:
            assert handle.read(4) == b"%PDF"

    def test_returns_none_for_empty_html(self, monkeypatch):
        monkeypatch.setattr(
            "services.pt_report_pdf_service.resolve_admin_docs_dir",
            lambda ano, os_id: "/tmp",
        )
        assert save_pt_consolidated_pdf(2026, 1, "") is None

    def test_returns_none_when_folder_missing(self, monkeypatch):
        monkeypatch.setattr(
            "services.pt_report_pdf_service.resolve_admin_docs_dir",
            lambda ano, os_id: None,
        )
        assert save_pt_consolidated_pdf(2026, 1, "<p>x</p>") is None

    def test_removes_pdf_when_html_empty(self, tmp_path, monkeypatch):
        admin_docs = tmp_path / "AdminDocs"
        admin_docs.mkdir(parents=True)
        pdf_path = admin_docs / "Análise v1.pdf"
        pdf_path.write_bytes(b"%PDF-old")
        monkeypatch.setattr(
            "services.pt_report_pdf_service.resolve_admin_docs_dir",
            lambda ano, os_id: str(admin_docs),
        )
        assert save_pt_consolidated_pdf(2026, 1, "", versao="v1") is None
        assert not pdf_path.is_file()
