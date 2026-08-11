"""Testes de fan-out de juntada na Gravação Externa (iniciar/concluir/entrega)."""

from unittest.mock import MagicMock, patch

from services.gravacao_externa_service import (
    SETOR_ENTREGA_CHAPAS,
    SETOR_GRAV_EXTERNA,
    SETOR_GRAVACAO_CONCLUIDA,
    SITUACAO_GRAV_CONCLUIDA,
    SITUACAO_RECEBIDO,
    concluir_gravacao,
    iniciar_gravacao,
    lancar_entrega_chapas,
    list_active_externa_by_juntada,
    list_concluida_aguardando_entrega_by_juntada,
)


def _session(
    *,
    sid: int,
    nro: int,
    ano: int = 2026,
    status: str = "pendente",
    juntada: str | None = "grp-1",
    origem: int | None = None,
    entrega: object | None = None,
) -> dict:
    return {
        "id": sid,
        "os_ano": ano,
        "os_nro": nro,
        "status": status,
        "lancado_por_ponto": "111.111",
        "lancado_por_nome": "Op",
        "juntada_grupo_id": juntada,
        "origem_pendente_id": origem,
        "entrega_lancada_em": entrega,
        "cod_status": f"{nro:05d}{ano}-01",
    }


def test_list_active_externa_by_juntada_empty():
    assert list_active_externa_by_juntada("") == []
    assert list_active_externa_by_juntada("   ") == []


@patch("services.gravacao_externa_service.db")
def test_list_active_externa_by_juntada_maps_rows(mock_db):
    mock_db.execute_query.return_value = [
        {
            "Id": 1,
            "OsAno": 2026,
            "OsNro": 100,
            "CodStatus": "c",
            "LancadoPorPonto": "1",
            "LancadoPorNome": None,
            "Status": "pendente",
            "JuntadaGrupoId": "g1",
            "OrigemPendenteId": None,
        },
        {
            "Id": 2,
            "OsAno": 2026,
            "OsNro": 200,
            "CodStatus": "c",
            "LancadoPorPonto": "1",
            "LancadoPorNome": None,
            "Status": "iniciada",
            "JuntadaGrupoId": "g1",
            "OrigemPendenteId": None,
        },
    ]
    result = list_active_externa_by_juntada("g1")
    assert [r["os_nro"] for r in result] == [100, 200]
    assert result[0]["juntada_grupo_id"] == "g1"


@patch("services.gravacao_externa_service.db")
def test_list_concluida_aguardando_entrega_by_juntada(mock_db):
    mock_db.execute_query.return_value = [
        {
            "Id": 9,
            "OsAno": 2026,
            "OsNro": 50,
            "CodStatus": "c",
            "LancadoPorPonto": "1",
            "LancadoPorNome": None,
            "Status": "concluida",
            "JuntadaGrupoId": "g1",
            "OrigemPendenteId": None,
            "EntregaLancadaEm": None,
        }
    ]
    result = list_concluida_aguardando_entrega_by_juntada("g1")
    assert len(result) == 1
    assert result[0]["status"] == "concluida"


@patch("services.gravacao_externa_service._notify_iniciar_gravacao")
@patch("services.gravacao_externa_service.push_gravacao_externa_iniciada")
@patch("services.gravacao_externa_service.send_gravacao_notification_email")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.list_active_externa_by_juntada")
@patch("services.gravacao_externa_service._get_ultimo_operacional")
@patch("services.gravacao_externa_service.get_active_session")
@patch("services.gravacao_externa_service.db")
def test_iniciar_gravacao_fans_out_juntada(
    mock_db,
    mock_get_active,
    mock_ultimo,
    mock_list_juntada,
    mock_build,
    mock_email,
    _push,
    mock_notify,
):
    a = _session(sid=1, nro=100, status="pendente")
    b = _session(sid=2, nro=200, status="pendente")
    mock_get_active.side_effect = [a, {**a, "status": "iniciada"}]
    mock_list_juntada.return_value = [a, b]
    mock_ultimo.return_value = ("Saída p/", SETOR_GRAV_EXTERNA)
    mock_build.return_value = {"status": "iniciada"}

    inserts: list[tuple] = []

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"max_cod": None}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "INSERT INTO tabAndamento" in sql_norm:
                inserts.append(params)

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    iniciar_gravacao(ano=2026, os_id=100, operador_ponto="999.999")

    assert len(inserts) == 2
    assert {p[1] for p in inserts} == {100, 200}  # NroProtocolo
    assert all(p[3] == SITUACAO_RECEBIDO for p in inserts)
    assert all(p[4] == SETOR_GRAV_EXTERNA for p in inserts)
    assert mock_notify.call_count == 2
    mock_email.assert_called_once()


@patch("services.gravacao_externa_service.send_gravacao_notification_email")
@patch("services.gravacao_externa_realtime_service.push_gravacao_externa_concluida")
@patch("services.gravacao_externa_service._notify_concluir_gravacao")
@patch("services.gravacao_externa_service.get_session_by_id")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.list_active_externa_by_juntada")
@patch("services.gravacao_externa_service.get_active_session")
@patch("services.gravacao_externa_service.db")
def test_concluir_gravacao_fans_out_juntada(
    mock_db,
    mock_get_active,
    mock_list_juntada,
    mock_build,
    mock_get_by_id,
    mock_notify,
    _push,
    mock_email,
):
    a = _session(sid=1, nro=100, status="iniciada", origem=10)
    b = _session(sid=2, nro=200, status="iniciada", origem=11)
    mock_get_active.return_value = a
    mock_list_juntada.return_value = [a, b]
    mock_build.return_value = {"status": "concluida"}
    mock_get_by_id.return_value = {**a, "status": "concluida"}
    mock_db.execute_query.return_value = []  # chapas vazias

    inserts: list[tuple] = []
    updates: list[int] = []

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"max_cod": None}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "UPDATE tab_os_gravacao_externa" in sql_norm and "Status = 'concluida'" in sql_norm:
                updates.append(params[1])
            if "INSERT INTO tabAndamento" in sql_norm:
                inserts.append(params)

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    concluir_gravacao(ano=2026, os_id=100, operador_ponto="999.999")

    assert set(updates) == {1, 2}
    assert len(inserts) == 2
    assert {p[1] for p in inserts} == {100, 200}
    assert all(p[3] == SITUACAO_GRAV_CONCLUIDA for p in inserts)
    assert all(p[4] == SETOR_GRAVACAO_CONCLUIDA for p in inserts)
    assert mock_notify.call_count == 2
    mock_email.assert_called_once()


