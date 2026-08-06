from unittest.mock import patch

from services.os_notificacao_dispatch_service import (
    dispatch_andamento_notifications,
    is_error_situation,
)


def test_is_error_situation_classifies_only_failures():
    assert is_error_situation("Problema Técnico")
    assert is_error_situation("Falha na gravação")
    assert is_error_situation("Cancelada")
    assert not is_error_situation("Entregue")
    assert not is_error_situation("Saída p/")
    assert not is_error_situation("Gravação Externa")


@patch("services.os_notificacao_dispatch_service.send_web_push_to_ponto")
@patch("services.os_notificacao_dispatch_service.push_user_notification")
@patch("services.os_notificacao_dispatch_service.insert_user_notification", return_value=10)
@patch(
    "services.os_notificacao_dispatch_service.list_andamento_watchers",
    return_value=["918713"],
)
def test_success_andamento_keeps_internal_notification_without_browser_push(
    _watchers,
    _insert,
    push,
    web_push,
):
    dispatch_andamento_notifications(
        nro=100,
        ano=2026,
        situacao="Entregue",
        setor="SEFOC",
        action="insert",
    )

    push.assert_called_once()
    assert push.call_args.kwargs["browser_notify"] is False
    web_push.assert_not_called()


@patch("services.os_notificacao_dispatch_service.send_web_push_to_ponto")
@patch("services.os_notificacao_dispatch_service.push_user_notification")
@patch("services.os_notificacao_dispatch_service.insert_user_notification", return_value=11)
@patch(
    "services.os_notificacao_dispatch_service.list_andamento_watchers",
    return_value=["918713"],
)
def test_error_andamento_emits_browser_push(_watchers, _insert, push, web_push):
    dispatch_andamento_notifications(
        nro=100,
        ano=2026,
        situacao="Problema Técnico",
        setor="SEFOC",
        action="insert",
    )

    assert push.call_args.kwargs["browser_notify"] is True
    web_push.assert_called_once()
