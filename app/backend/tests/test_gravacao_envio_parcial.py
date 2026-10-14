"""Envio parcial por máquina (desmembramento de sessões pendentes) e listas por sessão."""

from contextlib import ExitStack
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

SVC = "services.gravacao_pendente_service"


def _arquivo_row(arq_id: int, nome: str, maquina: str | None) -> dict:
    return {
        "Id": arq_id,
        "AbsolutePath": rf"\\srv\{nome}",
        "NomeArquivo": nome,
        "TamanhoBytes": 10,
        "Ordem": arq_id,
        "Maquina": maquina,
    }


class FakeCursor:
    """Cursor mínimo que responde às consultas do envio por unidades."""

    def __init__(self, arquivos, chapas, *, has_partes=False, locked=True):
        self.arquivos = arquivos
        self.chapas = chapas
        self.has_partes = has_partes
        self.locked = locked
        self.calls: list[tuple[str, object]] = []
        self._last = ""
        self.rowcount = 1
        self.lastrowid = 500

    def execute(self, sql, params=None):
        norm = " ".join(str(sql).split())
        self.calls.append((norm, params))
        self._last = norm
        if norm.startswith("INSERT INTO tab_os_gravacao_pendente "):
            self.lastrowid += 1
            self.rowcount = 1

    def fetchone(self):
        if "FROM tab_os_gravacao_pendente WHERE Id = %s AND Status = 'ativa' FOR UPDATE" in self._last:
            return {"Id": 1} if self.locked else None
        if "WHERE DesmembradaDeId = %s" in self._last:
            return {"Id": 9} if self.has_partes else None
        return None

    def fetchall(self):
        if "FROM tab_os_gravacao_pendente_arquivo" in self._last:
            return self.arquivos
        if "FROM tab_os_gravacao_pendente_chapa" in self._last:
            return self.chapas
        return []

    def sql_calls(self, prefix: str) -> list[tuple[str, object]]:
        return [c for c in self.calls if c[0].startswith(prefix)]


def _session(sid: int, nr_os: int = 100, gid: str | None = None, componente: str = "todos"):
    return {
        "id": sid,
        "os_ano": 2026,
        "os_nro": nr_os,
        "status": "ativa",
        "juntada_grupo_id": gid,
        "componente": componente,
        "lancado_por_ponto": "918.713",
        "lancado_por_nome": "Operador",
    }


def _run_envio(cursor, sessions, *, maquinas, juntada=None, enviar_side_effect=None):
    from services.gravacao_pendente_service import enviar_para_gravacao_externa

    by_id = {s["id"]: s for s in sessions}
    with ExitStack() as stack:
        stack.enter_context(patch(f"{SVC}.resolve_fornecedor_ponto", return_value="222.222"))
        stack.enter_context(patch(f"{SVC}.get_pendente_session_by_id", side_effect=by_id.get))
        stack.enter_context(
            patch(f"{SVC}.list_active_pendente_by_juntada", return_value=juntada or [])
        )
        enviar_uma = stack.enter_context(
            patch(
                f"{SVC}._enviar_uma_pendente_para_externa_cursor",
                side_effect=enviar_side_effect
                or (lambda *_a, **kw: ("COD", 700 + int(kw["pendente"]["id"]))),
            )
        )
        mock_db = stack.enter_context(patch(f"{SVC}.db"))
        notify = stack.enter_context(patch(f"{SVC}._notify_enviar_gravacao_externa"))
        email = stack.enter_context(patch(f"{SVC}.send_gravacao_notification_email"))
        stack.enter_context(patch(f"{SVC}._lookup_usuario_nome", return_value="Forn"))
        stack.enter_context(patch(f"{SVC}.get_session_by_id", return_value={"id": 1}))
        stack.enter_context(patch(f"{SVC}.build_session_detail", return_value={"id": 1}))
        stack.enter_context(patch("services.gravacao_preview_cache_service.enqueue_preview_warmup"))
        mock_db.execute_transaction.side_effect = lambda ops: [op(cursor) for op in ops]
        result = enviar_para_gravacao_externa(
            ano=2026,
            os_id=100,
            operador_ponto="111111",
            fornecedor_ponto="222222",
            gravacao_pendente_ids=[s["id"] for s in sessions],
            maquinas=maquinas,
        )
    return result, enviar_uma, notify, email


