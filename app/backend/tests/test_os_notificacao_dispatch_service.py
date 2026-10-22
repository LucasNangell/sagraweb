from unittest.mock import patch

from services.os_notificacao_dispatch_service import (
    dispatch_andamento_notifications,
    dispatch_os_change_notifications,
    is_error_situation,
    _os_url,
)


def test_is_error_situation_classifies_only_failures():
    assert is_error_situation("Problema Técnico")
    assert is_error_situation("Falha na gravação")
    assert is_error_situation("Cancelada")
    assert not is_error_situation("Entregue")
    assert not is_error_situation("Saída p/")
    assert not is_error_situation("Gravação Externa")


def test_os_url_adds_spa_prefix_in_production():
    with patch("config_manager.config_manager.get_public_web_base", return_value="https://cgrafsysvm"), patch(
        "config_manager.config_manager.is_development", return_value=False
    ):
        assert _os_url(100, 2026) == "https://cgrafsysvm/sagra/gerencia?ano=2026&id=100"


def test_os_url_keeps_existing_sagra_suffix():
    with patch(
        "config_manager.config_manager.get_public_web_base",
        return_value="https://cgrafsysvm/sagra",
    ), patch("config_manager.config_manager.is_development", return_value=False):
        assert _os_url(100, 2026) == "https://cgrafsysvm/sagra/gerencia?ano=2026&id=100"


def test_os_url_skips_spa_prefix_in_development():
    with patch(
        "config_manager.config_manager.get_public_web_base",
        return_value="http://localhost:5173",
    ), patch("config_manager.config_manager.is_development", return_value=True):
        assert _os_url(100, 2026) == "http://localhost:5173/gerencia?ano=2026&id=100"


@patch("services.os_notificacao_dispatch_service.send_web_push_to_ponto")
@patch("services.os_notificacao_dispatch_service.push_user_notification")
@patch("services.os_notificacao_dispatch_service.insert_user_notification", return_value=10)
@patch(
    "services.os_notificacao_dispatch_service.list_andamento_watchers",
    return_value=["918713"],
)
def test_success_andamento_emits_browser_push(_watchers, _insert, push, web_push):
    dispatch_andamento_notifications(
        nro=100,
        ano=2026,
        situacao="Entregue",
        setor="SEFOC",
        action="insert",
    )

    push.assert_called_once()
    assert push.call_args.kwargs["browser_notify"] is True
    assert push.call_args.kwargs["urgent"] is False
    web_push.assert_called_once()
    assert web_push.call_args.kwargs["title"] == "OS 100/2026"
    assert web_push.call_args.kwargs["notification_id"] == 10
    assert web_push.call_args.kwargs["urgent"] is False
    assert web_push.call_args.kwargs["tag"] == "sagra-notif-10"


@patch("services.os_notificacao_dispatch_service.send_web_push_to_ponto")
@patch("services.os_notificacao_dispatch_service.push_user_notification")
@patch("services.os_notificacao_dispatch_service.insert_user_notification", return_value=11)
@patch(
    "services.os_notificacao_dispatch_service.list_andamento_watchers",
    return_value=["918713"],
)
def test_error_andamento_emits_urgent_browser_push(_watchers, _insert, push, web_push):
    dispatch_andamento_notifications(
        nro=100,
        ano=2026,
        situacao="Problema Técnico",
        setor="SEFOC",
        action="insert",
    )

    assert push.call_args.kwargs["browser_notify"] is True
    assert push.call_args.kwargs["urgent"] is True
    web_push.assert_called_once()
    assert web_push.call_args.kwargs["title"] == "OS 100/2026 - ERRO"
    assert web_push.call_args.kwargs["urgent"] is True


@patch("services.os_notificacao_dispatch_service.send_web_push_to_ponto")
@patch("services.os_notificacao_dispatch_service.push_user_notification")
@patch("services.os_notificacao_dispatch_service.insert_user_notification", return_value=12)
@patch(
    "services.os_notificacao_dispatch_service.list_os_change_watchers",
    return_value=["918713"],
)
def test_os_change_emits_browser_push(_watchers, _insert, push, web_push):
    dispatch_os_change_notifications(nro=50, ano=2026, changes={"titulo": "novo"})

    assert push.call_args.kwargs["browser_notify"] is True
    assert push.call_args.kwargs["action"] == "os_watch_change"
    web_push.assert_called_once()
    assert web_push.call_args.kwargs["notification_id"] == 12
