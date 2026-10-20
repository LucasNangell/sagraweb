"""Board e lançamento do painel de gravação."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from services.painel_gravacao_service import (
    COLUMN_CONCLUIDA,
    COLUMN_RECEBIDO,
    COLUMN_SAIDA,
    compute_remaining_chapas,
    get_painel_gravacao_board,
    group_sessions_into_cards,
    lancar_painel_gravacao,
    resolve_painel_gravacao_targets,
    session_has_remaining,
)


def test_compute_remaining_chapas():
    original = [
        {"maquina": "Komori", "quantidade": 5},
        {"maquina": "SM74", "quantidade": 2},
    ]
    received = [{"maquina": "Komori", "quantidade": 3}]
    out = compute_remaining_chapas(original, received)
    by_maq = {row["maquina"]: row for row in out}
    assert by_maq["Komori"]["quantidade_restante"] == 2
    assert by_maq["SM74"]["quantidade_restante"] == 2
    assert session_has_remaining(out) is True


def test_session_without_chapas_stays_visible():
    assert session_has_remaining([]) is True
    assert session_has_remaining(
        [{"maquina": "Komori", "quantidade": 2, "quantidade_restante": 0}]
    ) is False


def test_group_sessions_into_cards_fan_out_keys():
    cards = group_sessions_into_cards(
        [
            {"nr_os": 10, "ano": 2026, "fornecedor_nome": "Alfa", "status": "pendente"},
            {"nr_os": 10, "ano": 2026, "fornecedor_nome": "Zeta", "status": "pendente"},
        ]
    )
    assert len(cards) == 1
    assert len(cards[0]["sessions"]) == 2


def test_group_sessions_into_cards_merges_juntada():
    cards = group_sessions_into_cards(
        [
            {
                "nr_os": 6137,
                "ano": 2026,
                "juntada_grupo_id": "g1",
                "fornecedor_nome": "Alfa",
                "status": "pendente",
            },
            {
                "nr_os": 6129,
                "ano": 2026,
                "juntada_grupo_id": "g1",
                "fornecedor_nome": "Alfa",
                "status": "pendente",
            },
        ]
    )
    assert len(cards) == 1
    assert cards[0]["nr_os"] == 6129
    assert [m["nr_os"] for m in cards[0]["membros"]] == [6129, 6137]
    assert len(cards[0]["sessions"]) == 2


@patch("services.painel_gravacao_service.db")
def test_get_board_splits_same_os_across_columns(mock_db):
    def execute_query(sql, params=None):
        text = " ".join(str(sql).split())
        if "tab_os_gravacao_pendente gp" in text and "gp.Status = 'ativa'" in text:
            return []
        if "a.SituacaoLink = %s" in text:
            return []
        if "FROM tab_os_gravacao_externa ge" in text and "INNER JOIN tabProtocolos" in text:
            return [
                {
                    "gravacao_externa_id": 1,
                    "nr_os": 1001,
                    "ano": 2026,
                    "gravacao_status": "pendente",
                    "fornecedor_ponto": "111",
                    "fornecedor_nome": "Alfa",
                    "origem_pendente_id": 10,
                    "componente": "todos",
                    "entrega_lancada_em": None,
                    "entrega_dispensada_em": None,
                    "gravacao_criado_em": None,
                    "concluida_em": None,
                    "situacao": "Saída p/",
                    "setor": "Grav. Externa",
                    "last_update": None,
                },
                {
                    "gravacao_externa_id": 2,
                    "nr_os": 1001,
                    "ano": 2026,
                    "gravacao_status": "concluida",
                    "fornecedor_ponto": "222",
                    "fornecedor_nome": "Zeta",
                    "origem_pendente_id": 11,
                    "componente": "todos",
                    "entrega_lancada_em": None,
                    "entrega_dispensada_em": None,
                    "gravacao_criado_em": None,
                    "concluida_em": None,
                    "situacao": "Gravação Ext. Concluída",
                    "setor": "SEGEP",
                    "last_update": None,
                },
            ]
        if "tab_os_gravacao_pendente_chapa" in text:
            ids = list(params or ())
            rows = []
            if 10 in ids:
                rows.append(
                    {"GravacaoPendenteId": 10, "Maquina": "Komori", "QuantidadeChapas": 3}
                )
            if 11 in ids:
                rows.append(
                    {"GravacaoPendenteId": 11, "Maquina": "SM74", "QuantidadeChapas": 2}
                )
            return rows
        if "tab_os_gravacao_externa_entrega_chapa" in text:
            return []
        return []

    mock_db.execute_query.side_effect = execute_query
    board = get_painel_gravacao_board()
    saida = board["columns"][COLUMN_SAIDA]
    concluida = board["columns"][COLUMN_CONCLUIDA]
    recebido = board["columns"][COLUMN_RECEBIDO]
    assert len(saida) == 1
    assert len(concluida) == 1
    assert recebido == []
    assert saida[0]["nr_os"] == 1001
    assert concluida[0]["nr_os"] == 1001
    assert saida[0]["sessions"][0]["fornecedor_nome"] == "Alfa"
    assert concluida[0]["sessions"][0]["fornecedor_nome"] == "Zeta"


@patch(
    "services.painel_gravacao_service.resolve_painel_gravacao_targets",
    side_effect=lambda nro, ano: [(nro, ano)],
)
@patch("services.painel_gravacao_service._lookup_usuario_nome", return_value="Operador")
@patch("services.painel_gravacao_service._notify_andamento_mdb")
@patch("services.painel_gravacao_service.db")
def test_lancar_partial_keeps_session(mock_db, _notify, _nome, _targets):
    session_row = {
        "gravacao_externa_id": 9,
        "nr_os": 55,
        "ano": 2026,
        "gravacao_status": "concluida",
        "fornecedor_ponto": "111",
        "fornecedor_nome": "Alfa",
        "origem_pendente_id": 3,
        "componente": "todos",
        "entrega_lancada_em": None,
        "entrega_dispensada_em": None,
    }

    def execute_query(sql, params=None):
        text = " ".join(str(sql).split())
        if "FROM tab_os_gravacao_externa ge" in text:
            return [session_row]
        if "tab_os_gravacao_pendente_chapa" in text:
            return [{"GravacaoPendenteId": 3, "Maquina": "Komori", "QuantidadeChapas": 5}]
        if "tab_os_gravacao_externa_entrega_chapa" in text and "SUM" in text:
            return []
        return []

    mock_db.execute_query.side_effect = execute_query
    cursor = MagicMock()
    inserted = []

    def execute(sql, params=None):
        inserted.append((" ".join(str(sql).split()), params))
        cursor.rowcount = 1

    cursor.execute.side_effect = execute
    mock_db.execute_transaction.side_effect = lambda ops: [op(cursor) for op in ops]

    with patch(
        "services.andamento_operacional.next_cod_status_for_os",
        return_value="000552026-01",
    ), patch(
        "services.andamento_operacional.insert_andamento_as_ultimo",
        return_value="000552026-01",
    ), patch(
        "routers.os_audit_service.log_andamento_added",
    ):
        result = lancar_painel_gravacao(
            ano=2026,
            nr_os=55,
            situacao="Recebido",
            setor="Gravação",
            obs="[Fornecedor: Alfa]\nChapas por máquina:\n- Komori: 2",
            usuario="918713",
            column_id=COLUMN_CONCLUIDA,
            gravacao_externa_ids=[9],
            chapas=[{"gravacao_externa_id": 9, "maquina": "Komori", "quantidade": 2}],
        )

    assert result["new_id"] == "000552026-01"
    assert result["entrega_completa_ids"] == []
    assert any("tab_os_gravacao_externa_entrega_chapa" in sql for sql, _ in inserted)
    assert not any("EntregaLancadaEm" in sql for sql, _ in inserted)


@patch(
    "services.painel_gravacao_service.resolve_painel_gravacao_targets",
    side_effect=lambda nro, ano: [(nro, ano)],
)
@patch("services.painel_gravacao_service._lookup_usuario_nome", return_value="Operador")
@patch("services.painel_gravacao_service._notify_andamento_mdb")
@patch("services.painel_gravacao_service.db")
def test_lancar_full_sets_entrega_without_extra_andamento(mock_db, _notify, _nome, _targets):
    session_row = {
        "gravacao_externa_id": 9,
        "nr_os": 55,
        "ano": 2026,
        "gravacao_status": "concluida",
        "fornecedor_ponto": "111",
        "fornecedor_nome": "Alfa",
        "origem_pendente_id": 3,
        "componente": "todos",
        "entrega_lancada_em": None,
        "entrega_dispensada_em": None,
    }

    def execute_query(sql, params=None):
        text = " ".join(str(sql).split())
        if "FROM tab_os_gravacao_externa ge" in text:
            return [session_row]
        if "tab_os_gravacao_pendente_chapa" in text:
            return [{"GravacaoPendenteId": 3, "Maquina": "Komori", "QuantidadeChapas": 2}]
        if "tab_os_gravacao_externa_entrega_chapa" in text and "SUM" in text:
            return []
        return []

    mock_db.execute_query.side_effect = execute_query
    cursor = MagicMock()
    inserted = []

    def execute(sql, params=None):
        inserted.append((" ".join(str(sql).split()), params))
        cursor.rowcount = 1

    cursor.execute.side_effect = execute
    mock_db.execute_transaction.side_effect = lambda ops: [op(cursor) for op in ops]

    with patch(
        "services.andamento_operacional.next_cod_status_for_os",
        return_value="000552026-02",
    ), patch(
        "services.andamento_operacional.insert_andamento_as_ultimo",
        return_value="000552026-02",
    ) as insert_and, patch(
        "routers.os_audit_service.log_andamento_added",
    ):
        result = lancar_painel_gravacao(
            ano=2026,
            nr_os=55,
            situacao="Saída p/",
            setor="SEFOC",
            obs="texto",
            usuario="918713",
            column_id=COLUMN_CONCLUIDA,
            gravacao_externa_ids=[9],
            chapas=[{"gravacao_externa_id": 9, "maquina": "Komori", "quantidade": 2}],
        )

    assert result["entrega_completa_ids"] == [9]
    assert insert_and.call_count == 1
    assert insert_and.call_args.kwargs["situacao"] == "Saída p/"
    assert insert_and.call_args.kwargs["setor"] == "SEFOC"
    assert any("EntregaLancadaEm" in sql for sql, _ in inserted)


def test_lancar_rejects_qty_above_remaining():
    with patch("services.painel_gravacao_service.db") as mock_db, patch(
        "services.painel_gravacao_service._lookup_usuario_nome",
        return_value="Operador",
    ), patch(
        "services.painel_gravacao_service.resolve_painel_gravacao_targets",
        side_effect=lambda nro, ano: [(nro, ano)],
    ):
        mock_db.execute_query.side_effect = [
            [
                {
                    "gravacao_externa_id": 9,
                    "nr_os": 55,
                    "ano": 2026,
                    "gravacao_status": "concluida",
                    "fornecedor_ponto": "111",
                    "fornecedor_nome": "Alfa",
                    "origem_pendente_id": 3,
                    "componente": "todos",
                    "entrega_lancada_em": None,
                    "entrega_dispensada_em": None,
                }
            ],
            [{"GravacaoPendenteId": 3, "Maquina": "Komori", "QuantidadeChapas": 2}],
            [],
        ]
        with pytest.raises(HTTPException) as exc:
            lancar_painel_gravacao(
                ano=2026,
                nr_os=55,
                situacao="Recebido",
                setor="Gravação",
                obs="",
                usuario="918713",
                column_id=COLUMN_CONCLUIDA,
                gravacao_externa_ids=[9],
                chapas=[{"gravacao_externa_id": 9, "maquina": "Komori", "quantidade": 9}],
            )
        assert exc.value.status_code == 400


def test_resolve_painel_gravacao_targets_includes_sisters():
    with patch(
        "services.gravacao_pendente_service.resolve_juntada_grupo_for_os",
        return_value={
            "juntada_grupo_id": "g1",
            "membros": [
                {"nr_os": 6137, "ano": 2026},
                {"nr_os": 6129, "ano": 2026},
            ],
        },
    ):
        assert resolve_painel_gravacao_targets(6137, 2026) == [
            (6137, 2026),
            (6129, 2026),
        ]


@patch(
    "services.painel_gravacao_service.resolve_painel_gravacao_targets",
    return_value=[(6137, 2026), (6129, 2026)],
)
@patch("services.painel_gravacao_service._lookup_usuario_nome", return_value="Operador")
@patch("services.painel_gravacao_service._notify_andamento_mdb")
@patch("services.painel_gravacao_service.db")
def test_lancar_replicas_andamento_na_juntada(mock_db, notify, _nome, _targets):
    mock_db.execute_query.return_value = []
    cursor = MagicMock()
    cursor.execute.side_effect = lambda *_a, **_k: setattr(cursor, "rowcount", 1)
    mock_db.execute_transaction.side_effect = lambda ops: [op(cursor) for op in ops]

    with patch(
        "services.andamento_operacional.next_cod_status_for_os",
        side_effect=["061372026-01", "061292026-01"],
    ), patch(
        "services.andamento_operacional.insert_andamento_as_ultimo",
        return_value="x",
    ) as insert_and, patch(
        "routers.os_audit_service.log_andamento_added",
    ):
        result = lancar_painel_gravacao(
            ano=2026,
            nr_os=6137,
            situacao="Recebido",
            setor="Gravação",
            obs="",
            usuario="918713",
            column_id="grav_pendente",
            gravacao_externa_ids=[],
            chapas=[],
        )

    assert result["replicated_to"] == 2
    assert insert_and.call_count == 2
    inserted_os = {(c.kwargs["nro"], c.kwargs["ano"]) for c in insert_and.call_args_list}
    assert inserted_os == {(6137, 2026), (6129, 2026)}
    assert notify.call_count == 2