def test_envio_parcial_desmembra_e_envia_so_maquina_selecionada():
    cursor = FakeCursor(
        arquivos=[
            _arquivo_row(1, "k1.tif", "Komori"),
            _arquivo_row(2, "s1.tif", "SM74"),
        ],
        chapas=[{"Maquina": "Komori"}, {"Maquina": "SM74"}],
    )
    _result, enviar_uma, notify, email = _run_envio(
        cursor, [_session(10)], maquinas=["komori "]
    )

    inserts = cursor.sql_calls("INSERT INTO tab_os_gravacao_pendente ")
    assert len(inserts) == 1
    assert "DesmembradaDeId" in inserts[0][0]
    assert inserts[0][1] == (None, 10)

    moves = cursor.sql_calls("UPDATE tab_os_gravacao_pendente_arquivo")
    assert moves[0][1] == (501, 10, "komori")
    chapa_moves = cursor.sql_calls("UPDATE tab_os_gravacao_pendente_chapa")
    assert chapa_moves[0][1] == (501, 10, "komori")

    assert enviar_uma.call_count == 1
    kwargs = enviar_uma.call_args.kwargs
    assert kwargs["pendente"]["id"] == 501
    assert kwargs["pendente"]["desmembrada_de_id"] == 10
    assert [a["nome"] for a in kwargs["arquivos"]] == ["k1.tif"]
    assert kwargs["allow_coexisting_parts"] is True
    assert notify.call_count == 1
    email.assert_called_once()


def test_envio_com_todas_as_maquinas_nao_desmembra():
    cursor = FakeCursor(
        arquivos=[
            _arquivo_row(1, "k1.tif", "Komori"),
            _arquivo_row(2, "s1.tif", "SM74"),
        ],
        chapas=[{"Maquina": "Komori"}, {"Maquina": "SM74"}],
    )
    _result, enviar_uma, _notify, _email = _run_envio(
        cursor, [_session(10)], maquinas=["Komori", "SM74"]
    )

    assert cursor.sql_calls("INSERT INTO tab_os_gravacao_pendente ") == []
    kwargs = enviar_uma.call_args.kwargs
    assert kwargs["pendente"]["id"] == 10
    assert len(kwargs["arquivos"]) == 2
    assert kwargs["allow_coexisting_parts"] is False


def test_envio_sem_selecao_envia_tudo_e_libera_trava_quando_ja_ha_partes():
    cursor = FakeCursor(
        arquivos=[_arquivo_row(2, "s1.tif", "SM74")],
        chapas=[{"Maquina": "SM74"}],
        has_partes=True,
    )
    _result, enviar_uma, _notify, _email = _run_envio(cursor, [_session(10)], maquinas=[])

    assert cursor.sql_calls("INSERT INTO tab_os_gravacao_pendente ") == []
    kwargs = enviar_uma.call_args.kwargs
    assert kwargs["pendente"]["id"] == 10
    assert kwargs["allow_coexisting_parts"] is True


def test_arquivos_sem_maquina_ficam_no_pai():
    cursor = FakeCursor(
        arquivos=[
            _arquivo_row(1, "k1.tif", "Komori"),
            _arquivo_row(3, "legado.pdf", None),
        ],
        chapas=[{"Maquina": "Komori"}],
    )
    _result, enviar_uma, _notify, _email = _run_envio(
        cursor, [_session(10)], maquinas=["Komori"]
    )

    assert len(cursor.sql_calls("INSERT INTO tab_os_gravacao_pendente ")) == 1
    assert [a["nome"] for a in enviar_uma.call_args.kwargs["arquivos"]] == ["k1.tif"]


def test_rota_enviar_converte_conflito_de_componente_em_409():
    from routers import gravacao_pendente_routes as routes

    with ExitStack() as stack:
        stack.enter_context(patch.object(routes, "_require_lancar_externa_permission"))
        stack.enter_context(
            patch.object(routes, "_get_request_session", return_value=MagicMock(ponto="111111"))
        )
        stack.enter_context(
            patch.object(
                routes,
                "enviar_para_gravacao_externa",
                side_effect=ValueError("A OS já possui um envio ativo em gravação externa."),
            )
        )
        with pytest.raises(HTTPException) as exc:
            routes.post_enviar_gravacao_externa(
                MagicMock(), 2026, 100, routes.EnviarGravacaoExternaBody()
            )
    assert exc.value.status_code == 409
    assert "envio ativo" in exc.value.detail


