"""Testes do serviço Gravação Pendente."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from routers.andamento_helpers import format_gravacao_pendente_obs
from services.gravacao_pendente_service import (
    SITUACAO_GRAVACAO_PENDENTE,
    adjust_cota_inicial_chapas,
    build_historico_cota_summary,
    delete_controle_lancamento,
    estimate_chapas_from_validated_arquivos,
    get_cota_inicial_chapas,
    get_total_chapas_gravadas_concluidas,
    is_gravacao_pendente_situacao,
    update_cota_inicial_chapas,
    validate_chapas_input,
)


def test_is_gravacao_pendente_situacao():
    assert is_gravacao_pendente_situacao(SITUACAO_GRAVACAO_PENDENTE)
    assert not is_gravacao_pendente_situacao("Gravação Externa")


def test_validate_chapas_input_requires_positive():
    with pytest.raises(ValueError, match="ao menos uma"):
        validate_chapas_input([])
    with pytest.raises(ValueError, match="inválida"):
        validate_chapas_input([{"maquina": "M1", "quantidade": 0}])
    result = validate_chapas_input([{"maquina": "Gravadora A", "quantidade": 10}])
    assert result[0]["quantidade"] == 10


def test_validate_chapas_input_allow_empty():
    assert validate_chapas_input([], allow_empty=True) == []
    assert validate_chapas_input([{"maquina": "", "quantidade": 1}], allow_empty=True) == []


def test_arquivos_are_pdf_only():
    from services.gravacao_pendente_service import arquivos_are_pdf_only

    assert arquivos_are_pdf_only([]) is False
    assert arquivos_are_pdf_only([{"nome": "a.pdf"}]) is True
    assert arquivos_are_pdf_only([{"nome": "a.pdf"}, {"nome": "b.tif"}]) is False
    assert arquivos_are_pdf_only([{"nome": "a.tif"}]) is False


@patch("services.gravacao_pendente_service.db")
def test_reactivate_pendente_after_externa_cancel(mock_db):
    from services.gravacao_pendente_service import reactivate_pendente_after_externa_cancel

    mock_db.execute_query.side_effect = [
        [],  # get_active_pendente_session
        [{"id": 42}],  # OrigemPendenteId
    ]

    def fake_tx(operations):
        cursor = MagicMock()
        cursor.rowcount = 1
        return [operation(cursor) for operation in operations]

    mock_db.execute_transaction.side_effect = fake_tx

    result = reactivate_pendente_after_externa_cancel(2026, 100)
    assert result == 42
    mock_db.execute_transaction.assert_called_once()


@patch("services.gravacao_pendente_service.db")
def test_reactivate_pendente_skips_when_ativa_exists(mock_db):
    from services.gravacao_pendente_service import reactivate_pendente_after_externa_cancel

    mock_db.execute_query.return_value = [
        {
            "Id": 1,
            "OsAno": 2026,
            "OsNro": 100,
            "CodStatus": "x",
            "LancadoPorPonto": "1",
            "LancadoPorNome": None,
            "Cliente": None,
            "Status": "ativa",
            "EnviadaEm": None,
            "EnviadaPorPonto": None,
            "CriadoEm": None,
        }
    ]
    assert reactivate_pendente_after_externa_cancel(2026, 100) is None
    mock_db.execute_transaction.assert_not_called()


@patch("services.gravacao_pendente_service.db")
def test_delete_controle_lancamento_removes_only_parent_row(mock_db):
    executed: list[str] = []

    def fake_tx(operations):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"Id": 42}
        cursor.execute.side_effect = lambda sql, _params=None: executed.append(
            " ".join(str(sql).split())
        )
        return [operation(cursor) for operation in operations]

    mock_db.execute_transaction.side_effect = fake_tx

    assert delete_controle_lancamento(42) == 42
    delete_sql = [sql for sql in executed if sql.startswith("DELETE")]
    assert delete_sql == ["DELETE FROM tab_os_gravacao_pendente WHERE Id = %s"]


def test_controle_delete_requires_specific_permission():
    from types import SimpleNamespace

    from routers.gravacao_pendente_routes import _require_controle_delete_permission

    request = SimpleNamespace(
        state=SimpleNamespace(sagra_permissions={"sb_gravacao_pendente": True})
    )
    with pytest.raises(HTTPException) as exc:
        _require_controle_delete_permission(request)
    assert exc.value.status_code == 403

    request.state.sagra_permissions["sb_gravacao_pendente_excluir"] = True
    _require_controle_delete_permission(request)


def test_lancar_externa_requires_specific_permission():
    from types import SimpleNamespace

    from routers.gravacao_pendente_routes import _require_lancar_externa_permission

    request = SimpleNamespace(
        state=SimpleNamespace(sagra_permissions={"sb_gravacao_pendente": True})
    )
    with pytest.raises(HTTPException) as exc:
        _require_lancar_externa_permission(request)
    assert exc.value.status_code == 403
    assert "lançar" in exc.value.detail.lower()

    request.state.sagra_permissions["sb_gravacao_externa_lancar"] = True
    _require_lancar_externa_permission(request)


def test_insert_pendente_session_persists_observacao():
    from services.gravacao_pendente_service import insert_pendente_session_cursor

    cursor = MagicMock()
    cursor.lastrowid = 8
    captured: list[tuple[str, tuple]] = []

    def execute(sql, params=None):
        captured.append((" ".join(str(sql).split()), params or ()))

    cursor.execute.side_effect = execute

    insert_pendente_session_cursor(
        cursor,
        ano=2026,
        os_id=100,
        cod_status="001002026-03",
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
        validated_chapas=[{"maquina": "M1", "quantidade": 2}],
        observacao="  urgente frente  ",
    )
    insert_sql = next(s for s, _ in captured if "INSERT INTO tab_os_gravacao_pendente" in s)
    assert "Observacao" in insert_sql
    insert_params = next(p for s, p in captured if "INSERT INTO tab_os_gravacao_pendente" in s)
    assert insert_params[-1] == "urgente frente"


def test_insert_pendente_session_blank_observacao_is_null():
    from services.gravacao_pendente_service import insert_pendente_session_cursor

    cursor = MagicMock()
    cursor.lastrowid = 8
    captured: list[tuple] = []

    def execute(sql, params=None):
        captured.append((" ".join(str(sql).split()), params or ()))

    cursor.execute.side_effect = execute

    insert_pendente_session_cursor(
        cursor,
        ano=2026,
        os_id=100,
        cod_status="001002026-03",
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
        observacao="   ",
    )
    insert_params = next(p for s, p in captured if "INSERT INTO tab_os_gravacao_pendente" in s)
    assert insert_params[-1] is None


@patch("services.gravacao_pendente_service.build_pendente_detail", return_value={"id": 1})
@patch("services.gravacao_pendente_service.list_active_pendente_by_juntada")
@patch("services.gravacao_pendente_service.get_active_pendente_session")
@patch("services.gravacao_pendente_service.db")
def test_update_observacao_syncs_juntada(mock_db, get_session, list_juntada, _build):
    from services.gravacao_pendente_service import update_pendente_session_observacao

    session = {
        "id": 1,
        "status": "ativa",
        "juntada_grupo_id": "g1",
        "os_ano": 2026,
        "os_nro": 100,
    }
    get_session.return_value = session
    list_juntada.return_value = [{"id": 1}, {"id": 2}]
    executed: list[tuple] = []

    def fake_tx(ops):
        cursor = MagicMock()

        def execute(sql, params=None):
            executed.append((" ".join(str(sql).split()), params))

        cursor.execute.side_effect = execute
        return [op(cursor) for op in ops]

    mock_db.execute_transaction.side_effect = fake_tx

    update_pendente_session_observacao(ano=2026, os_id=100, observacao="  nova obs  ")
    updates = [p for s, p in executed if "SET Observacao" in s]
    assert updates == [("nova obs", 1), ("nova obs", 2)]


def test_observacao_edit_requires_pendente_permission():
    from types import SimpleNamespace

    from routers.gravacao_pendente_routes import _require_observacao_edit_permission

    request = SimpleNamespace(state=SimpleNamespace(sagra_permissions={}))
    with pytest.raises(HTTPException) as exc:
        _require_observacao_edit_permission(request)
    assert exc.value.status_code == 403


@patch("routers.gravacao_pendente_routes.fetch_user_fornecedor", return_value=True)
def test_observacao_edit_rejects_fornecedor(_mock_fornecedor):
    from security.session_auth import SessionData
    from types import SimpleNamespace

    from routers.gravacao_pendente_routes import _require_observacao_edit_permission

    request = SimpleNamespace(
        state=SimpleNamespace(
            sagra_permissions={"sb_gravacao_pendente": True},
            sagra_session=SessionData(
                ponto=918713, nome="Forn", ip="127.0.0.1", iat=1
            ),
        )
    )
    with pytest.raises(HTTPException) as exc:
        _require_observacao_edit_permission(request)
    assert exc.value.status_code == 403
    assert "Fornecedor" in exc.value.detail


@patch("routers.gravacao_pendente_routes.fetch_user_fornecedor", return_value=False)
def test_observacao_edit_allows_internal(_mock_fornecedor):
    from security.session_auth import SessionData
    from types import SimpleNamespace

    from routers.gravacao_pendente_routes import _require_observacao_edit_permission

    request = SimpleNamespace(
        state=SimpleNamespace(
            sagra_permissions={"sb_gravacao_pendente": True},
            sagra_session=SessionData(
                ponto=918713, nome="Op", ip="127.0.0.1", iat=1
            ),
        )
    )
    _require_observacao_edit_permission(request)


def test_format_gravacao_pendente_obs():
    text = format_gravacao_pendente_obs(
        [{"maquina": "M1", "quantidade": 5}],
        "Obs extra",
    )
    assert "Arquivos:" not in text
    assert "Chapas por máquina:" in text
    assert "M1: 5" in text
    assert "Obs extra" in text


def test_format_gravacao_pendente_obs_empty_chapas():
    text = format_gravacao_pendente_obs([], "Só PDF")
    assert "Chapas por máquina:" in text
    assert "(não informado)" in text
    assert "Só PDF" in text


def test_estimate_chapas_counts_tif_and_ignores_pdf_when_mixed():
    result = estimate_chapas_from_validated_arquivos(
        [
            {"absolute_path": r"\\server\a.tif", "nome": "a.tif"},
            {"absolute_path": r"\\server\b.tif", "nome": "b.tif"},
            {"absolute_path": r"\\server\espelho.pdf", "nome": "espelho.pdf"},
        ]
    )
    assert result["total_chapas"] == 2
    assert result["fonte"] == "tif"
    assert result["pdf_page_count"] is None
    assert result.get("expected_plate_count") is None


def test_estimate_chapas_pdf_only_when_no_tif():
    result = estimate_chapas_from_validated_arquivos(
        [{"absolute_path": r"\\server\espelho.pdf", "nome": "espelho.pdf"}]
    )
    assert result["fonte"] in ("pdf", "none")
    if result["fonte"] == "pdf":
        assert result["pdf_page_count"] == result["total_chapas"]
        assert result["pdf_page_count"] is not None
    else:
        assert result["pdf_page_count"] is None


def test_render_tif_1bit_preview():
    from io import BytesIO

    from PIL import Image

    from services.gravacao_externa_service import (
        _downscale_image_for_preview,
        render_tif_preview_png,
    )

    buf = BytesIO()
    Image.new("1", (8, 8), 1).save(buf, format="TIFF")
    buf.seek(0)
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as tmp:
        tmp.write(buf.getvalue())
        tmp.flush()
        png = render_tif_preview_png(tmp.name)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"

    large = Image.new("1", (8000, 6000), 0)
    reduced = _downscale_image_for_preview(large, 2400)
    assert max(reduced.size) <= 2400
    assert reduced.mode == "1"


@patch("services.gravacao_pendente_service.db")
def test_get_cota_inicial_chapas(mock_db):
    mock_db.execute_query.return_value = [{"CotaInicialChapas": 42}]
    assert get_cota_inicial_chapas() == 42


@patch("services.gravacao_pendente_service.ensure_controle_list_desde", return_value="2026-01-01")
@patch("services.gravacao_pendente_service.db")
def test_cota_debits_only_concluded_gravacoes(mock_db, _desde):
    mock_db.execute_query.return_value = [{"total_chapas": 12}]

    assert get_total_chapas_gravadas_concluidas() == 12
    sql = " ".join(mock_db.execute_query.call_args.args[0].split())
    assert "ge.Status = 'concluida'" in sql
    assert "gp.Status <> 'cancelada'" in sql


@patch("services.gravacao_pendente_service.get_cota_inicial_chapas", return_value=5)
@patch("services.gravacao_pendente_service.db")
def test_update_cota_inicial_chapas_modes(mock_db, _mock_get):
    mock_db.execute_transaction.side_effect = lambda ops: [ops[0](MagicMock())]

    assert update_cota_inicial_chapas(
        ponto="918713", observacao="set absoluto", mode="set", valor=10,
    ) == 10
    assert update_cota_inicial_chapas(
        ponto="918713", observacao="inc 3", mode="inc", valor=3,
    ) == 8
    assert update_cota_inicial_chapas(
        ponto="918713", observacao="dec 2", mode="dec", valor=2,
    ) == 3
    assert mock_db.execute_transaction.call_count == 3


@patch("services.gravacao_pendente_service.get_cota_inicial_chapas", return_value=0)
@patch("services.gravacao_pendente_service.db")
def test_update_cota_inicial_dec_does_not_go_below_zero(mock_db, _mock_get):
    mock_db.execute_transaction.side_effect = lambda ops: [ops[0](MagicMock())]
    assert update_cota_inicial_chapas(
        ponto="918713", observacao="dec abaixo de zero", mode="dec", valor=1,
    ) == 0


def test_update_cota_inicial_requires_observacao():
    with pytest.raises(ValueError, match="observacao"):
        update_cota_inicial_chapas(
            ponto="918713", observacao="   ", mode="inc", valor=1,
        )


def test_update_cota_inicial_invalid_mode_or_valor():
    with pytest.raises(ValueError, match="mode"):
        update_cota_inicial_chapas(
            ponto="918713", observacao="ok", mode="add", valor=1,
        )
    with pytest.raises(ValueError, match="valor"):
        update_cota_inicial_chapas(
            ponto="918713", observacao="ok", mode="inc", valor=-1,
        )


@patch("services.gravacao_pendente_service.update_cota_inicial_chapas", return_value=6)
def test_adjust_cota_inicial_wrapper_maps_delta(mock_update):
    assert adjust_cota_inicial_chapas(delta=1, ponto="918713") == 6
    mock_update.assert_called_once_with(
        ponto="918713",
        observacao="Ajuste rápido ±1",
        mode="inc",
        valor=1,
    )

    mock_update.reset_mock()
    mock_update.return_value = 4
    assert adjust_cota_inicial_chapas(delta=-1, ponto="918713") == 4
    mock_update.assert_called_once_with(
        ponto="918713",
        observacao="Ajuste rápido ±1",
        mode="dec",
        valor=1,
    )


def test_adjust_cota_inicial_invalid_delta():
    with pytest.raises(ValueError, match="delta"):
        adjust_cota_inicial_chapas(delta=2, ponto="918713")


def test_insert_pendente_session_cancels_previous_active():
    """Relançar Gravação Pendente cancela a sessão ativa anterior antes de inserir a nova."""
    from services.gravacao_pendente_service import insert_pendente_session_cursor

    cursor = MagicMock()
    cursor.lastrowid = 55
    captured_sql: list[str] = []

    def execute(sql, params=None):
        captured_sql.append(" ".join(str(sql).split()))

    cursor.execute.side_effect = execute

    session_id = insert_pendente_session_cursor(
        cursor,
        ano=2026,
        os_id=100,
        cod_status="001002026-03",
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
        validated_chapas=[{"maquina": "M1", "quantidade": 2}],
    )
    assert session_id == 55
    assert any("UPDATE tab_os_gravacao_pendente" in s and "cancelada" in s for s in captured_sql)
    assert any(
        "INSERT INTO tab_os_gravacao_pendente" in s and "JuntadaGrupoId" in s
        for s in captured_sql
    )
    assert any(
        "INSERT INTO tab_os_gravacao_pendente" in s and "Observacao" in s
        for s in captured_sql
    )
    assert any("INSERT INTO tab_os_gravacao_pendente_arquivo" in s for s in captured_sql)
    assert any("INSERT INTO tab_os_gravacao_pendente_chapa" in s for s in captured_sql)


@patch(
    "services.gravacao_pendente_service.get_chapas_gravadas_concluidas_por_maquina",
    return_value={"Komori": 10, "SM74": 15, "PM52": 5},
)
@patch(
    "services.gravacao_pendente_service.aggregate_cotas_by_maquina_from_fornecedores",
    return_value={"Komori": 30, "SM74": 20, "PM52": 5},
)
@patch("services.gravacao_pendente_service.get_total_chapas_gravadas_concluidas", return_value=30)
def test_build_historico_cota_summary_sums_fornecedor_cotas(_mock_total, _mock_agg, _mock_por_maq):
    summary = build_historico_cota_summary()
    assert summary["cota_inicial_chapas"] == 55  # soma fornecedores, não cota_inicial
    assert summary["total_chapas_geral"] == 30
    assert summary["chapas_restantes"] == 25
    assert summary["maquinas"] == [
        {"maquina": "Komori", "cota_chapas": 30, "chapas_restantes": 20},
        {"maquina": "SM74", "cota_chapas": 20, "chapas_restantes": 5},
        {"maquina": "PM52", "cota_chapas": 5, "chapas_restantes": 0},
    ]


@patch("services.gravacao_pendente_service.list_fornecedores")
@patch("services.gravacao_pendente_service.db")
def test_aggregate_dedupes_duplicate_ponto_formats(mock_db, mock_fornecedores):
    from services.gravacao_pendente_service import aggregate_cotas_by_maquina_from_fornecedores

    mock_fornecedores.return_value = [{"ponto": "999.999", "nome": "PhBureau"}]
    # Duplicata clássica: formatado + só dígitos → modal mostra 1625, SUM bruto era 3250
    mock_db.execute_query.return_value = [
        {"FornecedorPonto": "999.999", "Maquina": "Komori", "CotaChapas": 1625},
        {"FornecedorPonto": "999999", "Maquina": "Komori", "CotaChapas": 1625},
        {"FornecedorPonto": "999.999", "Maquina": "PM52", "CotaChapas": 100},
        {"FornecedorPonto": "999999", "Maquina": "PM52", "CotaChapas": 100},
        {"FornecedorPonto": "999.999", "Maquina": "SM74", "CotaChapas": 0},
    ]
    result = aggregate_cotas_by_maquina_from_fornecedores()
    assert result == {"Komori": 1625, "SM74": 0, "PM52": 100}


@patch("services.gravacao_pendente_service.db")
def test_resolve_fornecedor_ponto_auto_selects_single(mock_db):
    from fastapi import HTTPException

    from services.gravacao_pendente_service import resolve_fornecedor_ponto

    mock_db.execute_query.return_value = [{"Ponto": "918713", "Nome": "Forn A"}]
    assert resolve_fornecedor_ponto(None) == "918.713"

    mock_db.execute_query.return_value = []
    with pytest.raises(HTTPException) as exc:
        resolve_fornecedor_ponto(None)
    assert exc.value.status_code == 400


@patch("services.gravacao_preview_cache_service.enqueue_preview_warmup")
@patch("services.gravacao_pendente_service.build_session_detail", return_value={"status": "pendente"})
@patch("services.gravacao_pendente_service.get_active_session", return_value={"id": 99})
@patch("services.gravacao_pendente_service.send_gravacao_notification_email")
@patch("services.gravacao_pendente_service._notify_enviar_gravacao_externa")
@patch("services.gravacao_pendente_service.insert_session_with_arquivos_cursor")
@patch("services.gravacao_pendente_service.build_pendente_detail")
@patch("services.gravacao_pendente_service.get_active_pendente_session")
@patch("services.gravacao_pendente_service._lookup_usuario_nome", return_value="Fornecedor")
@patch("services.gravacao_pendente_service.resolve_fornecedor_ponto", return_value="222.222")
@patch("services.gravacao_pendente_service.db")
def test_enviar_para_externa_emails_when_andamento_is_created(
    mock_db,
    _resolve_fornecedor,
    _lookup_nome,
    get_pendente,
    build_pendente,
    _insert_externa,
    _notify,
    email,
    _get_externa,
    _build_externa,
    _warmup,
):
    from services.gravacao_pendente_service import enviar_para_gravacao_externa

    get_pendente.return_value = {
        "id": 10,
        "os_ano": 2026,
        "os_nro": 100,
        "lancado_por_ponto": "918.713",
        "lancado_por_nome": "Usuário",
    }
    build_pendente.return_value = {
        "arquivos": [{"nome": "a.pdf", "absolute_path": r"\\srv\a.pdf"}]
    }

    captured: dict = {}

    def fake_tx(operations):
        cursor = MagicMock()
        cursor.rowcount = 1
        cursor.fetchone.return_value = {"max_cod": "001002026-01"}

        def execute(sql, params=None):
            sql_norm = " ".join(str(sql).split())
            if "UPDATE tabAndamento SET UltimoStatus = 0" in sql_norm:
                captured["demote_params"] = params
            if "INSERT INTO tabAndamento" in sql_norm:
                captured["insert_sql"] = sql_norm
                captured["insert_params"] = params

        cursor.execute.side_effect = execute
        with patch("routers.os_audit_service.log_andamento_added"):
            return [operation(cursor) for operation in operations]

    mock_db.execute_transaction.side_effect = fake_tx

    enviar_para_gravacao_externa(
        ano=2026,
        os_id=100,
        operador_ponto="111111",
        fornecedor_ponto="222222",
    )

    assert captured["demote_params"] == (100, 2026)
    assert "NOW(), 1," in captured["insert_sql"]
    assert captured["insert_params"][3] == "Saída p/"
    assert captured["insert_params"][4] == "Grav. Externa"
    assert "Chapas por máquina:" in captured["insert_params"][5]
    email.assert_called_once_with(
        event="encaminhada",
        ano=2026,
        os_id=100,
        target_ponto="222.222",
        target_nome="Fornecedor",
        operador_ponto="111.111",
    )


@patch("services.gravacao_pendente_service.send_gravacao_notification_email")
@patch("services.gravacao_pendente_service.build_pendente_detail")
@patch("services.gravacao_pendente_service.get_active_pendente_session")
@patch("services.gravacao_pendente_service.resolve_fornecedor_ponto", return_value="222.222")
@patch("services.gravacao_pendente_service.db")
def test_enviar_para_externa_rejects_concurrent_duplicate_before_email(
    mock_db,
    _resolve_fornecedor,
    get_pendente,
    build_pendente,
    email,
):
    from services.gravacao_pendente_service import enviar_para_gravacao_externa

    get_pendente.return_value = {
        "id": 10,
        "os_ano": 2026,
        "os_nro": 100,
        "lancado_por_ponto": "918.713",
        "lancado_por_nome": "Usuário",
    }
    build_pendente.return_value = {
        "arquivos": [{"nome": "a.pdf", "absolute_path": r"\\srv\a.pdf"}]
    }

    def fake_tx(operations):
        cursor = MagicMock()
        cursor.rowcount = 0
        return [operation(cursor) for operation in operations]

    mock_db.execute_transaction.side_effect = fake_tx

    with pytest.raises(HTTPException) as exc:
        enviar_para_gravacao_externa(
            ano=2026,
            os_id=100,
            operador_ponto="111111",
            fornecedor_ponto="222222",
        )

    assert exc.value.status_code == 409
    email.assert_not_called()


@patch("services.gravacao_pendente_service.db")
def test_list_historico_uses_pendente_base(mock_db):
    from datetime import datetime

    from services.gravacao_pendente_service import list_historico_concluidas

    mock_db.execute_query.side_effect = [
        [{"cnt": 1}],
        [
            {
                "gravacao_pendente_id": 10,
                "gravacao_externa_id": 20,
                "ano": 2026,
                "nr_os": 100,
                "juntada_grupo_id": None,
                "lancado_por_ponto": "111",
                "lancado_por_nome": "A",
                "criado_em": None,
                "enviada_em": None,
                "fornecedor_ponto": "918.713",
                "fornecedor_nome": "Forn",
                "iniciado_em": None,
                "iniciado_por_ponto": None,
                "concluida_em": None,
                "entrega_lancada_em": None,
                "recebido_por_ponto": None,
                "recebido_por_nome": None,
                "pagamento_nf_em": None,
                "solicitante": "Cli",
                "titulo": "Tit",
                "total_chapas_os": 3,
            }
        ],
        [{"Maquina": "M1", "QuantidadeChapas": 3}],
    ]
    with (
        patch(
            "services.gravacao_pendente_service.ensure_controle_list_desde",
            return_value=datetime(2026, 7, 14, 18, 0, 0),
        ),
        patch(
            "services.gravacao_pendente_service.get_total_chapas_gravadas_concluidas",
            return_value=3,
        ),
    ):
        items, total, total_chapas = list_historico_concluidas(limit=10, offset=0)

    assert total == 1
    assert total_chapas == 3
    assert items[0]["gravacao_pendente_id"] == 10
    assert items[0]["fornecedor_ponto"] == "918.713"
    assert items[0]["juntada_grupo_id"] is None
    assert items[0]["membros"] == [{"nr_os": 100, "ano": 2026}]
    count_sql = mock_db.execute_query.call_args_list[0][0][0]
    list_sql = mock_db.execute_query.call_args_list[1][0][0]
    assert "GROUP BY gp.OsAno, gp.OsNro" in count_sql
    assert "latest_gp" in list_sql
    assert "CriadoEm >=" in list_sql or "CriadoEm >=" in count_sql
    assert "REPLACE(REPLACE(IFNULL(ge.FornecedorPonto" in list_sql
    assert "REPLACE(REPLACE(IFNULL(ge.RecebidoPorPonto" in list_sql
    assert "AS UNSIGNED\n                ),\n                0\n            )" in list_sql
    assert "0," not in list_sql.split("NULLIF(")[1].split("LEFT JOIN")[0]


@patch("services.gravacao_pendente_service.db")
def test_list_historico_enriches_juntada_membros(mock_db):
    from datetime import datetime

    from services.gravacao_pendente_service import list_historico_concluidas

    mock_db.execute_query.side_effect = [
        [{"cnt": 1}],
        [
            {
                "gravacao_pendente_id": 10,
                "gravacao_externa_id": 20,
                "ano": 2026,
                "nr_os": 100,
                "juntada_grupo_id": "grp-1",
                "lancado_por_ponto": "111",
                "lancado_por_nome": "A",
                "criado_em": None,
                "enviada_em": None,
                "fornecedor_ponto": None,
                "fornecedor_nome": None,
                "iniciado_em": None,
                "iniciado_por_ponto": None,
                "concluida_em": None,
                "entrega_lancada_em": None,
                "recebido_por_ponto": None,
                "recebido_por_nome": None,
                "pagamento_nf_em": None,
                "solicitante": "Cli",
                "titulo": "Tit",
                "total_chapas_os": 2,
            }
        ],
        [{"Maquina": "Komori", "QuantidadeChapas": 2}],
        [
            {"nr_os": 100, "ano": 2026, "juntada_grupo_id": "grp-1"},
            {"nr_os": 200, "ano": 2026, "juntada_grupo_id": "grp-1"},
        ],
    ]
    with (
        patch(
            "services.gravacao_pendente_service.ensure_controle_list_desde",
            return_value=datetime(2026, 7, 14, 18, 0, 0),
        ),
        patch(
            "services.gravacao_pendente_service.get_total_chapas_gravadas_concluidas",
            return_value=2,
        ),
    ):
        items, _total, _chapas = list_historico_concluidas(limit=10, offset=0)

    assert items[0]["juntada_grupo_id"] == "grp-1"
    assert {m["nr_os"] for m in items[0]["membros"]} == {100, 200}


@patch("services.gravacao_pendente_service.resolve_fornecedor_ponto", return_value="918.713")
@patch("services.gravacao_pendente_service.db")
def test_update_controle_lancamento_replicates_juntada(mock_db, _resolve):
    from datetime import datetime

    from services.gravacao_pendente_service import update_controle_lancamento

    executed: list[tuple[str, tuple]] = []

    def fake_tx(operations):
        cursor = MagicMock()
        externa_seq = iter([{"Id": 100}, {"Id": 101}])

        def execute(sql, params=None):
            executed.append((" ".join(str(sql).split()), params or ()))

        def fetchone():
            last_sql = executed[-1][0] if executed else ""
            if "FOR UPDATE" in last_sql:
                return {"Id": 10, "JuntadaGrupoId": "grp-1"}
            if "ORDER BY Id DESC" in last_sql:
                return next(externa_seq)
            return None

        def fetchall():
            return [{"Id": 10}, {"Id": 11}]

        cursor.execute.side_effect = execute
        cursor.fetchone.side_effect = fetchone
        cursor.fetchall.side_effect = fetchall
        return [operation(cursor) for operation in operations]

    mock_db.execute_transaction.side_effect = fake_tx

    result = update_controle_lancamento(
        gravacao_pendente_id=10,
        chapas=[{"maquina": "Komori", "quantidade": 5}],
        criado_em=datetime(2026, 7, 1, 10, 0, 0),
        enviada_em=datetime(2026, 7, 2, 10, 0, 0),
        fornecedor_ponto="918713",
        concluida_em=datetime(2026, 7, 3, 10, 0, 0),
        entrega_lancada_em=datetime(2026, 7, 4, 10, 0, 0),
        recebido_por_ponto="111",
        recebido_por_nome="Recebedor",
        pagamento_nf_em=datetime(2026, 7, 5, 12, 0, 0),
    )

    assert result["gravacao_pendente_id"] == 10
    assert result["updated_pendente_ids"] == [10, 11]
    assert result["updated_externa_ids"] == [100, 101]
    assert result["juntada_grupo_id"] == "grp-1"
    assert result["total_chapas"] == 5
    assert result["chapas"] == [{"maquina": "Komori", "quantidade": 5}]

    chapa_deletes = [e for e in executed if e[0].startswith("DELETE FROM tab_os_gravacao_pendente_chapa")]
    assert len(chapa_deletes) == 2
    chapa_inserts = [e for e in executed if "INSERT INTO tab_os_gravacao_pendente_chapa" in e[0]]
    assert len(chapa_inserts) == 2
    externa_updates = [e for e in executed if "UPDATE tab_os_gravacao_externa" in e[0]]
    assert len(externa_updates) == 2
    assert all("PagamentoNfEm" in e[0] for e in externa_updates)


@patch("services.gravacao_pendente_service.db")
def test_update_controle_lancamento_solo_without_externa(mock_db):
    from datetime import datetime

    from services.gravacao_pendente_service import update_controle_lancamento

    executed: list[str] = []

    def fake_tx(operations):
        cursor = MagicMock()
        state = {"n": 0}

        def execute(sql, params=None):
            executed.append(" ".join(str(sql).split()))

        def fetchone():
            state["n"] += 1
            if state["n"] == 1:
                return {"Id": 42, "JuntadaGrupoId": None}
            return None  # no externa

        cursor.execute.side_effect = execute
        cursor.fetchone.side_effect = fetchone
        cursor.fetchall.return_value = []
        return [operation(cursor) for operation in operations]

    mock_db.execute_transaction.side_effect = fake_tx

    result = update_controle_lancamento(
        gravacao_pendente_id=42,
        chapas=[{"maquina": "SM74", "quantidade": 2}],
        criado_em=datetime(2026, 8, 1),
        enviada_em=None,
        fornecedor_ponto=None,
        concluida_em=None,
        entrega_lancada_em=None,
        recebido_por_ponto=None,
        recebido_por_nome=None,
        pagamento_nf_em=None,
    )
    assert result["updated_pendente_ids"] == [42]
    assert result["updated_externa_ids"] == []
    assert not any("UPDATE tab_os_gravacao_externa" in sql for sql in executed)


def test_chapas_gravadas_sql_dedupes_juntada():
    from services.gravacao_pendente_service import _chapas_gravadas_concluidas_base_sql

    sql = _chapas_gravadas_concluidas_base_sql()
    assert "COALESCE(gp2.JuntadaGrupoId, CONCAT('solo-', gp2.Id))" in sql
    assert "MIN(gp2.Id)" in sql


@patch("services.gravacao_pendente_service.get_cota_inicial_chapas", return_value=10)
@patch(
    "services.gravacao_pendente_service.aggregate_cotas_by_maquina_from_fornecedores",
    return_value={"Komori": 30, "SM74": 20, "PM52": 5},
)
@patch("services.gravacao_pendente_service.db")
def test_recalc_cotas_from_fornecedores_sums_cascade(mock_db, _mock_agg, _mock_get):
    from services.gravacao_pendente_service import recalc_cotas_from_fornecedores

    mock_db.execute_transaction.side_effect = lambda ops: [ops[0](MagicMock())]

    result = recalc_cotas_from_fornecedores(ponto_atualizador="918713")
    assert result["cota_inicial_chapas"] == 55
    assert result["maquinas"] == [
        {"maquina": "Komori", "cota_chapas": 30},
        {"maquina": "SM74", "cota_chapas": 20},
        {"maquina": "PM52", "cota_chapas": 5},
    ]
    mock_db.execute_transaction.assert_called_once()
    assert mock_db.execute_query.call_count == 3  # um UPDATE/INSERT por máquina


@patch("services.gravacao_pendente_service.get_cota_inicial_chapas", return_value=55)
@patch(
    "services.gravacao_pendente_service.aggregate_cotas_by_maquina_from_fornecedores",
    return_value={"Komori": 30, "SM74": 20, "PM52": 5},
)
@patch("services.gravacao_pendente_service.db")
def test_recalc_skips_log_when_global_unchanged(mock_db, _mock_agg, _mock_get):
    from services.gravacao_pendente_service import recalc_cotas_from_fornecedores

    result = recalc_cotas_from_fornecedores(ponto_atualizador="918713")
    assert result["cota_inicial_chapas"] == 55
    mock_db.execute_transaction.assert_not_called()


@patch(
    "services.gravacao_pendente_service.recalc_cotas_from_fornecedores",
    return_value={"cota_inicial_chapas": 40, "maquinas": []},
)
@patch(
    "services.gravacao_pendente_service.resolve_fornecedor_ponto",
    return_value="111.111",
)
@patch("services.gravacao_pendente_service.db")
def test_upsert_fornecedor_cota_recalculates(mock_db, _mock_resolve, mock_recalc):
    from services.gravacao_pendente_service import upsert_fornecedor_cota

    out = upsert_fornecedor_cota("111.111", "Komori", 15, "918713")
    assert out["ponto"] == "111.111"
    assert out["maquina"] == "Komori"
    assert out["cota_chapas"] == 15
    mock_recalc.assert_called_once()
    insert_sql = mock_db.execute_query.call_args[0][0]
    assert "FornecedorPonto" in insert_sql
    assert "Maquina" in insert_sql


@patch(
    "services.gravacao_pendente_service.resolve_fornecedor_ponto",
    return_value="111.111",
)
@patch("services.gravacao_pendente_service.db")
def test_upsert_fornecedor_cota_can_skip_recalc(mock_db, _mock_resolve):
    from services.gravacao_pendente_service import upsert_fornecedor_cota

    with patch(
        "services.gravacao_pendente_service.recalc_cotas_from_fornecedores"
    ) as mock_recalc:
        upsert_fornecedor_cota("111.111", "SM74", 8, "918713", recalc=False)
        mock_recalc.assert_not_called()


@patch("services.gravacao_pendente_service.db")
def test_upsert_maquina_config_updates_only_price(mock_db):
    from services.gravacao_pendente_service import upsert_maquina_config

    mock_db.execute_query.side_effect = [None, [{"CotaChapas": 42}]]
    out = upsert_maquina_config("Komori", 12.5, "918713")
    assert out["preco_chapa"] == 12.5
    assert out["cota_chapas"] == 42
    upsert_sql = mock_db.execute_query.call_args_list[0][0][0]
    assert "PrecoChapa = VALUES(PrecoChapa)" in upsert_sql
    assert "CotaChapas = VALUES(CotaChapas)" not in upsert_sql


@patch("services.gravacao_pendente_service.list_fornecedores")
@patch("services.gravacao_pendente_service.build_historico_cota_summary")
@patch("services.gravacao_pendente_service.db")
def test_get_detalhes_config_fornecedor_cotas_by_maquina(
    mock_db, mock_summary, mock_fornecedores,
):
    from services.gravacao_pendente_service import get_detalhes_config

    mock_summary.return_value = {
        "cota_inicial_chapas": 50,
        "total_chapas_geral": 0,
        "chapas_restantes": 50,
    }
    mock_fornecedores.return_value = [
        {"ponto": "111.111", "nome": "F1"},
        {"ponto": "222.222", "nome": "F2"},
    ]
    mock_db.execute_query.side_effect = [
        [
            {"Maquina": "Komori", "CotaChapas": 30, "PrecoChapa": 1.5},
            {"Maquina": "SM74", "CotaChapas": 20, "PrecoChapa": 2},
            {"Maquina": "PM52", "CotaChapas": 0, "PrecoChapa": 0},
        ],
        [
            {
                "FornecedorPonto": "111.111",
                "Maquina": "Komori",
                "CotaChapas": 10,
                "PrecoChapa": 1.1,
            },
            {
                "FornecedorPonto": "222.222",
                "Maquina": "Komori",
                "CotaChapas": 20,
                "PrecoChapa": 2.2,
            },
            {
                "FornecedorPonto": "111.111",
                "Maquina": "SM74",
                "CotaChapas": 20,
                "PrecoChapa": 1.8,
            },
        ],
    ]
    details = get_detalhes_config()
    assert details["cota_inicial_chapas"] == 50
    f1 = next(f for f in details["fornecedor_cotas"] if f["ponto"] == "111.111")
    assert f1["cotas"]["Komori"] == 10
    assert f1["cotas"]["SM74"] == 20
    assert f1["cotas"]["PM52"] == 0
    assert f1["precos"]["Komori"] == 1.1
    assert f1["precos"]["SM74"] == 1.8
    assert f1["precos"]["PM52"] == 0.0


@patch(
    "services.gravacao_pendente_service.recalc_cotas_from_fornecedores",
    return_value={"cota_inicial_chapas": 40, "maquinas": []},
)
@patch(
    "services.gravacao_pendente_service.resolve_fornecedor_ponto",
    return_value="111.111",
)
@patch("services.gravacao_pendente_service.db")
def test_upsert_fornecedor_cota_with_preco(mock_db, _mock_resolve, mock_recalc):
    from services.gravacao_pendente_service import upsert_fornecedor_cota

    out = upsert_fornecedor_cota(
        "111.111", "Komori", 15, "918713", preco_chapa=9.5
    )
    assert out["cota_chapas"] == 15
    assert out["preco_chapa"] == 9.5
    mock_recalc.assert_called_once()
    insert_sql = mock_db.execute_query.call_args[0][0]
    assert "PrecoChapa" in insert_sql
    params = mock_db.execute_query.call_args[0][1]
    assert 9.5 in params


@patch("services.gravacao_pendente_schema.db")
def test_migrate_fornecedor_cota_legacy_to_maquina_pk(mock_db):
    from services.gravacao_pendente_schema import _migrate_fornecedor_cota_to_maquina_pk

    # tabela existe, sem coluna Maquina
    mock_db.execute_query.side_effect = [
        [{"TABLE_NAME": "tab_gravacao_pendente_fornecedor_cota"}],  # _table_exists
        [],  # _column_exists Maquina → False
        None,  # CREATE v2
        None,  # INSERT SELECT
        None,  # DROP
        None,  # RENAME
    ]
    _migrate_fornecedor_cota_to_maquina_pk()
    sqls = [" ".join(str(c[0][0]).split()) for c in mock_db.execute_query.call_args_list]
    assert any("CREATE TABLE IF NOT EXISTS tab_gravacao_pendente_fornecedor_cota_v2" in s for s in sqls)
    assert any("Maquina, CotaChapas, PrecoChapa" in s and "Komori" in s for s in sqls)
    assert any("DROP TABLE tab_gravacao_pendente_fornecedor_cota" in s for s in sqls)
