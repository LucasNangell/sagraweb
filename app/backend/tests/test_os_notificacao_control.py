"""Controle de notificação de alterações por último andamento do usuário."""
from __future__ import annotations

from unittest.mock import patch

from services.os_notificacao_watch_service import is_os_change_control_active


def _rows(*items):
    return list(items)


@patch("services.os_notificacao_watch_service._fetch_andamentos_desc")
def test_control_active_after_recebido(mock_fetch):
    mock_fetch.return_value = _rows(
        {"SituacaoLink": "Recebido", "Ponto": "918713"},
    )
    assert is_os_change_control_active(ponto="918713", nro=1, ano=2025)


@patch("services.os_notificacao_watch_service._fetch_andamentos_desc")
def test_control_active_after_execucao_chain(mock_fetch):
    mock_fetch.return_value = _rows(
        {"SituacaoLink": "Na Fila", "Ponto": "918713"},
        {"SituacaoLink": "Em Execução", "Ponto": "918713"},
    )
    assert is_os_change_control_active(ponto="918713", nro=1, ano=2025)


@patch("services.os_notificacao_watch_service._fetch_andamentos_desc")
def test_control_inactive_when_last_andamento_other_ponto(mock_fetch):
    mock_fetch.return_value = _rows(
        {"SituacaoLink": "Na Fila", "Ponto": "111111"},
        {"SituacaoLink": "Recebido", "Ponto": "918713"},
    )
    assert not is_os_change_control_active(ponto="918713", nro=1, ano=2025)


@patch("services.os_notificacao_watch_service._fetch_andamentos_desc")
def test_control_inactive_without_recebido_or_execucao(mock_fetch):
    mock_fetch.return_value = _rows(
        {"SituacaoLink": "Entregue", "Ponto": "918713"},
    )
    assert not is_os_change_control_active(ponto="918713", nro=1, ano=2025)


@patch("services.os_notificacao_watch_service._fetch_andamentos_desc")
def test_control_matches_formatted_ponto(mock_fetch):
    mock_fetch.return_value = _rows(
        {"SituacaoLink": "Em Execução", "Ponto": "91.871-3"},
    )
    assert is_os_change_control_active(ponto="918713", nro=1, ano=2025)