def test_maquina_restante_so_com_chapas_envia_sessao_inteira():
    cursor = FakeCursor(
        arquivos=[_arquivo_row(1, "k1.tif", "Komori")],
        chapas=[{"Maquina": "Komori"}, {"Maquina": "SM74"}],
    )
    _result, enviar_uma, _notify, _email = _run_envio(
        cursor, [_session(10)], maquinas=["Komori"]
    )

    assert cursor.sql_calls("INSERT INTO tab_os_gravacao_pendente ") == []
    assert enviar_uma.call_args.kwargs["pendente"]["id"] == 10


def test_maquina_indisponivel_retorna_409_sem_enviar():
    cursor = FakeCursor(
        arquivos=[_arquivo_row(1, "k1.tif", "Komori")],
        chapas=[{"Maquina": "Komori"}],
    )
    with pytest.raises(HTTPException) as exc:
        _run_envio(cursor, [_session(10)], maquinas=["Komori", "PM52"])
    assert exc.value.status_code == 409
    assert "PM52" in exc.value.detail


def test_sessao_ja_enviada_retorna_409():
    cursor = FakeCursor(arquivos=[], chapas=[], locked=False)
    with pytest.raises(HTTPException) as exc:
        _run_envio(cursor, [_session(10)], maquinas=["Komori"])
    assert exc.value.status_code == 409


def test_capa_e_miolo_enviam_maquina_de_cada_componente():
    cursor = FakeCursor(
        arquivos=[
            _arquivo_row(1, "k1.tif", "Komori"),
            _arquivo_row(2, "s1.tif", "SM74"),
        ],
        chapas=[{"Maquina": "Komori"}, {"Maquina": "SM74"}],
    )
    _result, enviar_uma, notify, email = _run_envio(
        cursor,
        [_session(10, componente="capa"), _session(11, componente="miolo")],
        maquinas=["Komori"],
    )

    parents = [call.kwargs["pendente"]["desmembrada_de_id"] for call in enviar_uma.call_args_list]
    assert parents == [10, 11]
    assert notify.call_count == 2
    email.assert_called_once()


def test_juntada_desmembrada_compartilha_novo_grupo():
    anchor = _session(10, nr_os=100, gid="g1")
    sister = _session(11, nr_os=200, gid="g1")
    cursor = FakeCursor(
        arquivos=[
            _arquivo_row(1, "k1.tif", "Komori"),
            _arquivo_row(2, "s1.tif", "SM74"),
        ],
        chapas=[{"Maquina": "Komori"}, {"Maquina": "SM74"}],
    )
    _result, enviar_uma, _notify, _email = _run_envio(
        cursor, [anchor], maquinas=["Komori"], juntada=[anchor, sister]
    )

    calls = enviar_uma.call_args_list
    assert len(calls) == 2
    new_gids = {c.kwargs["pendente"]["juntada_grupo_id"] for c in calls}
    assert len(new_gids) == 1
    assert new_gids != {"g1"}
    assert {c.kwargs["juntada_label_grupo_id"] for c in calls} == {"g1"}
    assert [c.kwargs["pendente"]["desmembrada_de_id"] for c in calls] == [10, 11]


def test_sessao_de_outra_os_e_rejeitada():
    cursor = FakeCursor(arquivos=[], chapas=[])
    with pytest.raises(HTTPException) as exc:
        _run_envio(cursor, [_session(10, nr_os=999)], maquinas=["Komori"])
    assert exc.value.status_code == 400


def test_agregador_nao_funde_partes_do_mesmo_componente():
    from services.gravacao_pendente_service import _aggregate_list_items_by_juntada

    items = [
        {"nr_os": 100, "ano": 2026, "componente": "capa", "gravacao_externa_id": 1},
        {"nr_os": 100, "ano": 2026, "componente": "capa", "gravacao_externa_id": 2},
    ]
    result = _aggregate_list_items_by_juntada(items)
    assert [r["gravacao_externa_id"] for r in result] == [1, 2]


