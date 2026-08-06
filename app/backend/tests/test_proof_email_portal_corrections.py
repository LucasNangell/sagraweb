"""Correções — e-mail de prova sem anexo, PDF inline e portal do cliente."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


class TestClassifyProofPendencia:
    def test_aguard_aprovacao_situacao(self):
        from routers.cliente_gabinete_routes import _classify_pendencia

        assert _classify_pendencia("Aguard. Aprovação", "") == "aprovacao_prova"

    def test_legacy_proof_observacao(self):
        from routers.cliente_gabinete_routes import _classify_pendencia

        obs = "Prova v1 enviada por e-mail — arquivo: prova.pdf"
        assert _classify_pendencia("Pendência Usuário", obs) == "aprovacao_prova"

    def test_pt_not_classified_as_proof(self):
        from routers.cliente_gabinete_routes import _classify_pendencia

        assert _classify_pendencia("Pendência Usuário", "PTV2 enviado") == "problema_tecnico"


class TestServeProofPdfHeaders:
    def test_inline_content_disposition(self, monkeypatch, tmp_path):
        from routers.proof_portal_routes import serve_proof_pdf

        pdf = tmp_path / "prova.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")

        monkeypatch.setattr(
            "routers.proof_portal_routes._validate_proof_token",
            lambda *_a, **_k: {"ArquivoProva": "prova.pdf"},
        )
        monkeypatch.setattr(
            "routers.proof_portal_routes.resolve_proof_pdf_for_token_row",
            lambda *_a, **_k: (str(pdf), "prova.pdf"),
        )

        response = serve_proof_pdf(2026, 100, token="valid-token")
        assert response.media_type == "application/pdf"
        disposition = response.headers.get("content-disposition", "").lower()
        assert "inline" in disposition
        assert "attachment" not in disposition
        assert "prova.pdf" in disposition

    def test_rejects_invalid_token(self, monkeypatch):
        from routers.proof_portal_routes import serve_proof_pdf

        def boom(*_a, **_k):
            raise HTTPException(status_code=403, detail="Token inválido ou expirado.")

        monkeypatch.setattr("routers.proof_portal_routes._validate_proof_token", boom)

        with pytest.raises(HTTPException) as exc:
            serve_proof_pdf(2026, 100, token="bad")
        assert exc.value.status_code == 403


class TestSendProofEmailWithoutAttachment:
    def test_proof_send_skips_pdf_attachment(self, monkeypatch, tmp_path):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        pdf = tmp_path / "prova.pdf"
        pdf.write_bytes(b"%PDF")

        sent: dict = {}
        captured_andamento: dict = {}

        class FakeEws:
            def find_folder_id(self, *_a, **_k):
                return None

            def send_email(self, **kwargs):
                sent.update(kwargs)

        cfg = MagicMock()
        cfg.send_mailbox_os_lt_5000 = "sepim@test.local"

        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (FakeEws(), cfg),
        )
        monkeypatch.setattr(
            "services.proof_files_service.resolve_proof_pdf_path",
            lambda *_a, **_k: str(pdf),
        )
        monkeypatch.setattr(
            "routers.proof_portal_routes.ensure_proof_token",
            lambda *_a, **_k: "proof-token-abc",
        )
        monkeypatch.setattr(
            "routers.proof_portal_routes.build_proof_portal_url",
            lambda os_id, ano, token: f"http://test/portal/aprovacao/{token}?os={os_id}&ano={ano}",
        )
        monkeypatch.setattr(
            email_routes.db,
            "execute_query",
            lambda sql, params=None: (
                [{"solicitante": "Dep", "produto": "Cartaz"}]
                if "tabProtocolos" in sql
                else []
            ),
        )
        monkeypatch.setattr(
            "services.email_template_model_service.resolve_proof_send_plan",
            lambda _os: {
                "grupo": "prova_os",
                "variante": "portal",
                "model": None,
                "use_attachment": False,
                "legacy_fallback": True,
            },
        )
        monkeypatch.setattr(
            "services.email_template_model_service.render_proof_email",
            lambda *_a, **_k: (
                "Assunto prova",
                '<a href="http://test/portal/aprovacao/proof-token-abc?os=100&ano=2026">link</a>',
            ),
        )
        monkeypatch.setattr(
            "services.email_template_service.get_global_send_mailboxes",
            lambda: {"os_gte_5000": None, "os_lt_5000": None},
        )
        monkeypatch.setattr(
            "config_manager.config_manager.is_mdb_write_enabled",
            lambda: False,
        )

        def fake_transaction(ops):
            cursor = MagicMock()
            cursor.fetchone.return_value = None
            result = ops[0](cursor)
            captured_andamento.update(result)
            return [result]

        monkeypatch.setattr(email_routes.db, "execute_transaction", fake_transaction)

        session = MagicMock()
        session.ponto = "918713"

        req = EmailPTRequest(
            os=100,
            ano=2026,
            versao="1",
            to=["cliente@test.local"],
            ponto="918713",
            type="proof",
            proof_filename="prova.pdf",
            register_andamento=True,
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        assert result["attachments"] == []
        assert result["proof_file"] == "prova.pdf"
        assert sent.get("attachments") == []
        assert "portal/aprovacao/proof-token-abc" in sent.get("html_body", "")
        assert captured_andamento.get("situacao") == "Aguard. Aprovação"
        assert "P1 enviada para:" in (captured_andamento.get("obs") or "")
        assert "cliente@test.local" in (captured_andamento.get("obs") or "")
