from unittest.mock import patch

from services.painel_tablet_push_service import (
    dispatch_painel_tablet_sector_push,
    format_os_push_title,
    is_gravacao_situacao,
    resolve_entered_setores,
)


def test_format_os_push_title_uses_short_year():
    assert format_os_push_title(427, 2026) == "OS 427/26"
    assert format_os_push_title(12, 2000) == "OS 12/00"


def test_is_gravacao_situacao():
    assert is_gravacao_situacao("Gravação")
    assert is_gravacao_situacao("Gravação Parcial")
    assert not is_gravacao_situacao("Saída p/")
    assert not is_gravacao_situacao(None)


def test_resolve_entered_setores_on_setor_change():
    assert resolve_entered_setores(
        prev_setor="SEFOC",
        new_setor="SEPAC",
        prev_situacao="Em Execução",
        new_situacao="Saída p/",
    ) == ["SEPAC"]


def test_resolve_entered_setores_same_setor_no_entry():
    assert (
        resolve_entered_setores(
            prev_setor="SEPAC",
            new_setor="SEPAC",
            prev_situacao="Recebido",
            new_situacao="Em Execução",
        )
        == []
    )


def test_resolve_entered_setores_first_appearance():
    assert resolve_entered_setores(
        prev_setor=None,
        new_setor="SEPAC",
        prev_situacao=None,
        new_situacao="Saída p/",
    ) == ["SEPAC"]


def test_resolve_entered_setores_gravacao_by_situacao():
    assert resolve_entered_setores(
        prev_setor="SEFOC",
        new_setor="SEFOC",
        prev_situacao="Em Execução",
        new_situacao="Gravação",
    ) == ["Gravação"]


def test_resolve_entered_setores_gravacao_and_setor_change():
    entered = resolve_entered_setores(
        prev_setor="SEPAC",
        new_setor="SEFOC",
        prev_situacao="Saída p/",
        new_situacao="Gravação Parcial",
    )
    assert entered == ["SEFOC", "Gravação"]


@patch("services.painel_tablet_push_service.send_web_push_to_ponto", return_value=1)
@patch(
    "services.painel_tablet_push_service.list_pontos_for_setores",
    return_value=["918713"],
)
def test_dispatch_sends_push_when_setor_changes(list_pontos, web_push):
    result = dispatch_painel_tablet_sector_push(
        nro=427,
        ano=2026,
        prev_setor="SEFOC",
        new_setor="SEPAC",
        prev_situacao="Em Execução",
        new_situacao="Saída p/",
    )
    assert result["entered"] == ["SEPAC"]
    assert result["pontos"] == ["918713"]
    assert result["sent"] == 1
    list_pontos.assert_called_once_with(["SEPAC"])
    web_push.assert_called_once()
    kwargs = web_push.call_args.kwargs
    assert kwargs["title"] == "OS 427/26"
    assert kwargs["body"] == "Saída p/"
    assert kwargs["tag"] == "painel-tablet-427-2026"
    assert kwargs["url"].endswith("/painel/tablet")


@patch("services.painel_tablet_push_service.send_web_push_to_ponto")
@patch("services.painel_tablet_push_service.list_pontos_for_setores")
def test_dispatch_skips_when_same_setor(list_pontos, web_push):
    result = dispatch_painel_tablet_sector_push(
        nro=1,
        ano=2026,
        prev_setor="SEPAC",
        new_setor="SEPAC",
        prev_situacao="Recebido",
        new_situacao="Em Execução",
    )
    assert result["entered"] == []
    list_pontos.assert_not_called()
    web_push.assert_not_called()


@patch("services.painel_tablet_push_service.send_web_push_to_ponto")
@patch(
    "services.painel_tablet_push_service.list_pontos_for_setores",
    return_value=[],
)
def test_dispatch_no_subscribers(list_pontos, web_push):
    result = dispatch_painel_tablet_sector_push(
        nro=1,
        ano=2026,
        prev_setor=None,
        new_setor="SEPAC",
        prev_situacao=None,
        new_situacao="Saída p/",
    )
    assert result["entered"] == ["SEPAC"]
    assert result["sent"] == 0
    list_pontos.assert_called_once()
    web_push.assert_not_called()
