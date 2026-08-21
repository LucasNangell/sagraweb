"""Testes — classificação prova vs problemas técnicos vs Timbrado Digital por andamento."""
from __future__ import annotations


class TestEmailDispatchTypeService:
    def test_is_pt_when_encam_follows_problemas_tecnicos(self, monkeypatch):
        from services import email_dispatch_type_service as svc

        monkeypatch.setattr(
            svc,
            "fetch_recent_andamentos",
            lambda os_id, ano, limit=5: [
                {"situacao": "Encam. de Docum.", "observacao": "Enviar PTV2"},
                {"situacao": "Problemas Técnicos", "observacao": ""},
            ],
        )

        assert svc.is_problema_tecnico_dispatch(100, 2026) is True
        assert svc.resolve_email_dispatch_type(100, 2026) == "pt"

    def test_is_proof_when_encam_not_after_problemas_tecnicos(self, monkeypatch):
        from services import email_dispatch_type_service as svc

        monkeypatch.setattr(
            svc,
            "fetch_recent_andamentos",
            lambda os_id, ano, limit=5: [
                {"situacao": "Encam. de Docum.", "observacao": "Enviar prova"},
                {"situacao": "Aguard. Aprovação", "observacao": ""},
            ],
        )
        monkeypatch.setattr(svc, "_has_pt_relatorio", lambda os_id, ano: False)

        assert svc.is_problema_tecnico_dispatch(100, 2026) is False
        assert svc.resolve_email_dispatch_type(100, 2026) == "proof"

    def test_relatorio_email_takes_priority_over_andamento(self, monkeypatch):
        from services import email_dispatch_type_service as svc

        monkeypatch.setattr(svc, "_has_pt_relatorio", lambda os_id, ano: True)
        monkeypatch.setattr(
            svc,
            "fetch_recent_andamentos",
            lambda os_id, ano, limit=5: [
                {"situacao": "Encam. de Docum.", "observacao": ""},
                {"situacao": "Aguard. Aprovação", "observacao": ""},
            ],
        )

        assert svc.resolve_email_dispatch_type(100, 2026) == "pt"

    def test_timbrado_digital_by_observation(self, monkeypatch):
        from services import email_dispatch_type_service as svc

        monkeypatch.setattr(svc, "_has_pt_relatorio", lambda os_id, ano: False)
        monkeypatch.setattr(
            svc,
            "fetch_recent_andamentos",
            lambda os_id, ano, limit=5: [
                {
                    "situacao": "Encam. de Docum.",
                    "observacao": "Enviar Timbrado Digital",
                },
            ],
        )

        assert svc.is_timbrado_digital_dispatch(5954, 2026) is True
        assert svc.resolve_email_dispatch_type(5954, 2026) == "timbrado_digital"

    def test_timbrado_obs_case_insensitive(self):
        from services.email_dispatch_type_service import is_timbrado_digital_obs

        assert is_timbrado_digital_obs("enviar TIMBRADO digital") is True
        assert is_timbrado_digital_obs("Enviar Prova 1") is False

    def test_enviar_prova_does_not_match_timbrado(self, monkeypatch):
        from services import email_dispatch_type_service as svc

        monkeypatch.setattr(svc, "_has_pt_relatorio", lambda os_id, ano: False)
        monkeypatch.setattr(
            svc,
            "fetch_recent_andamentos",
            lambda os_id, ano, limit=5: [
                {"situacao": "Encam. de Docum.", "observacao": "Enviar Prova 2"},
            ],
        )

        assert svc.is_timbrado_digital_dispatch(5954, 2026) is False
        assert svc.resolve_email_dispatch_type(5954, 2026) == "proof"

    def test_extract_pt_versao_from_obs(self):
        from services.email_dispatch_type_service import extract_pt_versao_from_obs

        assert extract_pt_versao_from_obs("Enviar PTV2") == "2"
        assert extract_pt_versao_from_obs("Enviar PTV1.1") == "1.1"


class TestGetPtHtmlDispatchType:
    def test_returns_pt_when_andamento_sequence_matches(self, monkeypatch):
        from routers import email_routes

        monkeypatch.setattr(
            email_routes.db,
            "execute_query",
            lambda sql, params=None: [],
        )
        monkeypatch.setattr(
            "services.email_dispatch_type_service.resolve_email_dispatch_type",
            lambda os_id, ano: "pt",
        )
        monkeypatch.setattr(
            email_routes,
            "_build_pt_html_preview_payload",
            lambda os_id, ano, **kwargs: {
                "html": "<p>PT</p>",
                "versao": "2",
                "data": "2026-06-09",
                "type": "pt",
                "send_mode": "portal",
                "use_inline_body": False,
                "template_model_id": 3,
            },
        )

        result = email_routes.get_pt_html(2026, 100)
        assert result["type"] == "pt"
        assert "PT" in result["html"]

    def test_returns_proof_when_not_pt_sequence(self, monkeypatch):
        from routers import email_routes

        monkeypatch.setattr(
            email_routes.db,
            "execute_query",
            lambda sql, params=None: [],
        )
        monkeypatch.setattr(
            "services.email_dispatch_type_service.resolve_email_dispatch_type",
            lambda os_id, ano: "proof",
        )
        monkeypatch.setattr(
            email_routes,
            "_build_proof_html_preview_payload",
            lambda os_id, ano, versao=None: {
                "html": "<html>prova ativa</html>",
                "versao": "1",
                "data": None,
                "type": "proof",
                "send_mode": "portal",
                "anexar_pdf": False,
                "template_model_id": 1,
            },
        )

        result = email_routes.get_pt_html(2026, 100)
        assert result["type"] == "proof"
        assert "prova ativa" in result["html"]

    def test_returns_timbrado_digital(self, monkeypatch):
        from routers import email_routes

        monkeypatch.setattr(
            email_routes.db,
            "execute_query",
            lambda sql, params=None: [],
        )
        monkeypatch.setattr(
            "services.email_dispatch_type_service.resolve_email_dispatch_type",
            lambda os_id, ano: "timbrado_digital",
        )
        monkeypatch.setattr(
            email_routes,
            "_build_timbrado_digital_html_preview_payload",
            lambda os_id, ano: {
                "html": "<p>Timbrado</p>",
                "type": "timbrado_digital",
                "send_mode": "anexo",
                "anexar_pdf": True,
                "timbrado_attachments": [
                    {"name": "x-TimbradoA4Digital-Cor.docx", "role": "cor"},
                    {"name": "x-TimbradoA4Digital-PB.docx", "role": "pb"},
                ],
            },
        )

        result = email_routes.get_pt_html(2026, 5954)
        assert result["type"] == "timbrado_digital"
        assert len(result["timbrado_attachments"]) == 2
