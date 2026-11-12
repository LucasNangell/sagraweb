"""Testes do envio automático após Encam. de Docum."""
from __future__ import annotations

from services.email_auto_send_service import (
    extract_emails_simple,
    extract_pontos_simple,
    is_os_enabled_for_auto_send,
    parse_encam_send_obs,
)


class TestParseEncamSendObs:
    def test_enviar_prova_n(self):
        parsed = parse_encam_send_obs("Enviar Prova 2")
        assert parsed is not None
        assert parsed.kind == "prova"
        assert parsed.versao == "2"

    def test_enviar_p_n(self):
        parsed = parse_encam_send_obs("Enviar p3")
        assert parsed is not None
        assert parsed.kind == "prova"
        assert parsed.versao == "3"

    def test_enviar_p_with_space(self):
        parsed = parse_encam_send_obs("Enviar P 4")
        assert parsed is not None
        assert parsed.kind == "prova"
        assert parsed.versao == "4"

    def test_enviar_ptv(self):
        parsed = parse_encam_send_obs("Enviar PTV2")
        assert parsed is not None
        assert parsed.kind == "pt"
        assert parsed.versao == "2"

    def test_enviar_ptv_with_space(self):
        parsed = parse_encam_send_obs("Enviar PTV 1.1")
        assert parsed is not None
        assert parsed.kind == "pt"
        assert parsed.versao == "1.1"

    def test_with_hora_prefix(self):
        parsed = parse_encam_send_obs("14h26\nEnviar Prova 5")
        assert parsed is not None
        assert parsed.kind == "prova"
        assert parsed.versao == "5"

    def test_timbrado_not_matched(self):
        assert parse_encam_send_obs("Enviar Timbrado Digital") is None

    def test_free_text_not_matched(self):
        assert parse_encam_send_obs("Encaminhar documentos ao SEFOC") is None


class TestAutoSendGates:
    def test_os_sp_toggles(self):
        assert is_os_enabled_for_auto_send(100, enabled_os=True, enabled_sp=False) is True
        assert is_os_enabled_for_auto_send(100, enabled_os=False, enabled_sp=True) is False
        assert is_os_enabled_for_auto_send(5000, enabled_os=False, enabled_sp=True) is True
        assert is_os_enabled_for_auto_send(5123, enabled_os=True, enabled_sp=False) is False


class TestRecipientHelpers:
    def test_extract_emails(self):
        text = "Contato: ana@camara.leg.br; bob@example.com"
        assert extract_emails_simple(text) == [
            "ana@camara.leg.br",
            "bob@example.com",
        ]

    def test_extract_pontos(self):
        assert extract_pontos_simple("P_918713 e p_12345") == ["P_918713", "P_12345"]


class TestMaybeAutoSendTypeGate:
    def test_ptv_requires_pt_dispatch(self, monkeypatch):
        from services import email_auto_send_service as svc

        monkeypatch.setattr(
            svc,
            "get_auto_send_settings",
            lambda: {"enabled_os": True, "enabled_sp": True, "ponto": "918713"},
            raising=False,
        )

        # Patch via module used inside maybe_auto_send
        import services.email_template_service as tpl

        monkeypatch.setattr(
            tpl,
            "get_auto_send_settings",
            lambda: {"enabled_os": True, "enabled_sp": True, "ponto": "918713"},
        )

        import services.email_dispatch_type_service as dtype

        monkeypatch.setattr(dtype, "resolve_email_dispatch_type", lambda *_a, **_k: "proof")

        result = svc.maybe_auto_send_after_encam(
            os_num=100,
            ano=2026,
            situacao="Encam. de Docum.",
            setor="SEFOC",
            observacao="Enviar PTV2",
        )
        assert result is None

    def test_prova_requires_proof_dispatch(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl
        import services.email_dispatch_type_service as dtype

        monkeypatch.setattr(
            tpl,
            "get_auto_send_settings",
            lambda: {"enabled_os": True, "enabled_sp": True, "ponto": "918713"},
        )
        monkeypatch.setattr(dtype, "resolve_email_dispatch_type", lambda *_a, **_k: "pt")

        result = svc.maybe_auto_send_after_encam(
            os_num=100,
            ano=2026,
            situacao="Encam. de Docum.",
            setor="SEFOC",
            observacao="Enviar Prova 2",
        )
        assert result is None

    def test_skip_without_recipients(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl
        import services.email_dispatch_type_service as dtype

        monkeypatch.setattr(
            tpl,
            "get_auto_send_settings",
            lambda: {"enabled_os": True, "enabled_sp": True, "ponto": "918713"},
        )
        monkeypatch.setattr(dtype, "resolve_email_dispatch_type", lambda *_a, **_k: "proof")
        monkeypatch.setattr(svc, "resolve_pendencia_recipients", lambda *_a, **_k: [])

        result = svc.maybe_auto_send_after_encam(
            os_num=100,
            ano=2026,
            situacao="Encam. de Docum.",
            setor="SEFOC",
            observacao="Enviar Prova 1",
        )
        assert result is None

    def test_skip_when_disabled(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl

        monkeypatch.setattr(
            tpl,
            "get_auto_send_settings",
            lambda: {"enabled_os": False, "enabled_sp": False, "ponto": "918713"},
        )
        result = svc.maybe_auto_send_after_encam(
            os_num=100,
            ano=2026,
            situacao="Encam. de Docum.",
            setor="SEFOC",
            observacao="Enviar Prova 1",
        )
        assert result is None


class TestAutoSendSettings:
    def test_defaults_and_validation(self, monkeypatch):
        from services import email_template_service as svc

        store: dict = {"templates": {}}

        def fake_load():
            return dict(store)

        def fake_save(data):
            store.clear()
            store.update(data)

        monkeypatch.setattr(svc, "_load_raw", fake_load)
        monkeypatch.setattr(svc, "_save_raw", fake_save)

        assert svc.get_auto_send_settings() == {
            "enabled_os": False,
            "enabled_sp": False,
            "ponto": "",
        }

        raised = False
        try:
            svc.save_auto_send_settings(enabled_os=True, enabled_sp=False, ponto="")
        except ValueError:
            raised = True
        assert raised

        saved = svc.save_auto_send_settings(
            enabled_os=True,
            enabled_sp=False,
            ponto="918713",
        )
        assert saved["enabled_os"] is True
        assert saved["ponto"] == "918713"
