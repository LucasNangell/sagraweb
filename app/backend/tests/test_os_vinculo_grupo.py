"""Testes de grupos de vínculo com vários pares andamento+setor."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def test_normalize_andamentos_input_dedupes_and_legacy_pair():
    from services.os_vinculo_grupo_service import normalize_andamentos_input

    assert normalize_andamentos_input(situacao=" Recebido ", setor="SEFOC") == [
        {"situacao": "Recebido", "setor": "SEFOC"}
    ]
    pairs = normalize_andamentos_input(
        [
            {"situacao": "Recebido", "setor": "SEFOC"},
            {"situacao": "recebido", "setor": "sefoc"},
            {"situacao": "Saída p/", "setor": "SEIMP"},
            {"situacao": "", "setor": "SEIMP"},
        ]
    )
    assert pairs == [
        {"situacao": "Recebido", "setor": "SEFOC"},
        {"situacao": "Saída p/", "setor": "SEIMP"},
    ]


def test_union_andamentos_merges_lists():
    from services.os_vinculo_grupo_service import union_andamentos

    merged = union_andamentos(
        [{"situacao": "Recebido", "setor": "SEFOC"}],
        [{"situacao": "Saída p/", "setor": "SEIMP"}, {"situacao": "Recebido", "setor": "SEFOC"}],
        [{"situacao": "Em Execução", "setor": "SEGRA"}],
    )
    assert merged == [
        {"situacao": "Recebido", "setor": "SEFOC"},
        {"situacao": "Saída p/", "setor": "SEIMP"},
        {"situacao": "Em Execução", "setor": "SEGRA"},
    ]


def test_andamento_matches_any_casefold():
    from services.os_vinculo_grupo_service import andamento_matches_any

    andamentos = [
        {"situacao": "Recebido", "setor": "SEFOC"},
        {"situacao": "Saída p/", "setor": "SEIMP"},
    ]
    matched = andamento_matches_any("saída p/", "seimp", andamentos)
    assert matched == {"situacao": "Saída p/", "setor": "SEIMP"}
    assert andamento_matches_any("Entregue", "SEFOC", andamentos) is None


def test_replace_grupo_andamentos_rejects_empty():
    from services.os_vinculo_grupo_service import replace_grupo_andamentos

    with pytest.raises(ValueError, match="ao menos um andamento"):
        replace_grupo_andamentos(1, [])


@patch("services.os_vinculo_grupo_service.db")
def test_get_grupo_config_legacy_fallback(mock_db):
    from services.os_vinculo_grupo_service import get_grupo_config

    mock_db.execute_query.side_effect = [
        [
            {
                "id": 7,
                "situacao": "Saída p/",
                "setor": "SEIMP",
                "criado_por_ponto": "1234",
                "criado_em": None,
            }
        ],
        [],
    ]
    config = get_grupo_config(7)
    assert config is not None
    assert config["andamentos"] == [{"situacao": "Saída p/", "setor": "SEIMP"}]
    assert config["situacao"] == "Saída p/"
    assert config["setor"] == "SEIMP"


@patch("services.os_vinculo_grupo_service.db")
def test_get_grupo_config_prefers_child_rows(mock_db):
    from services.os_vinculo_grupo_service import get_grupo_config

    mock_db.execute_query.side_effect = [
        [
            {
                "id": 7,
                "situacao": "Saída p/",
                "setor": "SEIMP",
                "criado_por_ponto": "1234",
                "criado_em": None,
            }
        ],
        [
            {"situacao": "Recebido", "setor": "SEFOC"},
            {"situacao": "Saída p/", "setor": "SEIMP"},
        ],
    ]
    config = get_grupo_config(7)
    assert config is not None
    assert config["andamentos"] == [
        {"situacao": "Recebido", "setor": "SEFOC"},
        {"situacao": "Saída p/", "setor": "SEIMP"},
    ]
    assert config["situacao"] == "Recebido"
    assert config["setor"] == "SEFOC"


@patch("services.os_vinculo_grupo_service.get_grupo_config")
@patch("services.os_vinculo_grupo_service.get_grupo_id_for_os", return_value=10)
@patch("services.os_vinculo_grupo_service.get_connected_os_members")
def test_check_replicacao_matches_any_pair(mock_members, _mock_gid, mock_config):
    from services.os_vinculo_grupo_service import check_replicacao_andamento

    mock_members.return_value = [
        {"numero": 100, "ano": 2026},
        {"numero": 200, "ano": 2026},
    ]
    mock_config.return_value = {
        "id": 10,
        "situacao": "Recebido",
        "setor": "SEFOC",
        "andamentos": [
            {"situacao": "Recebido", "setor": "SEFOC"},
            {"situacao": "Saída p/", "setor": "SEIMP"},
        ],
        "criado_por_ponto": "1",
    }
    result = check_replicacao_andamento(100, 2026, "Saída p/", "SEIMP")
    assert result["requires_confirmation"] is True
    assert result["situacao_grupo"] == "Saída p/"
    assert result["setor_grupo"] == "SEIMP"
    assert len(result["andamentos"]) == 2


@patch("services.os_vinculo_grupo_service.get_grupo_config")
@patch("services.os_vinculo_grupo_service.get_grupo_id_for_os", return_value=10)
@patch("services.os_vinculo_grupo_service.get_connected_os_members")
def test_check_replicacao_non_matching_pair(mock_members, _mock_gid, mock_config):
    from services.os_vinculo_grupo_service import check_replicacao_andamento

    mock_members.return_value = [
        {"numero": 100, "ano": 2026},
        {"numero": 200, "ano": 2026},
    ]
    mock_config.return_value = {
        "id": 10,
        "situacao": "Recebido",
        "setor": "SEFOC",
        "andamentos": [{"situacao": "Recebido", "setor": "SEFOC"}],
        "criado_por_ponto": "1",
    }
    result = check_replicacao_andamento(100, 2026, "Entregue", "SEFOC")
    assert result["requires_confirmation"] is False


@patch("services.os_vinculo_grupo_service.replace_grupo_andamentos")
@patch("services.os_vinculo_grupo_service._andamentos_with_fallback")
@patch("services.os_vinculo_grupo_service.get_grupo_id_for_os")
def test_resolve_merge_unions_andamentos(mock_gid, mock_fallback, mock_replace):
    from services.os_vinculo_grupo_service import resolve_grupo_for_new_vinculo

    mock_gid.side_effect = [10, 20]
    mock_fallback.side_effect = [
        [{"situacao": "Recebido", "setor": "SEFOC"}],
        [{"situacao": "Saída p/", "setor": "SEIMP"}],
    ]
    cursor = MagicMock()
    cursor.fetchall.side_effect = [
        [{"situacao": "Recebido", "setor": "SEFOC"}],
        [{"situacao": "Saída p/", "setor": "SEIMP"}],
    ]

    grupo_id = resolve_grupo_for_new_vinculo(
        100,
        2026,
        200,
        2026,
        None,
        None,
        "1234",
        andamentos=[{"situacao": "Em Execução", "setor": "SEGRA"}],
        cursor=cursor,
    )

    assert grupo_id == 10
    mock_replace.assert_called_once()
    merged = mock_replace.call_args[0][1]
    assert {(p["situacao"], p["setor"]) for p in merged} == {
        ("Recebido", "SEFOC"),
        ("Saída p/", "SEIMP"),
        ("Em Execução", "SEGRA"),
    }
    executed = [call.args[0] for call in cursor.execute.call_args_list]
    assert any("DELETE FROM tabOSVinculoGrupoAndamentos" in sql for sql in executed)
    assert any("DELETE FROM tabOSVinculoGrupos" in sql for sql in executed)
