"""Testes de juntada de OSs na Gravação Pendente."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def test_format_juntada_membros_label():
    from services.gravacao_pendente_service import format_juntada_membros_label

    assert format_juntada_membros_label([]) == ""
    assert format_juntada_membros_label([{"nr_os": 12345, "ano": 2026}]) == "12345/26"
    assert (
        format_juntada_membros_label(
            [{"nr_os": 12345, "ano": 2026}, {"nr_os": 65432, "ano": 2026}]
        )
        == "12345/26 e 65432/26"
    )
    assert (
        format_juntada_membros_label(
            [
                {"nr_os": 1, "ano": 2026},
                {"nr_os": 2, "ano": 2026},
                {"nr_os": 3, "ano": 2026},
            ]
        )
        == "00001/26, 00002/26 e 00003/26"
    )


def test_aggregate_list_items_by_juntada():
    from services.gravacao_pendente_service import _aggregate_list_items_by_juntada

    items = [
        {
            "nr_os": 65432,
            "ano": 2026,
            "juntada_grupo_id": "abc",
            "solicitante": "B",
            "gravacao_pendente_id": 2,
        },
        {
            "nr_os": 12345,
            "ano": 2026,
            "juntada_grupo_id": "abc",
            "solicitante": "A",
            "gravacao_pendente_id": 1,
        },
        {
            "nr_os": 100,
            "ano": 2026,
            "juntada_grupo_id": None,
            "solicitante": "Solo",
            "gravacao_pendente_id": 3,
        },
    ]
    result = _aggregate_list_items_by_juntada(items)
    assert len(result) == 2
    group = next(r for r in result if r.get("juntada_grupo_id") == "abc")
    assert group["nr_os"] == 12345  # âncora = menor nr
    assert len(group["membros"]) == 2
    assert {m["nr_os"] for m in group["membros"]} == {12345, 65432}
    solo = next(r for r in result if r["nr_os"] == 100)
    assert solo["membros"] == [{"nr_os": 100, "ano": 2026}]


@patch("services.gravacao_pendente_service.get_active_pendente_session", return_value=None)
@patch("services.gravacao_pendente_service.os_exists", side_effect=lambda a, n: (a, n) != (2026, 999))
def test_validate_juntadas(_mock_exists, _mock_active):
    from services.gravacao_pendente_service import validate_gravacao_pendente_juntadas

    result = validate_gravacao_pendente_juntadas(
        principal_ano=2026,
        principal_nr=5001,
        juntadas=[
            {"numero": 5001, "ano": 2026},  # principal ignorada
            {"numero": 5002, "ano": 2026},
            {"numero": 5002, "ano": 2026},  # dup
        ],
    )
    assert result == [(2026, 5002)]

    with pytest.raises(ValueError, match="não encontrada"):
        validate_gravacao_pendente_juntadas(
            principal_ano=2026,
            principal_nr=5001,
            juntadas=[{"numero": 999, "ano": 2026}],
        )


@patch("services.gravacao_pendente_service.get_active_pendente_session")
@patch("services.gravacao_pendente_service.os_exists", return_value=True)
def test_validate_juntadas_rejects_active(mock_exists, mock_active):
    from services.gravacao_pendente_service import validate_gravacao_pendente_juntadas

    mock_active.return_value = {"id": 1, "status": "ativa"}
    with pytest.raises(ValueError, match="já possui Gravação Pendente ativa"):
        validate_gravacao_pendente_juntadas(
            principal_ano=2026,
            principal_nr=5001,
            juntadas=[{"numero": 5002, "ano": 2026}],
        )


def test_insert_pendente_session_with_juntada_grupo_id():
    from services.gravacao_pendente_service import insert_pendente_session_cursor

    cursor = MagicMock()
    cursor.lastrowid = 77
    captured: list[tuple[str, tuple]] = []

    def execute(sql, params=None):
        captured.append((" ".join(str(sql).split()), params or ()))

    cursor.execute.side_effect = execute

    insert_pendente_session_cursor(
        cursor,
        ano=2026,
        os_id=5001,
        cod_status="050012026-01",
        ponto_fmt="918.713",
        lancado_por_nome="Test",
        validated_arquivos=[
            {
                "absolute_path": r"\\server\a.tif",
                "nome": "a.tif",
                "tamanho_bytes": 10,
                "ordem": 0,
                "maquina": "M1",
            }
        ],
        validated_chapas=[{"maquina": "M1", "quantidade": 1}],
        juntada_grupo_id="grupo-uuid-1",
    )
    insert_sql = next(s for s, _ in captured if "INSERT INTO tab_os_gravacao_pendente" in s)
    assert "JuntadaGrupoId" in insert_sql
    insert_params = next(p for s, p in captured if "INSERT INTO tab_os_gravacao_pendente" in s)
    assert "grupo-uuid-1" in insert_params
