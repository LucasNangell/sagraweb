"""Permissões e regras do serviço de mensagens de suporte."""
from __future__ import annotations

import pytest


class TestSupportMessagePermissions:
    def test_add_user_reply_rejects_other_ponto(self, monkeypatch):
        from services import support_message_service as svc

        monkeypatch.setattr(
            svc,
            "get_support_message",
            lambda message_id, with_thread=False: {
                "Id": message_id,
                "Ponto": "918713",
                "Status": "aberto",
            },
        )
        monkeypatch.setattr(svc, "ensure_support_messages_schema", lambda: None)

        with pytest.raises(PermissionError, match="não pertence"):
            svc.add_user_reply(
                message_id=1,
                ponto="111111",
                nome_usuario="Outro",
                mensagem="Tentativa indevida",
            )

    def test_add_user_reply_allows_owner_ponto(self, monkeypatch):
        from services import support_message_service as svc

        calls: list[str] = []

        def fake_insert(**kwargs):
            calls.append(kwargs["mensagem"])
            return {
                "Id": 99,
                "TicketId": 1,
                "AutorTipo": "usuario",
                "AutorPonto": kwargs["autor_ponto"],
                "AutorNome": kwargs["autor_nome"],
                "Mensagem": kwargs["mensagem"],
                "DataCriacao": "2026-06-09T12:00:00",
            }

        monkeypatch.setattr(svc, "ensure_support_messages_schema", lambda: None)
        monkeypatch.setattr(
            svc,
            "get_support_message",
            lambda message_id, with_thread=False: {
                "Id": message_id,
                "Ponto": "918713",
                "Status": "aberto",
                "Source": "interno",
            },
        )
        monkeypatch.setattr(svc, "_insert_thread_message", fake_insert)
        monkeypatch.setattr(svc, "_push_support_realtime", lambda **kwargs: None)
        monkeypatch.setattr(
            svc,
            "_notify_admin_support_message",
            lambda **kwargs: None,
        )

        result = svc.add_user_reply(
            message_id=1,
            ponto="918713",
            nome_usuario="Dono",
            mensagem="Minha resposta",
        )

        assert calls == ["Minha resposta"]
        assert result is not None
        assert result["Ponto"] == "918713"
