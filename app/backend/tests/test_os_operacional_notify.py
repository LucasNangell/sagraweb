"""broadcast_os_system_update deve atualizar materialização da busca."""
from unittest.mock import patch

from routers.realtime import broadcast_os_system_update


@patch("services.os_andamento_post_change_service.after_andamento_changed")
def test_broadcast_delegates_to_after_andamento_changed(mock_after):
    mock_after.return_value = {"notified": True}
    broadcast_os_system_update(
        123,
        2026,
        "history_added",
        setor="SEFOC",
        situacao="Em Execução",
        origem="email",
    )

    mock_after.assert_called_once()
    kwargs = mock_after.call_args.kwargs
    assert mock_after.call_args.args[:3] == (123, 2026, "history_added")
    assert kwargs["source"] == "email"
    assert kwargs["notify"] is True
    assert kwargs["setor"] == "SEFOC"
    assert kwargs["situacao"] == "Em Execução"
