from unittest.mock import MagicMock, patch

from services.gravacao_externa_email_service import send_gravacao_notification_email
from services.email_presets import CONFIGURABLE_TEMPLATE_IDS


@patch("services.gravacao_externa_email_service._activation_from_mailbox")
@patch("services.gravacao_externa_email_service.EWSService")
@patch("services.gravacao_externa_email_service.get_rendered_html", return_value="<p>ok</p>")
@patch("services.gravacao_externa_email_service.get_rendered_subject", return_value="Assunto")
@patch(
    "services.gravacao_externa_email_service.get_gravacao_notification_settings",
    return_value={
        "encaminhada": {
            "enabled": True,
            "mode": "personalizado",
            "recipients": ["biro@camara.leg.br"],
        },
        "iniciada": {"enabled": True, "mode": "usuario", "recipients": []},
        "concluida": {
            "enabled": True,
            "mode": "personalizado",
            "recipients": ["Equipe@camara.leg.br", "equipe@camara.leg.br"],
        },
    },
)
@patch("services.gravacao_externa_email_service.db")
def test_gravacao_email_resolves_user_and_activation_sender(
    mock_db,
    _settings,
    _subject,
    _html,
    ews_cls,
    activation_from,
):
    mock_db.execute_query.return_value = [{"Email": "usuario@camara.leg.br"}]
    activation_from.return_value = "ativacao@camara.leg.br"
    sender = MagicMock()
    ews_cls.return_value = sender

    assert send_gravacao_notification_email(
        event="iniciada",
        ano=2026,
        os_id=100,
        target_ponto="918.713",
        target_nome="Usuário",
        operador_ponto="111.111",
    )

    sender.send_email.assert_called_once()
    assert sender.send_email.call_args.kwargs["to"] == ["usuario@camara.leg.br"]
    assert sender.send_email.call_args.kwargs["from_mailbox"] == "ativacao@camara.leg.br"


def test_gravacao_templates_are_configurable():
    assert "gravacao_encaminhada" in CONFIGURABLE_TEMPLATE_IDS
    assert "gravacao_iniciada" in CONFIGURABLE_TEMPLATE_IDS
    assert "gravacao_concluida" in CONFIGURABLE_TEMPLATE_IDS


def test_gravacao_notification_config_accepts_legacy_two_event_payload():
    from routers.admin_system_routes import GravacaoNotificationSettingsRequest

    config = GravacaoNotificationSettingsRequest.model_validate(
        {
            "iniciada": {"mode": "usuario", "recipients": []},
            "concluida": {"mode": "usuario", "recipients": []},
        }
    )
    assert config.encaminhada.mode == "usuario"
    assert config.encaminhada.enabled is True


@patch("services.gravacao_externa_email_service.EWSService")
@patch(
    "services.gravacao_externa_email_service.get_gravacao_notification_settings",
    return_value={
        "encaminhada": {"enabled": True, "mode": "usuario", "recipients": []},
        "iniciada": {"enabled": False, "mode": "usuario", "recipients": []},
        "concluida": {"enabled": True, "mode": "usuario", "recipients": []},
    },
)
def test_gravacao_email_skips_when_disabled(_settings, ews_cls):
    assert (
        send_gravacao_notification_email(
            event="iniciada",
            ano=2026,
            os_id=100,
            target_ponto="918713",
            target_nome="Usuário",
            operador_ponto="111111",
        )
        is False
    )
    ews_cls.assert_not_called()


@patch("services.gravacao_externa_email_service._activation_from_mailbox")
@patch("services.gravacao_externa_email_service.EWSService")
@patch("services.gravacao_externa_email_service.get_rendered_html", return_value="<p>ok</p>")
@patch("services.gravacao_externa_email_service.get_rendered_subject", return_value="Assunto")
@patch(
    "services.gravacao_externa_email_service.get_gravacao_notification_settings",
    return_value={
        "encaminhada": {
            "enabled": True,
            "mode": "personalizado",
            "recipients": ["biro@camara.leg.br"],
        },
        "iniciada": {"enabled": True, "mode": "usuario", "recipients": []},
        "concluida": {
            "enabled": True,
            "mode": "personalizado",
            "recipients": ["Equipe@camara.leg.br", "equipe@camara.leg.br"],
        },
    },
)
def test_gravacao_email_uses_distinct_custom_recipients(
    _settings,
    _subject,
    _html,
    ews_cls,
    activation_from,
):
    activation_from.return_value = "ativacao@camara.leg.br"
    sender = MagicMock()
    ews_cls.return_value = sender

    assert send_gravacao_notification_email(
        event="concluida",
        ano=2026,
        os_id=100,
        target_ponto="918713",
        target_nome="Usuário",
        operador_ponto="111111",
    )

    assert sender.send_email.call_args.kwargs["to"] == ["equipe@camara.leg.br"]
