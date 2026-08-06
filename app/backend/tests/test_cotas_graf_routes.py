"""Testes das rotas e serviço Cotas Graf."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from routers.cotas_graf_routes import (
    CotasGrafSolicitanteCotasItem,
    _as_bool,
    _filtrar_solicitantes_deputados_em_exercicio,
    lancar_cotas_graf,
    list_cotas_graf,
    list_cotas_graf_solicitantes_cotas,
    list_solicitante_consumo_historico,
)
from services.cotas_graf_service import (
    build_cotas_graf_query,
    build_cotas_graf_solicitantes_cotas_query,
    build_solicitante_consumo_historico_query,
)


def test_as_bool():
    assert _as_bool(True)
    assert _as_bool(1)
    assert not _as_bool(False)


def test_build_cotas_graf_query_sem_filtro_oculto_req_entregue():
    list_sql, _, _ = build_cotas_graf_query()
    assert "COALESCE(p.ReqEntregue, 0) = 1" not in list_sql


def test_build_cotas_graf_query_situacao_cotas_pendente():
    list_sql, count_sql, params = build_cotas_graf_query(
        situacao_cotas=["Pendente"],
        include_os=True,
        include_sp=True,
    )
    assert "COALESCE(p.ReqEntregue, 0) = 0" in list_sql
    assert count_sql
    assert params["limit"] == 200


def test_build_cotas_graf_query_situacao_cotas_atualizado():
    list_sql, _, _ = build_cotas_graf_query(situacao_cotas=["Atualizado"])
    assert "COALESCE(p.ReqEntregue, 0) = 1" in list_sql


def test_build_cotas_graf_query_exclude_finished():
    list_sql, _, _ = build_cotas_graf_query(include_finished=False)
    assert "Entregue" in list_sql
    assert "Cancelada" in list_sql


def test_build_cotas_graf_solicitantes_cotas_query_cache():
    list_sql, count_sql, params = build_cotas_graf_solicitantes_cotas_query(
        semestre_id=7,
    )
    assert "FROM tabCotaCliente AS cc" in list_sql
    assert "GROUP BY p.CodUsuarioLink" not in list_sql
    assert params["semestre_id"] == 7
    assert count_sql


def test_build_cotas_graf_solicitantes_cotas_query_protocol_filters():
    list_sql, _, _ = build_cotas_graf_solicitantes_cotas_query(
        semestre_id=7,
        situacao_cotas=["Pendente"],
    )
    assert "GROUP BY p.CodUsuarioLink" in list_sql
    assert "INNER JOIN tabCotaCliente AS cc" in list_sql


def test_list_cotas_graf_solicitantes_cotas():
    rows = [
        {
            "solicitante": "João",
            "categoria": "Deputado",
            "cod_usuario": "1",
            "nome_usuario": "João",
            "consumo_os": 1000,
            "limite_os": 120000,
            "consumo_sp": 50,
            "limite_sp": 10000,
            "semestre_ano": 2026,
            "semestre_numero": 1,
        }
    ]

    with patch("routers.cotas_graf_routes.resolver_semestre_ativo_id", return_value=7), patch(
        "routers.cotas_graf_routes.obter_nomes_deputados_em_exercicio",
        return_value=frozenset({"JOAO"}),
    ), patch(
        "routers.cotas_graf_routes.db"
    ) as mock_db, patch(
        "routers.cotas_graf_routes.build_cotas_graf_solicitantes_cotas_query",
        return_value=("SELECT 1", "SELECT COUNT(*)", {"semestre_id": 7, "limit": 500}),
    ):
        mock_db.execute_query.return_value = rows
        response = list_cotas_graf_solicitantes_cotas(
            nr_os=None,
            ano=None,
            ano_mode="specific",
            produto=None,
            produtos=None,
            titulo=None,
            solicitante=None,
            solicitantes=None,
            situacao_cotas=None,
            include_finished=False,
            include_os=True,
            include_sp=True,
            limit=500,
        )

    assert response.total == 1
    assert response.items[0].saldo_os == 119000
    assert response.items[0].saldo_sp == 9950
    assert response.semestre_ano == 2026


def test_build_solicitante_consumo_historico_query():
    sql, params = build_solicitante_consumo_historico_query(
        semestre_id=1,
        cod_usuario="Dep-00012",
        categoria="Deputado",
        nome_usuario="João",
    )
    assert "tabCotaMovimento" in sql
    assert "tabDetalhesServico" in sql
    assert params["cod_usuario"] == "Dep-00012"


def test_list_solicitante_consumo_historico():
    rows = [
        {
            "nr_os": 6001,
            "ano": 2026,
            "tipo": "sp",
            "cota_consumida": 120,
            "data_entrada": None,
            "produto": "Cartão",
            "titulo": "Cartão visita",
        }
    ]

    with patch("routers.cotas_graf_routes.resolver_semestre_ativo_id", return_value=1), patch(
        "routers.cotas_graf_routes.db"
    ) as mock_db, patch(
        "routers.cotas_graf_routes.build_solicitante_consumo_historico_query",
        return_value=("SELECT 1", {"semestre_id": 1}),
    ):
        mock_db.execute_query.return_value = rows
        response = list_solicitante_consumo_historico(
            cod_usuario="Dep-00012",
            categoria="Deputado",
            nome_usuario="João",
            limit=500,
        )

    assert response.total == 1
    assert response.items[0].tipo == "sp"
    assert response.items[0].cota_consumida == 120


def test_filtrar_solicitantes_deputados_em_exercicio():
    items = [
        CotasGrafSolicitanteCotasItem(
            solicitante="João Atual",
            categoria="Deputado",
            nome_usuario="João Atual",
        ),
        CotasGrafSolicitanteCotasItem(
            solicitante="Ex Deputado",
            categoria="Deputado",
            nome_usuario="Ex Deputado",
        ),
        CotasGrafSolicitanteCotasItem(
            solicitante="Orgao X",
            categoria="Orgao",
            nome_usuario="Orgao X",
        ),
    ]

    with patch(
        "routers.cotas_graf_routes.obter_nomes_deputados_em_exercicio",
        return_value=frozenset({"JOAO ATUAL"}),
    ):
        filtrados = _filtrar_solicitantes_deputados_em_exercicio(items)

    assert len(filtrados) == 2
    assert filtrados[0].solicitante == "João Atual"
    assert filtrados[1].categoria == "Orgao"


def test_list_cotas_graf():
    rows = [
        {
            "nr_os": 100,
            "ano": 2026,
            "produto": "Folder",
            "solicitante": "João",
            "titulo": "Teste",
            "req_entregue": 0,
        }
    ]

    with patch("routers.cotas_graf_routes.db") as mock_db, patch(
        "routers.cotas_graf_routes.build_cotas_graf_query",
        return_value=("SELECT 1", "SELECT COUNT(*)", {"limit": 100, "offset": 0}),
    ):
        mock_db.execute_query.side_effect = [
            [{"total": 1}],
            rows,
        ]
        response = list_cotas_graf(
            nr_os=None,
            ano=None,
            ano_mode="specific",
            produto=None,
            produtos=None,
            titulo=None,
            solicitante=None,
            solicitantes=None,
            situacao_cotas=None,
            include_finished=False,
            include_os=True,
            include_sp=True,
            page=1,
            limit=100,
        )

    assert response.total == 1
    assert response.items[0].cotas_graf_atualizado is False


def test_lancar_cotas_graf_success():
    with patch("routers.cotas_graf_routes.db") as mock_db, patch(
        "routers.os_routes._dispatch_mdb_sync"
    ) as mock_mdb_sync:
        mock_db.execute_query.side_effect = [
            [{"req_entregue": 0}],
            None,
        ]
        response = lancar_cotas_graf(ano=2026, nr_os=100)

    assert response.cotas_graf_atualizado is True
    update_sql = mock_db.execute_query.call_args_list[1][0][0]
    assert "ReqEntregue = 1" in update_sql
    mock_mdb_sync.assert_called_once()
    assert mock_mdb_sync.call_args[0][0] == "cotas_graf_lancar"


def test_lancar_cotas_graf_sync_req_entregue_mdb():
    with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
        "routers.mdb_writer.db"
    ) as mock_db, patch(
        "routers.mdb_writer._execute_mdb_transaction"
    ) as mock_tx:
        mock_cfg.is_mdb_write_enabled.return_value = True
        mock_db.execute_query.return_value = [{"NroProtocolo": 100, "AnoProtocolo": 2026, "ReqEntregue": 1}]
        from routers.mdb_writer import sync_protocolo_req_entregue_to_mdb

        assert sync_protocolo_req_entregue_to_mdb(100, 2026) is True
        mock_tx.assert_called_once()
        assert mock_tx.call_args[0][1] == "protocolo_req_entregue_100_2026"


def test_lancar_cotas_graf_not_found():
    with patch("routers.cotas_graf_routes.db") as mock_db:
        mock_db.execute_query.return_value = []
        with pytest.raises(HTTPException) as exc:
            lancar_cotas_graf(ano=2026, nr_os=100)
    assert exc.value.status_code == 404
