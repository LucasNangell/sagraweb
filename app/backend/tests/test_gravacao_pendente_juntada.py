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


def test_with_juntada_obs_prefix():
    from routers.andamento_helpers import with_juntada_obs_prefix

    assert with_juntada_obs_prefix("Chapas", "") == "Chapas"
    assert with_juntada_obs_prefix("Chapas", "01209/26 e 01350/26") == (
        "OSs juntadas: 01209/26 e 01350/26\n\nChapas"
    )
    assert with_juntada_obs_prefix("", "01209/26 e 01350/26") == (
        "OSs juntadas: 01209/26 e 01350/26"
    )


@patch("services.gravacao_pendente_service.db")
def test_resolve_juntada_grupo_for_os(mock_db):
    from services.gravacao_pendente_service import resolve_juntada_grupo_for_os

    mock_db.execute_query.side_effect = [
        [{"juntada_grupo_id": "g1", "criado_em": "2026-01-01"}],
        [
            {"nr_os": 100, "ano": 2026},
            {"nr_os": 200, "ano": 2026},
        ],
    ]
    result = resolve_juntada_grupo_for_os(100, 2026)
    assert result is not None
    assert result["juntada_grupo_id"] == "g1"
    assert len(result["membros"]) == 2
    assert result["membros_vinculo"] == [
        {"numero": 100, "ano": 2026},
        {"numero": 200, "ano": 2026},
    ]


@patch("services.gravacao_pendente_service.db")
def test_resolve_juntada_grupo_for_os_solo(mock_db):
    from services.gravacao_pendente_service import resolve_juntada_grupo_for_os

    mock_db.execute_query.side_effect = [
        [{"juntada_grupo_id": "g1", "criado_em": "2026-01-01"}],
        [{"nr_os": 100, "ano": 2026}],
    ]
    assert resolve_juntada_grupo_for_os(100, 2026) is None


@patch("services.gravacao_pendente_service.list_juntada_membros")
def test_juntada_membros_label(mock_list):
    from services.gravacao_pendente_service import juntada_membros_label

    mock_list.return_value = [
        {"nr_os": 1209, "ano": 2026},
        {"nr_os": 1350, "ano": 2026},
    ]
    assert juntada_membros_label("g1") == "01209/26 e 01350/26"
    assert juntada_membros_label(None) == ""
    assert juntada_membros_label("") == ""


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


@patch("services.gravacao_pendente_service.db")
def test_enrich_juntada_membros_from_sessions(mock_db):
    from services.gravacao_pendente_service import _enrich_juntada_membros_from_sessions

    aggregated = [
        {
            "nr_os": 5746,
            "ano": 2026,
            "juntada_grupo_id": "g1",
            "membros": [{"nr_os": 5746, "ano": 2026}],
        }
    ]
    mock_db.execute_query.return_value = [
        {"nr_os": 5746, "ano": 2026, "juntada_grupo_id": "g1"},
        {"nr_os": 6059, "ano": 2026, "juntada_grupo_id": "g1"},
    ]
    result = _enrich_juntada_membros_from_sessions(aggregated)
    assert {m["nr_os"] for m in result[0]["membros"]} == {5746, 6059}


def test_next_cod_status_avoids_session_reuse():
    from services.andamento_operacional import next_cod_status_for_os

    cursor = MagicMock()
    # tabAndamento: -07; gravacao_pendente: -08; gravacao_externa: vazio
    cursor.fetchall.side_effect = [
        [{"CodStatus": "060592026-07"}],
        [{"CodStatus": "060592026-08"}],
        [],
    ]
    assert next_cod_status_for_os(cursor, 6059, 2026) == "060592026-09"


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


