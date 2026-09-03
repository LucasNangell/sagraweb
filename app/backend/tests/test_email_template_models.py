"""Testes — modelos de e-mail múltiplos e resolução de envio."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


class TestRenderEmailModel:
    def test_substitutes_texto_aqui(self):
        from services.email_template_model_service import render_email_model

        model = {
            "grupo": "problema_tecnico",
            "variante": "sem_portal",
            "assunto": "PT OS {{nr_os}}/{{ano}}",
            "html": "<html><body>{TEXTO_AQUI}</body></html>",
            "content_mode": "custom",
        }
        subject, html = render_email_model(
            model,
            {"nr_os": "100", "ano": "2026"},
            inner_html="<p>Item 1</p>",
        )
        assert "Item 1" in html
        assert "{TEXTO_AQUI}" not in html
        assert "100" in subject

    def test_legacy_conteudo_alias(self):
        from services.email_template_model_service import render_email_model

        model = {
            "grupo": "problema_tecnico",
            "variante": "portal",
            "assunto": "Teste",
            "html": "<html>{{conteudo}}</html>",
            "content_mode": "custom",
        }
        _, html = render_email_model(
            model,
            {"nr_os": "1", "ano": "2026"},
            inner_html="<b>corpo</b>",
        )
        assert "corpo" in html
        assert "{{conteudo}}" not in html

    def test_prefers_stored_html_over_preset_mode(self):
        from services.email_template_model_service import render_email_model

        model = {
            "grupo": "prova_sp",
            "variante": "portal",
            "assunto": "Prova {{nr_os}}",
            "html": "<html><body>HTML editado no modelo ativo</body></html>",
            "content_mode": "preset",
            "preset_id": "upload_antigo",
            "legacy_template_id": "proof_sp",
        }
        _, html = render_email_model(model, {"nr_os": "5001", "ano": "2026", "link": "https://x"})
        assert "HTML editado no modelo ativo" in html


class TestRenderProofEmail:
    def test_uses_active_model_not_legacy(self, monkeypatch):
        from services import email_template_model_service as svc

        active_model = {
            "id": 9,
            "grupo": "prova_sp",
            "variante": "portal",
            "assunto": "Prova SP {{nr_os}}",
            "html": "<html><body>Modelo SP ativo {{link}}</body></html>",
            "content_mode": "custom",
            "legacy_template_id": "proof_sp",
        }
        plan = {
            "grupo": "prova_sp",
            "model": active_model,
            "use_attachment": False,
            "legacy_fallback": False,
        }
        _, html = svc.render_proof_email(
            5001,
            {"nr_os": 5001, "ano": 2026, "link": "https://portal/prova"},
            proof_link="https://portal/prova",
            plan=plan,
        )
        assert "Modelo SP ativo" in html
        assert "https://portal/prova" in html


class TestResolveProofSendPlan:
    def test_defaults_to_portal_when_only_portal_active(self, monkeypatch):
        from services import email_template_model_service as svc

        monkeypatch.setattr(
            svc,
            "resolve_active_email_template_for_grupo",
            lambda grupo: {
                "id": 1,
                "ativo": True,
                "anexar_pdf": False,
                "variante": "portal",
            },
        )
        plan = svc.resolve_proof_send_plan(100)
        assert plan["use_attachment"] is False
        assert plan["variante"] == "portal"

    def test_uses_attachment_when_sem_portal_active(self, monkeypatch):
        from services import email_template_model_service as svc

        monkeypatch.setattr(
            svc,
            "resolve_active_email_template_for_grupo",
            lambda grupo: {
                "id": 2,
                "ativo": True,
                "anexar_pdf": True,
                "variante": "sem_portal",
            },
        )
        plan = svc.resolve_proof_send_plan(100)
        assert plan["use_attachment"] is True
        assert plan["variante"] == "sem_portal"

    def test_uses_prova_web_preference_when_active(self, monkeypatch):
        from services import email_template_model_service as svc

        monkeypatch.setattr(
            svc,
            "resolve_active_email_template_for_grupo",
            lambda grupo: {
                "id": 3,
                "ativo": True,
                "anexar_pdf": False,
                "preferir_prova_web": True,
                "variante": "portal",
            },
        )
        plan = svc.resolve_proof_send_plan(100)
        assert plan["use_attachment"] is False
        assert plan["prefer_prova_web"] is True
        assert plan["variante"] == "portal"


class TestProofEmailPreview:
    def test_prefer_prova_web_falls_back_to_portal_when_not_ready(self, monkeypatch):
        from routers import email_routes
        from services import email_template_model_service as svc

        monkeypatch.setattr(
            svc,
            "resolve_proof_send_plan",
            lambda _os: {
                "grupo": "prova_os",
                "variante": "portal",
                "model": {
                    "id": 10,
                    "grupo": "prova_os",
                    "variante": "portal",
                    "assunto": "Prova {{nr_os}}",
                    "html": '<html><body><a href="{{link}}">Abrir prova</a></body></html>',
                    "content_mode": "custom",
                    "preferir_prova_web": True,
                    "anexar_pdf": False,
                    "ativo": True,
                },
                "use_attachment": False,
                "prefer_prova_web": True,
                "legacy_fallback": False,
            },
        )
        monkeypatch.setattr(svc, "has_prova_web_ready_for_send", lambda *_a, **_k: (False, ""))
        monkeypatch.setattr(
            "services.activation_email_service.resolve_link_web_base",
            lambda: "http://test.local",
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

        payload = email_routes._build_proof_html_preview_payload(100, 2026)

        assert payload["send_mode"] == "portal"
        assert "/portal/prova/preview" in payload["html"]
        assert "prova-web-preview" not in payload["html"]


class TestActivateExclusivePerGrupo:
    def test_activate_deactivates_other_variants_in_same_grupo(self, monkeypatch):
        from services import email_template_model_service as svc

        executed: list = []

        def fake_transaction(ops):
            cursor = type("C", (), {})()
            cursor.execute = lambda sql, params=None: executed.append((sql, params))
            ops[0](cursor)
            return [None]

        monkeypatch.setattr(svc.db, "execute_transaction", fake_transaction)
        monkeypatch.setattr(
            svc,
            "get_email_template_model",
            lambda mid: {
                "id": mid,
                "grupo": "prova_os",
                "variante": "sem_portal",
            },
        )

        svc.activate_email_template_model(5, updated_by_ponto="test")

        deactivate_sql, deactivate_params = executed[0]
        assert "Variante" not in deactivate_sql
        assert deactivate_params == ("prova_os", 5)


class TestSendProofWithAttachment:
    def test_proof_send_uses_prova_web_link_when_preferred(self, monkeypatch):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        sent: dict = {}

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
            lambda *_a, **_k: pytest.fail("Não deveria resolver PDF com Prova WEB disponível"),
        )
        monkeypatch.setattr(
            "services.email_template_model_service.resolve_proof_send_plan",
            lambda _os: {
                "grupo": "prova_os",
                "variante": "portal",
                "model": {
                    "id": 10,
                    "grupo": "prova_os",
                    "variante": "portal",
                    "assunto": "Prova {{nr_os}}",
                    "html": '<html><body><a href="{{link}}">Prova WEB</a></body></html>',
                    "content_mode": "custom",
                    "preferir_prova_web": True,
                    "anexar_pdf": False,
                    "ativo": True,
                },
                "use_attachment": False,
                "prefer_prova_web": True,
                "legacy_fallback": False,
            },
        )
        monkeypatch.setattr(
            "services.email_template_model_service.resolve_prova_web_link_for_send",
            lambda *_a, **_k: (
                "http://test/portal/aprovacao/web-token?os=100&ano=2026",
                "2",
            ),
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
            "services.email_template_service.get_global_send_mailboxes",
            lambda: {"os_gte_5000": None, "os_lt_5000": None},
        )
        monkeypatch.setattr(
            "config_manager.config_manager.is_mdb_write_enabled",
            lambda: False,
        )

        session = MagicMock()
        session.ponto = "918713"

        req = EmailPTRequest(
            os=100,
            ano=2026,
            to=["cliente@test.local"],
            ponto="918713",
            type="proof",
            register_andamento=False,
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        assert result["attachments"] == []
        assert result["proof_file"] is None
        assert sent.get("attachments") == []
        assert "portal/aprovacao/web-token" in (sent.get("html_body") or "")

    def test_proof_send_attaches_pdf_when_plan_requires(self, monkeypatch, tmp_path):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        pdf = tmp_path / "prova.pdf"
        pdf.write_bytes(b"%PDF-1.4 test content")

        sent: dict = {}

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
            "services.proof_files_service.validate_proof_pdf_size",
            lambda *_a, **_k: None,
        )
        monkeypatch.setattr(
            "services.email_template_model_service.resolve_proof_send_plan",
            lambda _os: {
                "grupo": "prova_os",
                "variante": "sem_portal",
                "model": {
                    "id": 9,
                    "grupo": "prova_os",
                    "variante": "sem_portal",
                    "assunto": "Prova {{nr_os}}",
                    "html": "<html><body>Anexo</body></html>",
                    "content_mode": "custom",
                    "anexar_pdf": True,
                    "ativo": True,
                },
                "use_attachment": True,
                "legacy_fallback": False,
            },
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
            return [ops[0](cursor)]

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
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        assert result["attachments"] == ["prova.pdf"]
        assert sent.get("attachments")
        assert len(sent["attachments"]) == 1
        assert "portal/aprovacao" not in (sent.get("html_body") or "")


class TestRenderPtEmailActiveModel:
    def test_inline_model_ignores_cached_portal_relatorio_email(self, monkeypatch):
        from services import email_template_model_service as svc

        portal_cached = (
            "<html><body>Acesse o link a seguir para visualizar os comentários.</body></html>"
        )
        inner_html = "<div>Item PT inline</div>"

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"RelatorioEmail": portal_cached, "RelatorioHTML": inner_html}]
                if "tabAnalises" in sql
                else []
            ),
        )
        monkeypatch.setattr(
            svc,
            "load_or_build_pt_inner_html",
            lambda *_a, **_k: inner_html,
        )

        inline_model = {
            "id": 12,
            "grupo": "problema_tecnico",
            "variante": "sem_portal",
            "assunto": "PT {{nr_os}}/{{ano}}",
            "html": "<html><body>{TEXTO_AQUI}</body></html>",
            "content_mode": "custom",
            "ativo": True,
        }
        plan = {
            "grupo": "problema_tecnico",
            "variante": "sem_portal",
            "model": inline_model,
            "use_inline_body": True,
            "legacy_fallback": False,
        }

        _, html = svc.render_pt_email(
            2025,
            2041,
            {"nr_os": 2041, "ano": 2025, "versao": "1"},
            plan=plan,
        )

        assert "Item PT inline" in html
        assert "Acesse o link a seguir" not in html

    def test_portal_model_uses_active_template_not_cached_email(self, monkeypatch):
        from services import email_template_model_service as svc

        monkeypatch.setattr(
            svc.db,
            "execute_query",
            lambda sql, params=None: (
                [{"RelatorioEmail": "<html>cache antigo</html>", "RelatorioHTML": "<p>inner</p>"}]
                if "tabAnalises" in sql
                else []
            ),
        )
        monkeypatch.setattr(
            svc,
            "resolve_pt_portal_link",
            lambda *_a, **_k: "https://example.test/portal/pt/token?os=1&ano=2025",
        )

        portal_model = {
            "id": 11,
            "grupo": "problema_tecnico",
            "variante": "portal",
            "assunto": "PT portal",
            "html": '<html><body><a href="{{link}}">Ver relatório</a></body></html>',
            "content_mode": "custom",
            "ativo": True,
        }
        plan = {
            "grupo": "problema_tecnico",
            "variante": "portal",
            "model": portal_model,
            "use_inline_body": False,
            "legacy_fallback": False,
        }

        _, html = svc.render_pt_email(
            2025,
            2041,
            {"nr_os": 2041, "ano": 2025, "versao": "1"},
            plan=plan,
        )

        assert "https://example.test/portal/pt/token" in html
        assert "cache antigo" not in html


class TestProofPdfValidation:
    def test_validate_proof_pdf_size_blocks_large_file(self, monkeypatch, tmp_path):
        from services.proof_files_service import validate_proof_pdf_size
        from fastapi import HTTPException

        big = tmp_path / "big.pdf"
        big.write_bytes(b"x" * (51 * 1024 * 1024))
        monkeypatch.setenv("SAGRA_EMAIL_ATTACHMENT_MAX_MB", "50")
        with pytest.raises(HTTPException) as exc:
            validate_proof_pdf_size(str(big))
        assert exc.value.status_code == 400