@patch("services.gravacao_externa_service.send_gravacao_notification_email")
@patch("services.gravacao_externa_realtime_service.push_gravacao_externa_concluida")
@patch("services.gravacao_externa_service._notify_concluir_gravacao")
@patch("services.gravacao_externa_service.get_session_by_id")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.list_active_externa_by_juntada")
@patch("services.gravacao_externa_service.get_concluida_session")
@patch("services.gravacao_externa_service.get_active_session", return_value=None)
@patch("services.gravacao_externa_service.db")
def test_concluir_gravacao_repairs_active_sisters_when_anchor_done(
    mock_db,
    _mock_active,
    mock_get_concluida,
    mock_list_juntada,
    mock_build,
    mock_get_by_id,
    mock_notify,
    _push,
    mock_email,
):
    anchor = _session(sid=1, nro=100, status="concluida")
    sister = _session(sid=2, nro=200, status="iniciada")
    mock_get_concluida.return_value = anchor
    mock_list_juntada.return_value = [sister]
    mock_build.return_value = {"status": "concluida"}
    mock_get_by_id.return_value = anchor
    mock_db.execute_query.return_value = []

    inserts: list[tuple] = []

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"max_cod": None}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "INSERT INTO tabAndamento" in sql_norm:
                inserts.append(params)

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    concluir_gravacao(ano=2026, os_id=100, operador_ponto="999.999")

    assert len(inserts) == 1
    assert inserts[0][1] == 200
    assert inserts[0][3] == SITUACAO_GRAV_CONCLUIDA
    mock_notify.assert_called_once()
    mock_email.assert_called_once()


@patch("services.gravacao_externa_service._notify_entrega_chapas")
@patch("services.gravacao_externa_service._lookup_usuario_nome", return_value="Recebedor")
@patch("services.gravacao_externa_service.get_session_by_id")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.list_concluida_aguardando_entrega_by_juntada")
@patch("services.gravacao_externa_service.get_concluida_session")
@patch("services.gravacao_externa_service.db")
def test_lancar_entrega_chapas_fans_out_juntada(
    mock_db,
    mock_get_concluida,
    mock_list_juntada,
    mock_build,
    mock_get_by_id,
    _lookup,
    mock_notify,
):
    a = _session(sid=1, nro=100, status="concluida")
    b = _session(sid=2, nro=200, status="concluida")
    mock_get_concluida.return_value = a
    mock_list_juntada.return_value = [a, b]
    mock_build.return_value = {"status": "concluida", "entrega_lancada_em": "x"}
    mock_get_by_id.return_value = {**a, "entrega_lancada_em": "x"}
    mock_db.execute_query.return_value = []

    inserts: list[tuple] = []
    entrega_ids: list[int] = []

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.rowcount = 1
        cursor.fetchone.return_value = {"max_cod": None}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "EntregaLancadaEm" in sql_norm and "UPDATE" in sql_norm:
                entrega_ids.append(params[2])
            if "INSERT INTO tabAndamento" in sql_norm:
                inserts.append(params)

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    lancar_entrega_chapas(
        ano=2026,
        os_id=100,
        recebido_por_ponto="555.555",
        recebido_por_nome="Recebedor",
    )

    assert set(entrega_ids) == {1, 2}
    assert len(inserts) == 2
    assert {p[1] for p in inserts} == {100, 200}
    assert all(p[3] == SITUACAO_RECEBIDO for p in inserts)
    assert all(p[4] == SETOR_ENTREGA_CHAPAS for p in inserts)
    assert mock_notify.call_count == 2


@patch("services.gravacao_externa_service.send_gravacao_notification_email")
@patch("services.gravacao_externa_realtime_service.push_gravacao_externa_concluida")
@patch("services.gravacao_externa_service._notify_concluir_gravacao")
@patch("services.gravacao_externa_service.get_session_by_id")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.get_active_session")
@patch("services.gravacao_externa_service.db")
def test_concluir_single_os_without_juntada(
    mock_db,
    mock_get_active,
    mock_build,
    mock_get_by_id,
    mock_notify,
    _push,
    mock_email,
):
    session = _session(sid=7, nro=100, status="iniciada", juntada=None, origem=None)
    mock_get_active.return_value = session
    mock_build.return_value = {"status": "concluida"}
    mock_get_by_id.return_value = {**session, "status": "concluida"}
    mock_db.execute_query.return_value = []

    inserts: list[tuple] = []

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"max_cod": "001002026-01"}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "INSERT INTO tabAndamento" in sql_norm:
                inserts.append(params)

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    concluir_gravacao(ano=2026, os_id=100, operador_ponto="999.999")

    assert len(inserts) == 1
    assert inserts[0][1] == 100
    mock_notify.assert_called_once()
