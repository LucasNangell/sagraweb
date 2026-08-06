"""Testes — prévia mockup 3D no portal de prova (token)."""
from __future__ import annotations

import os
from unittest.mock import patch

import fitz
import pytest
from fastapi import HTTPException


def _make_pdf(path: str, pages: int = 2) -> None:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=420, height=297)
        page.insert_text((72, 72), f"Prova pagina {i + 1}")
    doc.save(path)
    doc.close()


class TestProofPapelariaContext:
    def test_os_menor_5000_nao_e_papelaria(self, monkeypatch):
        from services.proof_papelaria_service import resolve_papelaria_proof_context

        assert resolve_papelaria_proof_context({"ID": 1}, 2026, 4999) is None

    def test_os_papelaria_com_pdf(self, monkeypatch):
        from services.proof_papelaria_service import resolve_papelaria_proof_context

        monkeypatch.setattr(
            "services.proof_papelaria_service.resolve_proof_pdf_for_token_row",
            lambda *_a, **_k: ("/tmp/prova.pdf", "prova.pdf"),
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.list_jobs_for_os",
            lambda *_a, **_k: [],
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service._os_produto",
            lambda *_a, **_k: "Cartão de visita",
        )

        ctx = resolve_papelaria_proof_context({"ID": 9}, 2026, 5557)
        assert ctx is not None
        assert ctx["proof_id"] == 9
        assert ctx["produto"] == "Cartão de visita"


class TestProofPortalPreviewEndpoints:
    def _proof_row(self):
        return {
            "ID": 12,
            "Versao": "1",
            "ArquivoProva": "prova.pdf",
            "Aprovado": None,
            "DataExpiracao": None,
        }

    def test_preview_pages_token_invalido(self, monkeypatch):
        from routers.proof_portal_routes import get_proof_preview_pages

        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: (_ for _ in ()).throw(
                HTTPException(status_code=403, detail="Token inválido ou expirado.")
            ),
        )
        with pytest.raises(HTTPException) as exc:
            get_proof_preview_pages(2026, 5557, token="bad")
        assert exc.value.status_code == 403

    def test_preview_pages_nao_papelaria(self, monkeypatch):
        from routers.proof_portal_routes import get_proof_preview_pages

        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: self._proof_row(),
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.resolve_papelaria_proof_context",
            lambda *_a, **_k: None,
        )

        payload = get_proof_preview_pages(2026, 1000, token="valid-token-1234567890")
        assert payload["isPapelaria"] is False
        assert payload["pages"] == []

    def test_preview_pages_papelaria_retorna_urls(self, monkeypatch):
        from routers.proof_portal_routes import get_proof_preview_pages

        ctx = {
            "proof_id": 12,
            "pdf_path": "/tmp/prova.pdf",
            "produto": "Cartão",
            "arquivo_modelo": "CtVisita.cdr",
            "frente_verso": "Frente e Verso",
            "mockup_config_json": None,
        }
        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: self._proof_row(),
        )
        monkeypatch.setattr(
            "services.proof_papelaria_service.resolve_papelaria_proof_context",
            lambda *_a, **_k: ctx,
        )
        monkeypatch.setattr(
            "services.papelaria_preview_service.build_proof_preview_pages_payload",
            lambda *a, **k: {
                "isPapelaria": True,
                "pages": [
                    {
                        "page": 1,
                        "url": "/api/client/proof/2026/5557/preview-pages/1.png?token=tok",
                    },
                    {
                        "page": 2,
                        "url": "/api/client/proof/2026/5557/preview-pages/2.png?token=tok",
                    },
                ],
                "total_pages": 2,
                "truncated": False,
                "mockupConfigJson": None,
                "produto": "Cartão",
                "arquivoModelo": "CtVisita.cdr",
                "frenteVerso": "Frente e Verso",
            },
        )

        payload = get_proof_preview_pages(2026, 5557, token="tok")
        assert payload["isPapelaria"] is True
        assert len(payload["pages"]) == 2
        assert payload["pages"][0]["page"] == 1

    def test_png_token_invalido(self, monkeypatch):
        from routers.proof_portal_routes import serve_proof_preview_page

        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: (_ for _ in ()).throw(
                HTTPException(status_code=403, detail="Token inválido ou expirado.")
            ),
        )
        with pytest.raises(HTTPException) as exc:
            serve_proof_preview_page(2026, 5557, 1, token="bad")
        assert exc.value.status_code == 403


class TestProofPreviewService:
    def test_ensure_proof_preview_pages_cria_png(self, tmp_path, monkeypatch):
        sefoc_base = tmp_path / "Sefoc"
        sefoc_base.mkdir()
        pdf_path = sefoc_base / "prova.pdf"
        _make_pdf(str(pdf_path), pages=2)
        cache_dir = sefoc_base / ".preview" / "proof_5"

        monkeypatch.setattr(
            "services.papelaria_preview_service._get_sefoc_base_for_os",
            lambda *_a, **_k: str(sefoc_base),
        )

        from services import papelaria_preview_service as preview_svc

        meta = preview_svc.ensure_proof_preview_pages(2026, 5557, 5, str(pdf_path))
        assert len(meta["pages"]) == 2
        assert (cache_dir / "page_1.png").is_file()
        assert (cache_dir / "page_2.png").is_file()

    def test_resolve_proof_preview_page_path_seguranca(self, tmp_path, monkeypatch):
        sefoc_base = tmp_path / "Sefoc"
        preview_dir = sefoc_base / ".preview" / "proof_3"
        preview_dir.mkdir(parents=True)
        png = preview_dir / "page_1.png"
        png.write_bytes(b"png")
        pdf_path = sefoc_base / "prova.pdf"
        _make_pdf(str(pdf_path), pages=1)

        monkeypatch.setattr(
            "services.papelaria_preview_service._get_sefoc_base_for_os",
            lambda *_a, **_k: str(sefoc_base),
        )
        monkeypatch.setattr(
            "services.papelaria_preview_service._render_pdf_pages",
            lambda *_a, **_k: [str(png)],
        )

        from services import papelaria_preview_service as preview_svc

        resolved = preview_svc.resolve_proof_preview_page_path(
            2026, 5557, 3, str(pdf_path), 1
        )
        assert os.path.isfile(resolved)

        with pytest.raises(FileNotFoundError):
            preview_svc.resolve_proof_preview_page_path(
                2026, 5557, 3, str(pdf_path), 9
            )