def test_get_viewable_pendente_session_aceita_so_parte_enviada():
    from services.gravacao_pendente_service import get_viewable_pendente_session

    parte = {**_session(501), "status": "enviada", "desmembrada_de_id": 10}
    raiz_enviada = {**_session(10), "status": "enviada", "desmembrada_de_id": None}

    with (
        patch(f"{SVC}.get_active_pendente_session", return_value=None),
        patch(f"{SVC}.get_pendente_session_by_id", side_effect=[parte, raiz_enviada]),
    ):
        assert get_viewable_pendente_session(2026, 100, 501) == parte
        assert get_viewable_pendente_session(2026, 100, 10) is None

    with patch(f"{SVC}.get_active_pendente_session", return_value=None):
        assert get_viewable_pendente_session(2026, 100, None) is None


@patch(f"{SVC}.db")
def test_list_pendente_envios_parciais(mock_db):
    from services.gravacao_pendente_service import list_pendente_envios_parciais

    mock_db.execute_query.side_effect = [
        [
            {
                "gravacao_pendente_id": 501,
                "componente": "capa",
                "enviada_em": None,
                "gravacao_externa_id": 701,
                "externa_status": "pendente",
                "fornecedor_ponto": "222.222",
                "fornecedor_nome": "Birô A",
            }
        ],
        [_arquivo_row(1, "k1.tif", "Komori")],
        [{"Id": 5, "Maquina": "Komori", "QuantidadeChapas": 4}],
    ]
    envios = list_pendente_envios_parciais(10)

    assert len(envios) == 1
    assert envios[0]["fornecedor_nome"] == "Birô A"
    assert envios[0]["maquinas"] == ["Komori"]
    assert envios[0]["arquivos"][0]["nome"] == "k1.tif"
    assert envios[0]["chapas"][0]["quantidade"] == 4
    assert mock_db.execute_query.call_args_list[0][0][1] == (10,)


def test_insert_externa_com_partes_coexistentes_ignora_trava_de_componente():
    from services.gravacao_externa_service import insert_session_with_arquivos_cursor

    cursor = MagicMock()
    cursor.lastrowid = 77
    cursor.fetchall.return_value = [{"Id": 1, "Componente": "capa"}]

    with pytest.raises(ValueError):
        insert_session_with_arquivos_cursor(
            cursor,
            ano=2026,
            os_id=100,
            cod_status="C1",
            ponto_fmt="111.111",
            lancado_por_nome=None,
            validated_arquivos=[],
            componente="capa",
            allow_replace_active=False,
        )

    cursor.reset_mock()
    cursor.lastrowid = 77
    session_id = insert_session_with_arquivos_cursor(
        cursor,
        ano=2026,
        os_id=100,
        cod_status="C1",
        ponto_fmt="111.111",
        lancado_por_nome=None,
        validated_arquivos=[],
        componente="capa",
        allow_replace_active=False,
        allow_coexisting_parts=True,
    )
    assert session_id == 77
    executed = [" ".join(str(c.args[0]).split()) for c in cursor.execute.call_args_list]
    assert not any("FOR UPDATE" in sql for sql in executed)
    assert not any(sql.startswith("UPDATE tab_os_gravacao_externa") for sql in executed)


@patch(f"{SVC}.db")
def test_list_historico_inclui_partes_desmembradas(mock_db):
    from services.gravacao_pendente_service import list_historico_concluidas

    mock_db.execute_query.side_effect = [[{"cnt": 0}], []]
    with (
        patch(
            f"{SVC}.ensure_controle_list_desde",
            return_value=datetime(2026, 7, 14, 18, 0, 0),
        ),
        patch(f"{SVC}.get_total_chapas_gravadas_concluidas", return_value=0),
    ):
        list_historico_concluidas(limit=10, offset=0)

    count_sql, count_params = mock_db.execute_query.call_args_list[0][0]
    list_sql, list_params = mock_db.execute_query.call_args_list[1][0]
    assert "DesmembradaDeId IS NULL" in count_sql
    assert "c.DesmembradaDeId" in count_sql
    assert count_sql.count("%s") == len(count_params) == 2
    assert "roots_c.root_id = c.DesmembradaDeId" in list_sql
    assert list_sql.count("%s") == len(list_params) == 4
