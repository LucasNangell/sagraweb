"""OS/Ano extraídos da caixa de entrada para o painel/setor."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from security.session_auth import SessionData
from services.email_inbox_os_service import collect_inbox_os_refs, fetch_inbox_os_refs


class TestCollectInboxOsRefs:
    def test_parses_and_skips_invalid_subjects(self):
        refs = collect_inbox_os_refs(
            [
                {"subject": "Prova OS 1396/26", "date": "2026-10-22T10:00:00Z"},
                {"subject": "Sem referência de OS", "date": "2026-10-22T11:00:00Z"},
                {"subject": "OS 1396/216 andamento", "date": "2026-10-22T12:00:00Z"},
                {"subject": "", "date": "2026-10-22T13:00:00Z"},
            ]
        )
        assert refs == [{"os": 1396, "ano": 2026, "date": "2026-10-22T10:00:00Z"}]

    def test_dedupes_same_os_keeping_newest_date(self):
        refs = collect_inbox_os_refs(
            [
                {"subject": "OS 100/26 prova", "date": "2026-10-21T08:00:00Z"},
                {"subject": "Re: 100 / 2026", "date": "2026-10-22T09:30:00Z"},
                {"subject": "OS 200/26", "date": "2026-10-22T07:00:00Z"},
            ]
        )
        assert refs == [
            {"os": 100, "ano": 2026, "date": "2026-10-22T09:30:00Z"},
            {"os": 200, "ano": 2026, "date": "2026-10-22T07:00:00Z"},
        ]


class TestFetchInboxOsRefs:
    def test_uses_find_unread_without_message_details(self):
        service = MagicMock()
        service.find_folder_id.return_value = "folder-id"
        service.find_unread_messages.return_value = [
            {"subject": "OS 447/2026 prova", "date": "2026-10-22T15:00:00Z"},
            {"subject": "Comunicado interno", "date": "2026-10-22T16:00:00Z"},
        ]
        cfg = SimpleNamespace(
            max_items_per_folder=20,
            monitored_targets=[
                {
                    "mailbox": "sepim.deapa@camara.leg.br",
                    "folders": [{"id": "folder-id", "name": "Entrada de Provas"}],
                }
            ],
        )

        refs = fetch_inbox_os_refs(service, cfg)

        assert refs == [{"os": 447, "ano": 2026, "date": "2026-10-22T15:00:00Z"}]
        service.find_unread_messages.assert_called_once()
        service.get_message_details.assert_not_called()

    def test_folder_error_does_not_abort_other_folders(self):
        service = MagicMock()
        service.find_folder_id.side_effect = ["ok-id"]
        service.find_unread_messages.side_effect = [
            RuntimeError("pasta indisponível"),
            [{"subject": "OS 12/26", "date": "2026-10-22T10:00:00Z"}],
        ]
        cfg = SimpleNamespace(
            max_items_per_folder=10,
            monitored_targets=[
                {
                    "mailbox": "sepim.deapa@camara.leg.br",
                    "folders": [
                        {"id": "bad-id", "name": "Entrada de Provas"},
                        {"id": "ok-id", "name": "Entrada de Prob. Tec."},
                    ],
                }
            ],
        )

        refs = fetch_inbox_os_refs(service, cfg)

        assert refs == [{"os": 12, "ano": 2026, "date": "2026-10-22T10:00:00Z"}]


class TestInboxOsRoute:
    def test_returns_empty_list_on_ews_failure(self, monkeypatch):
        from routers import email_routes

        monkeypatch.setattr(
            email_routes,
            "_resolve_ews_for_ponto",
            lambda _p: (_ for _ in ()).throw(RuntimeError("ews down")),
        )
        session = SessionData(ponto=918713, nome="Test", ip="127.0.0.1", iat=0)

        assert email_routes.get_email_inbox_os(session=session) == []