@patch("services.os_vinculo_grupo_service.check_replicacao_andamento")
@patch("services.gravacao_pendente_service.resolve_juntada_grupo_for_os")
def test_check_vinculo_replicacao_entregue_skips_juntada(
    mock_resolve_juntada, mock_check_vinculo
):
    """Entregue em juntada não pede confirmação de juntada; cai no check de vínculo."""
    from routers.os_routes import check_vinculo_replicacao

    mock_resolve_juntada.return_value = {
        "juntada_grupo_id": "g1",
        "membros_vinculo": [
            {"numero": 100, "ano": 2026},
            {"numero": 200, "ano": 2026},
        ],
    }
    mock_check_vinculo.return_value = {
        "requires_confirmation": False,
        "membros": [],
    }

    result = check_vinculo_replicacao(
        ano=2026, id=100, situacao="Entregue", setor="SEFOC"
    )
    assert result.requires_confirmation is False
    mock_check_vinculo.assert_called_once_with(100, 2026, "Entregue", "SEFOC")


@patch("services.os_vinculo_grupo_service.check_replicacao_andamento")
@patch("services.gravacao_pendente_service.resolve_juntada_grupo_for_os")
def test_check_vinculo_replicacao_other_situacao_uses_juntada(
    mock_resolve_juntada, mock_check_vinculo
):
    from routers.os_routes import check_vinculo_replicacao

    mock_resolve_juntada.return_value = {
        "juntada_grupo_id": "g1",
        "membros_vinculo": [
            {"numero": 100, "ano": 2026},
            {"numero": 200, "ano": 2026},
        ],
    }

    result = check_vinculo_replicacao(
        ano=2026, id=100, situacao="Em Execução", setor="SEFOC"
    )
    assert result.requires_confirmation is True
    assert result.origem == "juntada"
    assert result.juntada_grupo_id == "g1"
    mock_check_vinculo.assert_not_called()


def test_enviar_juntada_por_id_exato_processa_todas_as_os():
    from services.gravacao_pendente_service import enviar_para_gravacao_externa

    anchor = {
        "id": 10,
        "os_ano": 2026,
        "os_nro": 100,
        "juntada_grupo_id": "g1",
        "lancado_por_ponto": "918.713",
        "lancado_por_nome": "Operador",
        "componente": "todos",
    }
    sister = {
        **anchor,
        "id": 11,
        "os_nro": 200,
    }
    arquivos = [{"nome": "a.pdf", "absolute_path": r"\\server\a.pdf"}]

    with (
        patch(
            "services.gravacao_pendente_service.resolve_fornecedor_ponto",
            return_value="222.222",
        ),
        patch(
            "services.gravacao_pendente_service.get_active_pendente_session",
            return_value=anchor,
        ),
        patch(
            "services.gravacao_pendente_service.list_active_pendente_by_juntada",
            return_value=[anchor, sister],
        ),
        patch(
            "services.gravacao_pendente_service.build_pendente_detail",
            return_value={"arquivos": arquivos},
        ),
        patch(
            "services.gravacao_pendente_service._enviar_uma_pendente_para_externa_cursor",
            side_effect=[("001002026-02", 101), ("002002026-03", 102)],
        ) as enviar_uma,
        patch("services.gravacao_pendente_service.db") as mock_db,
        patch(
            "services.gravacao_pendente_service._notify_enviar_gravacao_externa"
        ) as notify,
        patch("services.gravacao_pendente_service.send_gravacao_notification_email"),
        patch("services.gravacao_pendente_service._lookup_usuario_nome"),
        patch(
            "services.gravacao_pendente_service.get_session_by_id",
            return_value={"id": 101},
        ),
        patch(
            "services.gravacao_pendente_service.build_session_detail",
            return_value={"id": 101},
        ),
        patch("services.gravacao_preview_cache_service.enqueue_preview_warmup"),
    ):
        mock_db.execute_transaction.side_effect = lambda operations: [
            operation(MagicMock()) for operation in operations
        ]

        result = enviar_para_gravacao_externa(
            ano=2026,
            os_id=100,
            operador_ponto="918713",
            fornecedor_ponto="222222",
            gravacao_pendente_id=10,
        )

    assert result == {"id": 101}
    assert [call.kwargs["pendente"]["id"] for call in enviar_uma.call_args_list] == [
        10,
        11,
    ]
    assert notify.call_count == 2
