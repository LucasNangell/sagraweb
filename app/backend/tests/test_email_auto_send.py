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


def _mock_auto_send_claim(monkeypatch):
    import services.email_auto_send_claim as claim

    monkeypatch.setattr(claim, "find_current_encam_cod_status", lambda *_a, **_k: "001002026-01")
    monkeypatch.setattr(claim, "try_claim_auto_send", lambda **_k: True)
    monkeypatch.setattr(claim, "update_auto_send_claim", lambda *_a, **_k: None)
    monkeypatch.setattr(claim, "release_auto_send_claim", lambda *_a, **_k: None)


class TestMaybeAutoSendTypeGate:
    def test_ptv_requires_pt_dispatch(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl
        import services.email_dispatch_type_service as dtype

        _mock_auto_send_claim(monkeypatch)
        monkeypatch.setattr(
            tpl,
            "get_auto_send_settings",
            lambda: {"enabled_os": True, "enabled_sp": True, "ponto": "918713"},
        )
        monkeypatch.setattr(dtype, "resolve_email_dispatch_type", lambda *_a, **_k: "proof")

        result = svc.maybe_auto_send_after_encam(
            os_num=100,
            ano=2026,
            situacao="Encam. de Docum.",
            setor="SEFOC",
            observacao="Enviar PTV2",
            cod_status="001002026-01",
        )
        assert result is None

    def test_prova_requires_proof_dispatch(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl
        import services.email_dispatch_type_service as dtype

        _mock_auto_send_claim(monkeypatch)
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
            cod_status="001002026-01",
        )
        assert result is None

    def test_skip_without_recipients(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl
        import services.email_dispatch_type_service as dtype

        _mock_auto_send_claim(monkeypatch)
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
            cod_status="001002026-01",
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


class TestMysqlMonitorCycle:
    def test_monitor_attempts_unclaimed_encam(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl
        import services.email_auto_send_claim as claim

        monkeypatch.setattr(
            tpl,
            "get_auto_send_settings",
            lambda: {"enabled_os": True, "enabled_sp": True, "ponto": "918713"},
        )
        monkeypatch.setattr(
            svc,
            "list_mysql_encam_pendencias",
            lambda **_k: [
                {
                    "cod_status": "001002026-09",
                    "os": 100,
                    "ano": 2026,
                    "situacao": "Encam. de Docum.",
                    "setor": "SEFOC",
                    "observacao": "Enviar Prova 2",
                }
            ],
        )
        monkeypatch.setattr(claim, "is_auto_send_claimed", lambda *_a, **_k: False)
        calls = []

        def fake_maybe(**kwargs):
            calls.append(kwargs)
            return {"success": True}

        monkeypatch.setattr(svc, "maybe_auto_send_after_encam", fake_maybe)
        result = svc.run_auto_send_mysql_monitor_cycle()
        assert result["attempted"] == 1
        assert result["sent"] == 1
        assert calls[0]["cod_status"] == "001002026-09"

    def test_monitor_skips_already_claimed(self, monkeypatch):
        from services import email_auto_send_service as svc
        import services.email_template_service as tpl
        import services.email_auto_send_claim as claim

        monkeypatch.setattr(
            tpl,
            "get_auto_send_settings",
            lambda: {"enabled_os": True, "enabled_sp": True, "ponto": "918713"},
        )
        monkeypatch.setattr(
            svc,
            "list_mysql_encam_pendencias",
            lambda **_k: [
                {
                    "cod_status": "001002026-09",
                    "os": 100,
                    "ano": 2026,
                    "situacao": "Encam. de Docum.",
                    "setor": "SEFOC",
                    "observacao": "Enviar Prova 2",
                }
            ],
        )
        monkeypatch.setattr(claim, "is_auto_send_claimed", lambda *_a, **_k: True)
        called = {"n": 0}
        monkeypatch.setattr(
            svc,
            "maybe_auto_send_after_encam",
            lambda **_k: called.__setitem__("n", called["n"] + 1),
        )
        result = svc.run_auto_send_mysql_monitor_cycle()
        assert result["attempted"] == 0
        assert called["n"] == 0


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
