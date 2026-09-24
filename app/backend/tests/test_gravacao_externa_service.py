"""Testes do serviço Gravação Externa."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers.andamento_helpers import (
    format_gravacao_concluida_obs,
    format_gravacao_entrega_obs,
    format_gravacao_envio_externa_obs,
    format_gravacao_recebido_obs,
)
from services.gravacao_externa_service import (
    SETOR_ENTREGA_CHAPAS,
    SETOR_GRAV_EXTERNA,
    SETOR_GRAVACAO_CONCLUIDA,
    SITUACAO_GRAV_CONCLUIDA,
    SITUACAO_GRAVACAO_EXTERNA,
    SITUACAO_RECEBIDO,
    SITUACAO_SAIDA_P,
    concluir_gravacao,
    iniciar_gravacao,
    is_em_gravacao_externa_operacional,
    is_gravacao_externa_situacao,
    session_allows_operacao_fornecedor,
    user_can_access_session,
    user_can_send_mensagem,
    validate_arquivos_input,
)


def test_setor_gravacao_concluida_is_segep():
    assert SETOR_GRAVACAO_CONCLUIDA == "SEGEP"
    assert SITUACAO_GRAV_CONCLUIDA == "Gravação Ext. Concluída"


def test_entrega_chapas_andamento_targets():
    assert SITUACAO_RECEBIDO == "Recebido"
    assert SETOR_ENTREGA_CHAPAS == "Gravação"
    assert SETOR_GRAV_EXTERNA == "Grav. Externa"


def test_format_gravacao_concluida_obs():
    text = format_gravacao_concluida_obs(
        [{"maquina": "M1", "quantidade": 5}, {"maquina": "M2", "quantidade": 3}],
    )
    assert "Gravação concluída. Aguardando retirada de:" in text
    assert "Chapas por máquina:" in text
    assert "M1: 5" in text
    assert "M2: 3" in text

    empty = format_gravacao_concluida_obs([])
    assert "(não informado)" in empty


def test_format_gravacao_entrega_obs():
    text = format_gravacao_entrega_obs([{"maquina": "M1", "quantidade": 2}])
    assert "Chapas recebidas:" in text
    assert "Chapas por máquina:" in text
    assert "M1: 2" in text


def test_format_gravacao_envio_and_recebido_obs():
    envio = format_gravacao_envio_externa_obs([{"maquina": "M1", "quantidade": 1}])
    assert "Chapas por máquina:" in envio
    assert "M1: 1" in envio
    recebido = format_gravacao_recebido_obs([{"maquina": "M1", "quantidade": 1}])
    assert "Arquivos baixados:" in recebido
    assert "M1: 1" in recebido


def test_is_gravacao_externa_situacao():
    assert is_gravacao_externa_situacao(SITUACAO_GRAVACAO_EXTERNA)
    assert not is_gravacao_externa_situacao("Gravação")
    assert not is_gravacao_externa_situacao("")


def test_is_em_gravacao_externa_operacional():
    assert is_em_gravacao_externa_operacional(SITUACAO_SAIDA_P, SETOR_GRAV_EXTERNA)
    assert is_em_gravacao_externa_operacional(SITUACAO_RECEBIDO, SETOR_GRAV_EXTERNA)
    assert is_em_gravacao_externa_operacional(SITUACAO_GRAVACAO_EXTERNA, "SEFOC")
    assert not is_em_gravacao_externa_operacional(SITUACAO_SAIDA_P, "Gravação")
    assert not is_em_gravacao_externa_operacional(SITUACAO_GRAV_CONCLUIDA, "SEGEP")


@patch("services.gravacao_externa_service.db")
def test_remove_externa_from_queue_cancels_joined_group_without_deleting(mock_db):
    from services.gravacao_externa_service import remove_externa_from_queue

    executed: list[str] = []
    cursor = MagicMock()
    current_one = None
    current_all = []

    def execute(sql, _params=None):
        nonlocal current_one, current_all
        normalized = " ".join(str(sql).split())
        executed.append(normalized)
        if normalized.startswith("SELECT Id, JuntadaGrupoId, Status"):
            current_one = {
                "Id": 84,
                "JuntadaGrupoId": "grupo-1",
                "Status": "iniciada",
            }
        elif normalized.startswith("SELECT Id FROM tab_os_gravacao_externa"):
            current_all = [{"Id": 84}, {"Id": 85}]
        elif normalized.startswith("UPDATE tab_os_gravacao_externa"):
            cursor.rowcount = 1

    cursor.execute.side_effect = execute
    cursor.fetchone.side_effect = lambda: current_one
    cursor.fetchall.side_effect = lambda: current_all
    mock_db.execute_transaction.side_effect = lambda ops: [op(cursor) for op in ops]

    result = remove_externa_from_queue(84)

    assert result["removed_ids"] == [84, 85]
    assert result["juntada_grupo_id"] == "grupo-1"
    assert len([sql for sql in executed if sql.startswith("UPDATE")]) == 2
    assert not any(sql.startswith("DELETE") for sql in executed)
    assert not any("tabAndamento" in sql for sql in executed)


def test_remove_externa_queue_requires_pendente_page_permission():
    from types import SimpleNamespace

    from routers.gravacao_externa_routes import (
        _require_pending_queue_management_permission,
    )

    request = SimpleNamespace(state=SimpleNamespace(sagra_permissions={}))
    with pytest.raises(HTTPException) as exc:
        _require_pending_queue_management_permission(request)
    assert exc.value.status_code == 403

    request.state.sagra_permissions["sb_gravacao_pendente"] = True
    with (
        patch("routers.gravacao_externa_routes._session_ponto", return_value="123"),
        patch("routers.gravacao_externa_routes.fetch_user_fornecedor", return_value=False),
    ):
        _require_pending_queue_management_permission(request)


def test_user_can_access_session_operator():
    session = {"lancado_por_ponto": "000123"}
    assert user_can_access_session(
        session,
        ponto="999",
        has_operator_permission=True,
    )


def test_user_can_access_session_launcher():
    session = {"lancado_por_ponto": "123"}
    assert user_can_access_session(
        session,
        ponto="123",
        has_operator_permission=False,
    )
    assert not user_can_access_session(
        session,
        ponto="456",
        has_operator_permission=False,
    )


def test_user_can_access_session_fornecedor():
    session = {"lancado_por_ponto": "111", "fornecedor_ponto": "918.713"}
    assert user_can_access_session(
        session,
        ponto="918713",
        has_operator_permission=False,
    )
    assert session_allows_operacao_fornecedor(session, "918.713")
    assert not user_can_access_session(
        session,
        ponto="456",
        has_operator_permission=False,
        is_fornecedor=True,
    )


def test_user_can_send_mensagem_view_or_assigned_fornecedor():
    session = {"lancado_por_ponto": "111", "fornecedor_ponto": "918.713"}
    assert user_can_send_mensagem(
        session,
        ponto="222",
        has_view_permission=True,
        is_fornecedor=False,
    )
    assert not user_can_send_mensagem(
        session,
        ponto="222",
        has_view_permission=False,
        is_fornecedor=False,
    )
    assert user_can_send_mensagem(
        session,
        ponto="918713",
        has_view_permission=False,
        is_fornecedor=True,
    )
    assert not user_can_send_mensagem(
        session,
        ponto="456",
        has_view_permission=True,
        is_fornecedor=True,
    )


def test_resolve_autor_papel_internal_vs_fornecedor():
    from services.gravacao_externa_service import _resolve_autor_papel

    session = {"lancado_por_ponto": "111", "fornecedor_ponto": "918.713"}
    assert _resolve_autor_papel(session, "222", has_view_permission=True) == "lancador"
    assert _resolve_autor_papel(session, "111", has_view_permission=False) == "lancador"
    assert _resolve_autor_papel(session, "918713", has_view_permission=True) == "operador"


@patch("services.gravacao_externa_service._resolve_os_file_path")
def test_validate_arquivos_input_requires_files(mock_resolve):
    mock_resolve.return_value = "/tmp/test.pdf"
    with pytest.raises(ValueError, match="ao menos um"):
        validate_arquivos_input(2026, 1, [])

    result = validate_arquivos_input(
        2026,
        1,
        [{"relative": "Sefoc/test.pdf", "nome": "test.pdf"}],
    )
    assert len(result) == 1
    assert result[0]["relative"] == "Sefoc/test.pdf"


@patch("services.gravacao_externa_service.db")
def test_list_os_gravacao_externa_query(mock_db):
    from datetime import datetime

    from routers.gravacao_externa_routes import GravacaoExternaOsItem
    from services.gravacao_externa_service import list_os_gravacao_externa

    mock_db.execute_query.side_effect = [
        [{"cnt": 1}],
        [
            {
                "nr_os": 1036,
                "ano": 2025,
                "solicitante": "Test",
                "nome_usuario": None,
                "situacao": "Gravação Externa",
                "setor": "SEFOC",
                "last_update": datetime(2026, 7, 7, 17, 47, 41),
                "gravacao_externa_id": 1,
                "gravacao_status": "pendente",
                "lancado_por_ponto": "918.713",
                "lancado_por_nome": "Test User",
                "fornecedor_ponto": "918.713",
                "fornecedor_nome": "Birô Teste",
                "gravacao_criado_em": datetime(2026, 7, 7, 17, 47, 41),
                "produto": "Folheto",
                "titulo": "Titulo",
            }
        ],
    ]
    items, total = list_os_gravacao_externa(
        ano=2025,
        limit=10,
        offset=0,
        fornecedor_ponto="918.713",
    )
    assert total == 1
    assert len(items) == 1
    validated = GravacaoExternaOsItem.model_validate(items[0])
    assert validated.nr_os == 1036
    assert validated.fornecedor_ponto == "918.713"
    assert validated.fornecedor_nome == "Birô Teste"
    list_sql = mock_db.execute_query.call_args_list[1][0][0]
    assert "FROM tab_os_gravacao_externa ge" in list_sql
    assert "WHERE ge.Status IN ('pendente', 'iniciada')" in list_sql
    assert "ORDER BY ge.CriadoEm DESC, ge.Id DESC" in list_sql
    assert "a.SituacaoLink =" not in list_sql
    assert "ge.FornecedorPonto" in list_sql
    assert "ge.FornecedorPonto = %(fornecedor_ponto)s" in list_sql
    assert "p.Titulo" not in list_sql
    assert "IdDetalhesServico" not in list_sql


@patch("services.gravacao_externa_service.db")
def test_cleanup_stale_sessions_does_not_use_andamentos_to_cancel_queue(mock_db):
    from services.gravacao_externa_service import cleanup_stale_externa_sessions

    assert cleanup_stale_externa_sessions() == []
    mock_db.execute_query.assert_not_called()


@patch(
    "services.gravacao_externa_service._get_ultimo_operacional",
    return_value=("Saída p/", "Grav. Externa"),
)
@patch("services.os_edit_lock_service.enforce_interactive_lock")
@patch("services.os_componentes_service.count_sub_os", return_value=0)
@patch("services.os_componentes_service.os_has_active_componentes", return_value=False)
@patch("services.os_protocolo_guard.require_protocolo_mysql", return_value=2026)
@patch("routers.os_routes.db")
def test_add_history_allows_regular_progress_while_external_session_is_active(
    mock_db,
    _require_protocolo,
    _has_components,
    _count_sub_os,
    _lock,
    get_ultimo,
):
    from routers.os_routes import HistoryItem, add_os_history

    mock_db.execute_transaction.side_effect = RuntimeError("reached-transaction")

    with pytest.raises(HTTPException) as exc:
        add_os_history(
            2026,
            1036,
            HistoryItem(
                situacao="Em Execução",
                setor="SEFOC",
                obs="Andamento normal",
                usuario="918713",
            ),
            MagicMock(),
        )

    assert exc.value.status_code == 500
    assert exc.value.detail == "reached-transaction"
    get_ultimo.assert_not_called()


@patch("services.gravacao_externa_service.validate_arquivos_input")
@patch("services.gravacao_externa_service.db")
def test_create_session_with_arquivos(mock_db, mock_validate):
    from services.gravacao_externa_service import create_session_with_arquivos

    mock_validate.return_value = [
        {"relative": "a.pdf", "nome": "a.pdf", "tamanho_bytes": 10, "ordem": 0},
    ]
    mock_db.execute_transaction.return_value = [42]

    session_id = create_session_with_arquivos(
        ano=2026,
        os_id=100,
        cod_status="001002026-01",
        lancado_por_ponto="123",
        arquivos=[{"relative": "a.pdf", "nome": "a.pdf"}],
    )
    assert session_id == 42
    mock_db.execute_transaction.assert_called_once()


@patch("services.gravacao_externa_service.validate_arquivos_input")
@patch("services.gravacao_externa_service.db")
def test_create_session_with_arquivos_overwrites_active(mock_db, mock_validate):
    """Relançar Gravação Externa cancela a sessão ativa e cria outra com os novos arquivos."""
    from services.gravacao_externa_service import create_session_with_arquivos

    mock_validate.return_value = [
        {"relative": "b.pdf", "nome": "b.pdf", "tamanho_bytes": 20, "ordem": 0},
    ]

    captured_sql: list[str] = []

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.lastrowid = 99

        def execute(sql, params=None):
            captured_sql.append(" ".join(str(sql).split()))

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    session_id = create_session_with_arquivos(
        ano=2026,
        os_id=100,
        cod_status="001002026-02",
        lancado_por_ponto="123",
        arquivos=[{"relative": "b.pdf", "nome": "b.pdf"}],
    )
    assert session_id == 99
    assert any("UPDATE tab_os_gravacao_externa" in s and "cancelada" in s for s in captured_sql)
    assert any(
        "INSERT INTO tab_os_gravacao_externa" in s
        and "Observacao" in s
        and "arquivo" not in s
        for s in captured_sql
    )


@patch("services.gravacao_externa_service._notify_iniciar_gravacao")
@patch("services.gravacao_externa_service.push_user_notification")
@patch("services.gravacao_externa_service.insert_user_notification")
@patch("services.gravacao_externa_service.push_gravacao_externa_iniciada")
@patch("services.gravacao_externa_service.send_gravacao_notification_email")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.get_active_session")
@patch("services.gravacao_externa_service.db")
def test_iniciar_gravacao_uses_email_without_inapp_notification(
    mock_db,
    mock_get_active,
    mock_build,
    mock_email,
    _realtime,
    mock_insert,
    mock_push,
    mock_notify_iniciar,
):
    session = {
        "id": 7,
        "os_ano": 2026,
        "os_nro": 100,
        "status": "pendente",
        "lancado_por_ponto": "918.713",
        "lancado_por_nome": "Usuário",
        "origem_pendente_id": None,
        "juntada_grupo_id": None,
    }
    mock_get_active.side_effect = [session, {**session, "status": "iniciada"}]
    mock_build.return_value = {"status": "iniciada"}
    mock_db.execute_query.side_effect = [
        [{"situacao": "Saída p/", "setor": "Grav. Externa"}],  # ultimo operacional
    ]

    captured: dict = {}

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"max_cod": "001002026-01"}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "INSERT INTO tabAndamento" in sql_norm:
                captured["insert_params"] = params

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    iniciar_gravacao(ano=2026, os_id=100, operador_ponto="111.111")

    mock_email.assert_called_once()
    assert mock_email.call_args.kwargs["event"] == "iniciada"
    mock_insert.assert_not_called()
    mock_push.assert_not_called()
    assert captured["insert_params"][3] == SITUACAO_RECEBIDO
    assert captured["insert_params"][4] == SETOR_GRAV_EXTERNA
    assert "Arquivos baixados:" in captured["insert_params"][5]
    mock_notify_iniciar.assert_called_once()


@patch("services.gravacao_externa_service.send_gravacao_notification_email")
@patch("services.gravacao_externa_service.push_user_notification")
@patch("services.gravacao_externa_service.insert_user_notification")
@patch("services.gravacao_externa_realtime_service.push_gravacao_externa_concluida")
@patch("services.gravacao_externa_service._notify_concluir_gravacao")
@patch("services.gravacao_externa_service.get_session_by_id")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.db")
def test_concluir_gravacao_inserts_andamento_with_operador_ponto(
    mock_db,
    mock_build_detail,
    mock_get_session,
    _mock_notify,
    _mock_push,
    _mock_insert_notif,
    _mock_push_notif,
    mock_email,
):
    session = {
        "id": 7,
        "os_ano": 2026,
        "os_nro": 100,
        "cod_status": "001002026-02",
        "lancado_por_ponto": "111.111",
        "status": "iniciada",
        "origem_pendente_id": 5,
        "juntada_grupo_id": None,
    }
    mock_build_detail.return_value = {"status": "concluida"}
    mock_get_session.return_value = {**session, "status": "concluida"}

    mock_db.execute_query.side_effect = [
        [{"Maquina": "M1", "QuantidadeChapas": 5}],
    ]

    captured: dict = {}

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"max_cod": "001002026-02"}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "UPDATE tab_os_gravacao_externa" in sql_norm:
                captured["update_params"] = params
            if "UPDATE tabAndamento SET UltimoStatus = 0" in sql_norm:
                captured["demote_params"] = params
            if "INSERT INTO tabAndamento" in sql_norm:
                captured["insert_sql"] = sql_norm
                captured["insert_params"] = params

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    with patch(
        "services.gravacao_externa_service.get_active_session",
        return_value=session,
    ):
        concluir_gravacao(ano=2026, os_id=100, operador_ponto="999.999")

    assert captured["demote_params"] == (100, 2026)
    params = captured["insert_params"]
    assert "NOW(), 1," in captured["insert_sql"]
    assert params[3] == SITUACAO_GRAV_CONCLUIDA
    assert params[4] == SETOR_GRAVACAO_CONCLUIDA
    assert params[4] == "SEGEP"
    assert "M1: 5" in params[5]
    assert "Aguardando retirada de:" in params[5]
    assert params[6] == "999.999"
    assert captured["update_params"][0] == "999.999"
    mock_email.assert_called_once()
    assert mock_email.call_args.kwargs["event"] == "concluida"
    _mock_insert_notif.assert_not_called()
    _mock_push_notif.assert_not_called()


@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.get_active_session")
def test_concluir_gravacao_idempotent_when_already_concluded(mock_get, mock_build):
    session = {"id": 1, "status": "concluida", "juntada_grupo_id": None}
    mock_get.return_value = session
    mock_build.return_value = session

    with patch("services.gravacao_externa_service.db") as mock_db:
        result = concluir_gravacao(ano=2026, os_id=100, operador_ponto="123")
        mock_db.execute_transaction.assert_not_called()

    assert result == session


@patch("services.gravacao_externa_service.get_active_session")
def test_concluir_gravacao_rejects_unknown_status(mock_get):
    mock_get.return_value = {"id": 1, "status": "cancelada"}

    with pytest.raises(Exception) as exc:
        concluir_gravacao(ano=2026, os_id=100, operador_ponto="123")
    assert exc.value.status_code == 400


@patch("services.gravacao_externa_service._notify_concluir_gravacao")
@patch("services.gravacao_externa_service._get_ultimo_operacional")
@patch("services.gravacao_externa_service.get_concluida_session", return_value=None)
@patch("services.gravacao_externa_service.get_active_session", return_value=None)
@patch("services.gravacao_externa_service.db")
def test_concluir_gravacao_sem_sessao_insere_andamento(
    mock_db,
    _mock_get_session,
    _mock_get_concluida,
    mock_operacional,
    mock_notify,
):
    mock_operacional.return_value = (SITUACAO_RECEBIDO, SETOR_GRAV_EXTERNA)
    captured: dict = {}

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"max_cod": "001002026-01"}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "UPDATE tab_os_gravacao_externa" in sql_norm:
                captured["session_update"] = True
            if "UPDATE tabAndamento SET UltimoStatus = 0" in sql_norm:
                captured["demote_params"] = params
            if "INSERT INTO tabAndamento" in sql_norm:
                captured["insert_sql"] = sql_norm
                captured["insert_params"] = params

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    result = concluir_gravacao(ano=2026, os_id=100, operador_ponto="999.999")

    assert "session_update" not in captured
    assert captured["demote_params"] == (100, 2026)
    params = captured["insert_params"]
    assert params[3] == SITUACAO_GRAV_CONCLUIDA
    assert params[4] == SETOR_GRAVACAO_CONCLUIDA
    assert "Aguardando retirada de:" in params[5]
    assert "(não informado)" in params[5]
    assert params[6] == "999.999"
    mock_notify.assert_called_once_with(ano=2026, os_id=100, new_cod="001002026-02")
    assert result["id"] == 0
    assert result["status"] == "concluida"
    assert result["arquivos"] == []
    assert result["mensagens"] == []
    assert result["cod_status"] == "001002026-02"


@patch("services.gravacao_externa_service._get_ultimo_operacional")
@patch("services.gravacao_externa_service.get_concluida_session", return_value=None)
@patch("services.gravacao_externa_service.get_active_session", return_value=None)
def test_concluir_gravacao_sem_sessao_requires_situacao(
    mock_get, _mock_concluida, mock_operacional
):
    mock_operacional.return_value = ("Gravação", "SEFOC")

    with pytest.raises(Exception) as exc:
        concluir_gravacao(ano=2026, os_id=100, operador_ponto="123")
    assert exc.value.status_code == 400
    assert "Gravação Externa" in str(exc.value.detail)


def test_insert_andamento_as_ultimo_demotes_then_inserts_with_flag():
    from services.andamento_operacional import insert_andamento_as_ultimo

    cursor = MagicMock()
    executed: list[tuple[str, tuple]] = []

    def execute(sql, params=None):
        executed.append((" ".join(str(sql).split()), params))

    cursor.execute.side_effect = execute

    cod = insert_andamento_as_ultimo(
        cursor,
        cod_status="001002026-03",
        nro=100,
        ano=2026,
        situacao=SITUACAO_RECEBIDO,
        setor=SETOR_ENTREGA_CHAPAS,
        obs="obs",
        ponto="111.111",
    )

    assert cod == "001002026-03"
    assert "UPDATE tabAndamento SET UltimoStatus = 0" in executed[0][0]
    assert executed[0][1] == (100, 2026)
    assert "INSERT INTO tabAndamento" in executed[1][0]
    assert "NOW(), 1," in executed[1][0]
    assert executed[1][1] == (
        "001002026-03",
        100,
        2026,
        SITUACAO_RECEBIDO,
        SETOR_ENTREGA_CHAPAS,
        "obs",
        "111.111",
    )

@patch("services.gravacao_externa_service._notify_entrega_chapas")
@patch("services.gravacao_externa_service.get_session_by_id")
@patch("services.gravacao_externa_service.build_session_detail")
@patch("services.gravacao_externa_service.get_concluida_session")
@patch("services.gravacao_externa_service.db")
def test_lancar_entrega_chapas_inserts_andamento_as_ultimo(
    mock_db,
    mock_get_concluida,
    mock_build_detail,
    mock_get_session,
    _mock_notify,
):
    from services.gravacao_externa_service import lancar_entrega_chapas

    session = {
        "id": 7,
        "os_ano": 2026,
        "os_nro": 100,
        "cod_status": "001002026-02",
        "status": "concluida",
        "origem_pendente_id": 5,
        "entrega_lancada_em": None,
    }
    mock_get_concluida.return_value = session
    mock_build_detail.return_value = {"status": "concluida"}
    mock_get_session.return_value = {**session, "entrega_lancada_em": "2026-07-28"}
    mock_db.execute_query.return_value = [{"Maquina": "M1", "QuantidadeChapas": 2}]

    captured: dict = {}

    def fake_tx(ops):
        cursor = MagicMock()
        cursor.rowcount = 1
        cursor.fetchone.return_value = {"max_cod": "001002026-02"}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "UPDATE tabAndamento SET UltimoStatus = 0" in sql_norm:
                captured["demote_params"] = params
            if "INSERT INTO tabAndamento" in sql_norm:
                captured["insert_sql"] = sql_norm
                captured["insert_params"] = params

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    lancar_entrega_chapas(
        ano=2026,
        os_id=100,
        recebido_por_ponto="918.713",
        recebido_por_nome="Recebedor",
    )

    assert captured["demote_params"] == (100, 2026)
    assert "NOW(), 1," in captured["insert_sql"]
    assert captured["insert_params"][3] == SITUACAO_RECEBIDO
    assert captured["insert_params"][4] == SETOR_ENTREGA_CHAPAS
    assert "Chapas recebidas:" in captured["insert_params"][5]


def test_list_internal_gravacao_externa_notification_pontos_filters():
    from services.gravacao_externa_service import (
        list_internal_gravacao_externa_notification_pontos,
    )

    with patch("services.gravacao_externa_service.db") as mock_db:
        mock_db.execute_query.side_effect = [
            [
                {"Ponto": 918713},
                {"Ponto": 222222},
                {"Ponto": 333333},
                {"Ponto": 444444},
            ],
            [
                {"Ponto": 222222, "sb_gravacao_externa": 1},
                {"Ponto": 333333, "sb_estoque": 1},
                {"Ponto": 444444},
            ],
        ]
        pontos = list_internal_gravacao_externa_notification_pontos(
            exclude_ponto="918.713",
        )

    cleaned = {p.replace(".", "") for p in pontos}
    assert cleaned == {"222222", "444444"}


def _fake_mensagem_tx(captured: dict):
    def fake_tx(ops):
        cursor = MagicMock()
        cursor.lastrowid = 5

        def execute(sql, params=None):
            sql_text = str(sql).upper()
            if params and "INSERT" in sql_text and "TAB_OS_GRAVACAO_EXTERNA_MENSAGEM" in sql_text:
                captured["papel"] = params[3]
                captured["autor_ponto"] = params[1]
                captured["mensagem"] = params[4]
            cursor.fetchone.return_value = {
                "Id": 5,
                "AutorPonto": captured.get("autor_ponto") or "",
                "AutorNome": "Nome",
                "AutorPapel": captured.get("papel") or "",
                "Mensagem": captured.get("mensagem") or "",
                "CriadoEm": None,
            }

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    return fake_tx


@patch("services.gravacao_externa_service._lookup_usuario_nome", return_value="Interno")
@patch("services.gravacao_externa_service.push_gravacao_externa_message")
@patch("services.gravacao_externa_service.push_user_notification")
@patch("services.gravacao_externa_service.insert_user_notification", return_value=77)
@patch("services.gravacao_externa_service.list_internal_gravacao_externa_notification_pontos")
@patch("services.gravacao_externa_service.get_active_session")
@patch("services.gravacao_externa_service.db")
def test_add_mensagem_internal_notifies_only_fornecedor(
    mock_db,
    mock_get_active,
    mock_list_internal,
    mock_insert,
    mock_push,
    _ws,
    _nome,
):
    from services.gravacao_externa_service import add_mensagem

    session = {
        "id": 9,
        "os_ano": 2024,
        "os_nro": 1209,
        "lancado_por_ponto": "222.222",
        "fornecedor_ponto": "111.111",
        "status": "iniciada",
    }
    mock_get_active.return_value = session
    captured: dict = {}
    mock_db.execute_transaction.side_effect = _fake_mensagem_tx(captured)

    result = add_mensagem(
        ano=2024,
        os_id=1209,
        ponto="918713",
        mensagem="resposta interna",
        has_view_permission=True,
        is_fornecedor=False,
    )

    assert captured["papel"] == "lancador"
    assert result["autor_papel"] == "lancador"
    mock_list_internal.assert_not_called()
    mock_insert.assert_called_once()
    assert mock_insert.call_args.kwargs["ponto"].replace(".", "") == "111111"
    mock_push.assert_called_once()
    assert str(mock_push.call_args.kwargs["target_ponto"]).replace(".", "") == "111111"


@patch("services.gravacao_externa_service._lookup_usuario_nome", return_value="CGraf")
@patch("services.gravacao_externa_service.push_gravacao_externa_message")
@patch("services.gravacao_externa_service.push_user_notification")
@patch("services.gravacao_externa_service.insert_user_notification", return_value=88)
@patch("services.gravacao_externa_service.list_internal_gravacao_externa_notification_pontos")
@patch("services.gravacao_externa_service.get_active_session")
@patch("services.gravacao_externa_service.db")
def test_add_mensagem_fornecedor_fans_out_to_internals(
    mock_db,
    mock_get_active,
    mock_list_internal,
    mock_insert,
    mock_push,
    _ws,
    _nome,
):
    from services.gravacao_externa_service import add_mensagem

    session = {
        "id": 9,
        "os_ano": 2024,
        "os_nro": 1209,
        "lancado_por_ponto": "222.222",
        "fornecedor_ponto": "111.111",
        "status": "iniciada",
    }
    mock_get_active.return_value = session
    mock_list_internal.return_value = ["222.222", "918.713"]
    captured: dict = {}
    mock_db.execute_transaction.side_effect = _fake_mensagem_tx(captured)

    result = add_mensagem(
        ano=2024,
        os_id=1209,
        ponto="111.111",
        mensagem="msg do birô",
        has_view_permission=True,
        is_fornecedor=True,
    )

    assert captured["papel"] == "operador"
    assert result["autor_papel"] == "operador"
    mock_list_internal.assert_called_once()
    assert mock_insert.call_count == 2
    inserted = {
        str(c.kwargs["ponto"]).replace(".", "") for c in mock_insert.call_args_list
    }
    assert inserted == {"222222", "918713"}
    pushed = {
        str(c.kwargs["target_ponto"]).replace(".", "") for c in mock_push.call_args_list
    }
    assert pushed == {"222222", "918713"}
