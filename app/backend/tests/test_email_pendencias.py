"""Pendências de e-mail — OS principal, Sub OS e Apogee."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


class TestEmailPendencias:
    def test_fetch_includes_main_and_sub_os_branches(self, monkeypatch):
        from services import email_pendencias_service as svc

        captured: dict = {}

        def fake_query(sql, params=None):
            captured["sql"] = sql
            captured["params"] = params
            return []

        monkeypatch.setattr(svc.db, "execute_query", fake_query)

        svc.fetch_email_pendencias("SEFOC")

        assert "UNION" in captured["sql"]
        assert "tab_os_sub_os" in captured["sql"]
        assert "tab_os_sub_os_andamento" in captured["sql"]
        assert "UltimoStatus = 1" in captured["sql"]
        assert captured["params"] == (
            "Encam. de Docum.",
            "SEFOC",
            "Encam. de Docum.",
            "SEFOC",
        )

    def test_count_uses_same_union_logic(self, monkeypatch):
        from services import email_pendencias_service as svc

        captured: dict = {}

        def fake_query(sql, params=None):
            captured["sql"] = sql
            return [{"count": 3}]

        monkeypatch.setattr(svc.db, "execute_query", fake_query)

        assert svc.count_email_pendencias("SEFOC") == 3
        assert "UNION" in captured["sql"]

    def test_merge_pendencias_lists_orders_db_before_apogee(self):
        from services.email_pendencias_service import merge_pendencias_lists

        db_items = [{"os": 100, "ano": 2026, "situacao": "Encam. de Docum."}]
        apogee_items = [
            {
                "os": 200,
                "ano": 2026,
                "source": "apogee",
                "email_entry_id": "msg-1",
            }
        ]

        merged = merge_pendencias_lists(db_items, apogee_items)

        assert len(merged) == 2
        assert merged[0]["source"] == "db"
        assert merged[1]["source"] == "apogee"
        assert merged[1]["email_entry_id"] == "msg-1"

    def test_count_all_email_pendencias_sums_sources(self, monkeypatch):
        from services import email_pendencias_service as svc

        monkeypatch.setattr(svc, "count_email_pendencias", lambda setor: 5)

        assert svc.count_all_email_pendencias("SEFOC", apogee_count=2) == 7

    def test_route_merges_db_and_apogee(self, monkeypatch):
        from routers import email_routes
        from security.session_auth import SessionData
        from services import email_pendencias_service

        monkeypatch.setattr(
            email_pendencias_service,
            "fetch_email_pendencias",
            lambda setor: [{"os": 5001, "ano": 2026}],
        )
        monkeypatch.setattr(
            "services.email_apogee_pendencias_service.fetch_apogee_email_pendencias",
            lambda service: [
                {
                    "os": 100,
                    "ano": 2026,
                    "source": "apogee",
                    "email_entry_id": "ews-id-1",
                }
            ],
        )
        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (MagicMock(), MagicMock()),
        )

        session = SessionData(
            ponto=918713,
            nome="Test",
            ip="127.0.0.1",
            iat=0,
        )
        result = email_routes.get_pendencias("SEFOC", session=session)

        assert len(result) == 2
        assert result[0]["source"] == "db"
        assert result[1]["source"] == "apogee"


class TestApogeeSubjectParse:
    @pytest.mark.parametrize(
        "subject,expected",
        [
            ("Prova 1234/26 aprovada", (1234, 2026)),
            ("OS 5678/2025 finalizada", (5678, 2025)),
            ("Re: 99 / 24", (99, 2024)),
            ("Sem referência de OS", None),
            ("", None),
        ],
    )
    def test_parse_os_ano_from_subject(self, subject, expected):
        from services.email_apogee_pendencias_service import parse_os_ano_from_subject

        assert parse_os_ano_from_subject(subject) == expected


class TestCleanApogeeEmailBody:
    @pytest.mark.parametrize(
        "body,subject,expected_fragment,excluded",
        [
            (
                "SUBJECT 1234/26 Prova aprovada\n\nConteúdo do e-mail.",
                "1234/26 Prova aprovada",
                "Conteúdo do e-mail",
                "SUBJECT",
            ),
            (
                "<html><body>SUBJECT: OS 100/26<br>Texto útil</body></html>",
                "OS 100/26",
                "Texto útil",
                "SUBJECT",
            ),
            (
                "<p>SUBJECT </p><p>Corpo após metadado</p>",
                None,
                "Corpo após metadado",
                "SUBJECT",
            ),
            (
                "BODY Olá, segue aprovação.",
                None,
                "Olá, segue aprovação",
                "BODY",
            ),
        ],
    )
    def test_strips_subject_and_body_labels(
        self, body, subject, expected_fragment, excluded
    ):
        from services.email_apogee_pendencias_service import clean_apogee_email_body

        cleaned = clean_apogee_email_body(body, subject)
        assert expected_fragment in cleaned
        assert excluded not in cleaned


class TestSendPtMarkReadAfterApogee:
    def test_send_pt_marks_source_email_when_entry_id_present(self, monkeypatch):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        marked: dict = {}

        class FakeEws:
            def find_folder_id(self, *_a, **_k):
                return None

            def send_email(self, **_kwargs):
                return None

            def mark_as_read_and_categorize(self, *, item_id, category_text):
                marked["item_id"] = item_id
                marked["category_text"] = category_text

        cfg = MagicMock()
        cfg.send_mailbox_os_lt_5000 = "sepim@test.local"

        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (FakeEws(), cfg),
        )
        monkeypatch.setattr(
            "services.email_dispatch_type_service.resolve_email_dispatch_type",
            lambda *_a, **_k: "pt",
        )
        monkeypatch.setattr(
            "services.email_template_model_service.resolve_pt_send_plan",
            lambda: {
                "grupo": "problema_tecnico",
                "variante": "portal",
                "model": {
                    "id": 1,
                    "grupo": "problema_tecnico",
                    "variante": "portal",
                    "assunto": "PT {{nr_os}}/{{ano}}",
                    "html": "<html><body>PT</body></html>",
                    "content_mode": "custom",
                    "ativo": True,
                },
                "use_inline_body": False,
                "legacy_fallback": False,
            },
        )
        monkeypatch.setattr(
            "services.email_template_model_service.render_pt_email",
            lambda *_a, **_k: ("Assunto PT", "<html><body>PT</body></html>"),
        )
        monkeypatch.setattr(
            "services.pt_report_html_service.embed_indication_images_for_email",
            lambda html: (html, []),
        )
        monkeypatch.setattr(
            "services.email_template_service.get_global_send_mailboxes",
            lambda: {"os_gte_5000": None, "os_lt_5000": None},
        )
        monkeypatch.setattr(
            "config_manager.config_manager.is_mdb_write_enabled",
            lambda: False,
        )
        monkeypatch.setattr(
            email_routes.db,
            "execute_query",
            lambda sql, params=None: (
                [{"RelatorioEmail": "", "RelatorioHTML": "", "Versao": "1"}]
                if "tabAnalises" in sql
                else [{"Titulo": "T", "TipoPublicacaoLink": "Cartaz"}]
                if "tabDetalhesServico" in sql
                else []
            ),
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
            type="pt",
            email_entry_id="ews-apogee-msg-99",
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        assert result["outlook_updated"] is True
        assert marked["item_id"] == "ews-apogee-msg-99"
        assert marked["category_text"] == "Pedido atendido (lido e proc.)"


class TestSendPtApogeeBody:
    def test_send_apogee_uses_original_body_not_system_template(self, monkeypatch):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        sent: dict = {}
        render_pt_called = {"value": False}

        class FakeEws:
            def find_folder_id(self, *_a, **_k):
                return None

            def send_email(self, **kwargs):
                sent.update(kwargs)

            def mark_as_read_and_categorize(self, **_kwargs):
                return None

        cfg = MagicMock()
        cfg.send_mailbox_os_lt_5000 = "sepim@test.local"

        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (FakeEws(), cfg),
        )
        monkeypatch.setattr(
            "services.email_template_service.get_global_send_mailboxes",
            lambda: {"os_gte_5000": None, "os_lt_5000": None},
        )
        monkeypatch.setattr(
            "config_manager.config_manager.is_mdb_write_enabled",
            lambda: False,
        )

        def fake_render_pt(*_a, **_k):
            render_pt_called["value"] = True
            return ("Template PT", "<html><body>template</body></html>")

        monkeypatch.setattr(
            "services.email_template_model_service.render_pt_email",
            fake_render_pt,
        )

        def fake_transaction(ops):
            cursor = MagicMock()
            cursor.fetchone.return_value = None
            return [ops[0](cursor)]

        monkeypatch.setattr(email_routes.db, "execute_transaction", fake_transaction)

        session = MagicMock()
        session.ponto = "918713"

        apogee_html = "<html><body><p>Corpo original Apogee</p></body></html>"
        req = EmailPTRequest(
            os=100,
            ano=2026,
            versao="1",
            to=["cliente@test.local"],
            ponto="918713",
            type="apogee",
            html=apogee_html,
            subject="Prova 100/26 aprovada",
            email_entry_id="ews-apogee-1",
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        assert render_pt_called["value"] is False
        assert sent["subject"] == "Prova 100/26 aprovada"
        assert "Corpo original Apogee" in (sent.get("html_body") or "")

    def test_send_apogee_prefers_ews_body_over_template(self, monkeypatch):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        sent: dict = {}
        render_pt_called = {"value": False}

        class FakeEws:
            def find_folder_id(self, *_a, **_k):
                return None

            def send_email(self, **kwargs):
                sent.update(kwargs)

            def get_message_details(self, item_id):
                return {
                    "body": "<html><body><p>Corpo EWS Apogee</p></body></html>",
                    "subject": "Assunto EWS Apogee",
                }

            def mark_as_read_and_categorize(self, **_kwargs):
                return None

        cfg = MagicMock()
        cfg.send_mailbox_os_lt_5000 = "sepim@test.local"

        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (FakeEws(), cfg),
        )
        monkeypatch.setattr(
            "services.email_template_service.get_global_send_mailboxes",
            lambda: {"os_gte_5000": None, "os_lt_5000": None},
        )
        monkeypatch.setattr(
            "config_manager.config_manager.is_mdb_write_enabled",
            lambda: False,
        )

        def fake_render_pt(*_a, **_k):
            render_pt_called["value"] = True
            return ("Template PT", "<html><body>template</body></html>")

        monkeypatch.setattr(
            "services.email_template_model_service.render_pt_email",
            fake_render_pt,
        )

        session = MagicMock()
        session.ponto = "918713"

        req = EmailPTRequest(
            os=100,
            ano=2026,
            versao="1",
            to=["cliente@test.local"],
            ponto="918713",
            type="pt",
            html="<html><body>fallback</body></html>",
            subject="fallback subject",
            email_entry_id="ews-apogee-1",
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        assert render_pt_called["value"] is False
        assert sent["subject"] == "Assunto EWS Apogee"
        assert "Corpo EWS Apogee" in (sent.get("html_body") or "")

    def test_send_apogee_strips_subject_line_from_body(self, monkeypatch):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        sent: dict = {}

        class FakeEws:
            def find_folder_id(self, *_a, **_k):
                return None

            def send_email(self, **kwargs):
                sent.update(kwargs)

            def get_message_details(self, item_id):
                return {
                    "body": "SUBJECT OS 100/26<br>Conteúdo real do Apogee",
                    "subject": "OS 100/26",
                }

            def mark_as_read_and_categorize(self, **_kwargs):
                return None

        cfg = MagicMock()
        cfg.send_mailbox_os_lt_5000 = "sepim@test.local"

        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (FakeEws(), cfg),
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
            versao="1",
            to=["cliente@test.local"],
            ponto="918713",
            type="apogee",
            email_entry_id="ews-apogee-1",
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        html = sent.get("html_body") or ""
        assert "Conteúdo real do Apogee" in html
        assert "SUBJECT" not in html


class TestApogeeAttachmentPayload:
    def test_build_attachment_payload_maps_inline_cids(self):
        from services.email_apogee_pendencias_service import _build_attachment_payload

        display, inline_map = _build_attachment_payload(
            [
                {
                    "name": "logo.png",
                    "is_inline": True,
                    "content_id": "<abc@local>",
                },
                {
                    "name": "doc.pdf",
                    "is_inline": False,
                },
            ]
        )

        assert len(display) == 1
        assert display[0]["name"] == "doc.pdf"
        assert inline_map.get("abc@local") == 1


class TestPendenciaAndamentoOptional:
    def test_send_pt_skips_andamento_by_default(self, monkeypatch):
        from routers import email_routes
        from routers.email_routes import EmailPTRequest, send_pt_email

        tx_calls = {"count": 0}

        class FakeEws:
            def find_folder_id(self, *_a, **_k):
                return None

            def send_email(self, **_kwargs):
                return None

        cfg = MagicMock()
        cfg.send_mailbox_os_lt_5000 = "sepim@test.local"

        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (FakeEws(), cfg),
        )
        monkeypatch.setattr(
            "services.email_dispatch_type_service.resolve_email_dispatch_type",
            lambda *_a, **_k: "pt",
        )
        monkeypatch.setattr(
            "services.email_template_model_service.resolve_pt_send_plan",
            lambda: {
                "grupo": "problema_tecnico",
                "variante": "portal",
                "model": {"id": 1, "ativo": True},
                "use_inline_body": False,
                "legacy_fallback": False,
            },
        )
        monkeypatch.setattr(
            "services.email_template_model_service.render_pt_email",
            lambda *_a, **_k: ("Assunto PT", "<html><body>PT</body></html>"),
        )
        monkeypatch.setattr(
            "services.pt_report_html_service.embed_indication_images_for_email",
            lambda html: (html, []),
        )
        monkeypatch.setattr(
            "services.email_template_service.get_global_send_mailboxes",
            lambda: {"os_gte_5000": None, "os_lt_5000": None},
        )
        monkeypatch.setattr(
            email_routes.db,
            "execute_query",
            lambda sql, params=None: (
                [{"RelatorioEmail": "", "RelatorioHTML": "", "Versao": "1"}]
                if "tabAnalises" in sql
                else [{"Titulo": "T", "TipoPublicacaoLink": "Cartaz"}]
                if "tabDetalhesServico" in sql
                else []
            ),
        )

        def fake_transaction(ops):
            tx_calls["count"] += 1
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
            type="pt",
        )

        result = send_pt_email(req, session)

        assert result["success"] is True
        assert tx_calls["count"] == 0

    def test_pendencia_andamento_endpoint_registers(self, monkeypatch):
        from routers import email_routes
        from routers.email_routes import PendenciaAndamentoRequest, register_pendencia_andamento
        from security.session_auth import SessionData

        tx_calls = {"count": 0}

        def fake_transaction(ops):
            tx_calls["count"] += 1
            cursor = MagicMock()
            cursor.fetchone.return_value = None
            return [ops[0](cursor)]

        monkeypatch.setattr(email_routes.db, "execute_transaction", fake_transaction)
        monkeypatch.setattr(
            "routers.realtime.broadcast_os_system_update",
            lambda *_a, **_k: None,
        )
        monkeypatch.setattr(
            "routers.mdb_writer.dispatch_mdb_sync",
            lambda *_a, **_k: None,
        )

        session = SessionData(
            ponto=918713,
            nome="Test",
            ip="127.0.0.1",
            iat=0,
        )
        req = PendenciaAndamentoRequest(
            os=100,
            ano=2026,
            versao="2",
            ponto="918713",
            type="pt",
        )

        result = register_pendencia_andamento(req, session=session)

        assert tx_calls["count"] == 1
        assert result["success"] is True
        assert result["situacao"] == "Pendência Usuário"


class TestPendenciaAndamentoMeta:
    def test_apogee_without_versao_omits_version_in_obs(self):
        from routers.email_routes import _pendencia_andamento_meta

        obs, situacao = _pendencia_andamento_meta("apogee", "")
        assert obs == "E-mail Apogee encaminhado"
        assert situacao == "Pendência Usuário"

    def test_apogee_with_versao_includes_version_in_obs(self):
        from routers.email_routes import _pendencia_andamento_meta

        obs, _ = _pendencia_andamento_meta("apogee", "3")
        assert obs == "E-mail Apogee v3 encaminhado"

    def test_proof_obs_lists_recipients(self):
        from routers.email_routes import _pendencia_andamento_meta

        obs, situacao = _pendencia_andamento_meta(
            "proof",
            "2",
            to=["a@mail.com", "b@mail.com"],
        )
        assert situacao == "Aguard. Aprovação"
        assert obs == (
            "P2 enviada para:\n"
            "- a@mail.com\n"
            "- b@mail.com"
        )

    def test_proof_obs_without_recipients(self):
        from routers.email_routes import _pendencia_andamento_meta

        obs, situacao = _pendencia_andamento_meta("proof", "1", to=[])
        assert situacao == "Aguard. Aprovação"
        assert obs == "P1 enviada para:\n- (sem destinatários)"

