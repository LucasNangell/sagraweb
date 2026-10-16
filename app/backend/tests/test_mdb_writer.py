"""Testes mínimos do dual-write MySQL → MDB (andamentos)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from routers.mdb_writer import (
    MdbSyncError,
    MdbWriteDisabledError,
    _execute_mdb_transaction,
    _map_protocolo_cols_for_mdb,
    _resolve_mdb_column,
    _write_protocolo_extra_cols,
    _record_mdb_access,
    classify_mdb_error,
    format_mdb_failure_detail,
    get_mdb_access_state,
    is_retriable_mdb_error,
    mdb_dest_label,
    probe_mdb_access,
    reset_mdb_access_state_for_tests,
    reset_mdb_circuit_for_tests,
    sync_andamento_delete_to_mdb,
    sync_andamento_from_mysql_to_mdb,
)


class TestMdbDestLabel:
    def test_os_menor_5000(self):
        assert mdb_dest_label(4999) == "OS_Atual"
        assert mdb_dest_label(84) == "OS_Atual"

    def test_papelaria_5000_ou_mais(self):
        assert mdb_dest_label(5000) == "Papelaria"
        assert mdb_dest_label(5946) == "Papelaria"


class TestMdbWriteDisabled:
    def test_insert_nao_silencia_mysql_only(self):
        with patch("routers.mdb_writer.config_manager") as mock_cfg:
            mock_cfg.is_mdb_write_enabled.return_value = False
            with pytest.raises(MdbWriteDisabledError):
                sync_andamento_from_mysql_to_mdb("000842026-01", 84, 2026, operation="insert")

    def test_delete_nao_silencia_mysql_only(self):
        with patch("routers.mdb_writer.config_manager") as mock_cfg:
            mock_cfg.is_mdb_write_enabled.return_value = False
            with pytest.raises(MdbWriteDisabledError):
                sync_andamento_delete_to_mdb("000842026-01", 84, 2026)


class TestProtocoloColAliases:
    def test_resolve_retirada_ponto_preferencial(self):
        avail = frozenset({"RetiradaNome", "RetiradaPonto", "Funcionário"})
        assert _resolve_mdb_column(avail, "RetiradaPonto") == "RetiradaPonto"

    def test_resolve_funcionario_acento_quando_sem_retirada_ponto(self):
        avail = frozenset({"RetiradaNome", "Funcionário", "PontoEntrega"})
        assert _resolve_mdb_column(avail, "RetiradaPonto") == "Funcionário"

    def test_resolve_recebim_data_alias(self):
        avail = frozenset({"DataRecebimento", "RetiradaNome"})
        assert _resolve_mdb_column(avail, "RecebimData") == "DataRecebimento"

    def test_map_grava_nr_ponto_em_funcionario_acento(self):
        avail = frozenset({"RetiradaNome", "Funcionário", "PontoEntrega"})
        proto = {
            "RetiradaNome": "João",
            "RetiradaPonto": "918.713",
            "PontoEntrega": "123.456",
        }
        mapped = _map_protocolo_cols_for_mdb(
            avail,
            ("RetiradaNome", "RetiradaPonto", "PontoEntrega"),
            proto,
        )
        assert mapped["RetiradaNome"] == "João"
        assert mapped["Funcionário"] == "918.713"
        assert mapped["PontoEntrega"] == "123.456"
        assert "RetiradaPonto" not in mapped


class TestWriteProtocoloExtraCols:
    def test_update_usa_colchetes_e_retorna_count(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (1,)
        executed: list[tuple] = []

        def fake_execute(sql, params=None):
            executed.append((str(sql), params))

        cursor.execute.side_effect = fake_execute

        with patch(
            "routers.mdb_writer._mdb_table_columns",
            return_value=frozenset(
                {"RetiradaNome", "RetiradaPonto", "RecebimData", "PontoEntrega", "SetorEntrega"}
            ),
        ):
            n = _write_protocolo_extra_cols(
                cursor,
                84,
                2026,
                {
                    "RetiradaNome": "Maria",
                    "RetiradaPonto": "120.819",
                    "RecebimData": None,
                    "PontoEntrega": "918.713",
                    "DataConclusao": None,
                    "ArmazenadoEm": "",
                    "ContatoRecebim": "",
                    "SetorEntrega": "SEFOC",
                    "CancelamentoMotivo": "",
                    "CancelamentoPonto": "",
                    "CancelamentoSetor": "",
                },
                (
                    "RetiradaNome",
                    "RetiradaPonto",
                    "PontoEntrega",
                    "SetorEntrega",
                ),
                mdb_path=r"I:\fake.mdb",
            )

        assert n >= 3
        update_sql = next(s for s, _ in executed if "UPDATE tabProtocolos SET" in s)
        assert "[RetiradaNome]=?" in update_sql
        assert "[RetiradaPonto]=?" in update_sql

    def test_zero_cols_quando_schema_sem_campos(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (1,)
        with patch(
            "routers.mdb_writer._mdb_table_columns",
            return_value=frozenset({"NroProtocolo", "AnoProtocolo", "NomeUsuario"}),
        ):
            n = _write_protocolo_extra_cols(
                cursor,
                84,
                2026,
                {"RetiradaNome": "X", "RetiradaPonto": "1.000"},
                ("RetiradaNome", "RetiradaPonto"),
                mdb_path=r"I:\fake.mdb",
            )
        assert n == 0


class TestUpsertAndamento:
    def _row(self, **overrides):
        base = {
            "CodStatus": "000842026-99",
            "SituacaoLink": "Teste",
            "SetorLink": "SEFOC",
            "Data": "2026-06-11",
            "UltimoStatus": 1,
            "Observaçao": "obs",
            "Ponto": "918713",
        }
        base.update(overrides)
        return base

    def test_trio_igual_nao_grava(self):
        from types import SimpleNamespace

        from routers.mdb_writer import _upsert_andamento_row

        row = self._row()
        executed: list[str] = []
        cursor = MagicMock()
        cursor.execute.side_effect = lambda sql, params=None: executed.append(str(sql))
        cursor.fetchone.return_value = SimpleNamespace(
            CodStatus="000842026-99",
            SituacaoLink="Teste",
            SetorLink="SEFOC",
        )

        result = _upsert_andamento_row(cursor, row, 84, 2026)

        assert result == "skipped"
        assert executed
        assert all("INSERT" not in s.upper() for s in executed)
        assert all("UPDATE" not in s.upper() for s in executed)

    def test_duplicado_situacao_diferente_faz_update(self):
        from types import SimpleNamespace

        from routers.mdb_writer import _upsert_andamento_row

        row = self._row()
        executed: list[str] = []
        cursor = MagicMock()
        cursor.execute.side_effect = lambda sql, params=None: executed.append(
            str(sql).strip().upper()
        )
        cursor.fetchone.return_value = SimpleNamespace(
            CodStatus="000842026-99",
            SituacaoLink="Outra",
            SetorLink="SEFOC",
        )

        result = _upsert_andamento_row(cursor, row, 84, 2026)

        assert result == "updated"
        assert any("UPDATE TABANDAMENTO" in s for s in executed)
        assert not any(s.startswith("INSERT") for s in executed if "TABANDAMENTO" in s)

    def test_ultimo_status_desmarca_anteriores_no_insert(self):
        from routers.mdb_writer import _upsert_andamento_row

        row = self._row(SituacaoLink="X", SetorLink="Y", Observaçao="", Ponto="")
        executed: list[str] = []
        cursor = MagicMock()
        cursor.execute.side_effect = lambda sql, params=None: executed.append(str(sql))
        cursor.fetchone.return_value = None

        result = _upsert_andamento_row(cursor, row, 84, 2026)

        assert result == "inserted"
        assert any("UltimoStatus" in s and "UPDATE" in s for s in executed)
        assert any("INSERT" in s.upper() for s in executed)


class TestOsRoutesMdbSyncBestEffort:
    def test_dispatch_sync_when_async_disabled(self):
        from routers.mdb_writer import dispatch_mdb_sync

        calls: list[str] = []

        with patch("routers.mdb_writer.config_manager") as mock_cfg:
            mock_cfg.is_mdb_write_enabled.return_value = True
            mock_cfg.get.return_value = False
            dispatch_mdb_sync("test", lambda: calls.append("ok"))
        assert calls == ["ok"]

    def test_dispatch_async_enqueues_when_enabled(self):
        from routers.mdb_writer import _MDB_SYNC_QUEUE, dispatch_mdb_sync

        calls: list[str] = []

        with patch("routers.mdb_writer.config_manager") as mock_cfg:
            mock_cfg.is_mdb_write_enabled.return_value = True
            mock_cfg.get.return_value = True
            dispatch_mdb_sync("test", lambda: calls.append("ok"))

        assert calls == []
        task_name, callback, _context = _MDB_SYNC_QUEUE.get_nowait()
        assert task_name == "test"
        callback()
        assert calls == ["ok"]

    def test_dispatch_queue_full_does_not_run_on_caller_thread(self):
        from queue import Full

        from routers.mdb_writer import dispatch_mdb_sync

        calls: list[str] = []

        with patch("routers.mdb_writer.config_manager") as mock_cfg:
            mock_cfg.is_mdb_write_enabled.return_value = True
            mock_cfg.get.return_value = True
            with patch(
                "routers.mdb_writer._MDB_SYNC_QUEUE.put_nowait",
                side_effect=Full(),
            ):
                with patch(
                    "routers.mdb_writer._enqueue_mdb_sync_when_queue_full"
                ) as mock_overflow:
                    dispatch_mdb_sync("test", lambda: calls.append("ok"))

        assert calls == []
        mock_overflow.assert_called_once()


_LOCK_MSG = (
    "('HY000', \"[HY000] [Microsoft][ODBC Microsoft Access Driver] "
    "The Microsoft Access database engine cannot open or write to the file "
    "'(unknown)'. It is already opened exclusively by another user, or you "
    "need permission to view and write its data. (-1032)\")"
)

_NETWORK_INTERRUPT_MSG = (
    "('HY000', '[HY000] [Microsoft][ODBC Microsoft Access Driver] "
    "Your network access was interrupted. To continue, close the database, "
    "and then open it again. (-1022) (SQLDriverConnect); "
    "[HY000] [Microsoft][ODBC Microsoft Access Driver] "
    "Your network access was interrupted. To continue, close the database, "
    "and then open it again. (-1022)')"
)


def _cfg_get_retry(key, default=None):
    values = {
        "mdb_retry_max_attempts": 5,
        "mdb_retry_base_wait_seconds": 15,
        "mdb_retry_rounds": 2,
        "mdb_retry_second_round_wait_seconds": 120,
    }
    return values.get(key, default)


class TestExecuteMdbTransactionRetry:
    def setup_method(self):
        reset_mdb_circuit_for_tests()
        reset_mdb_access_state_for_tests()

    def teardown_method(self):
        reset_mdb_circuit_for_tests()
        reset_mdb_access_state_for_tests()
    def test_retriable_exhausts_two_rounds_with_fixed_waits(self):
        sleeps: list[float] = []
        lock_err = RuntimeError(_LOCK_MSG)

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch("routers.mdb_writer.pyodbc.connect", side_effect=lock_err):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            with pytest.raises(MdbSyncError) as ei:
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert ei.value.attempts == 10
        assert sleeps == [15, 15, 15, 15, 120, 15, 15, 15, 15]

    def test_success_on_second_round_skips_remaining(self):
        sleeps: list[float] = []
        lock_err = RuntimeError(_LOCK_MSG)
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value = cursor
        # 5 fails in round 1 + success on first of round 2
        connect_results = [lock_err] * 5 + [conn]

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch(
            "routers.mdb_writer.pyodbc.connect", side_effect=connect_results
        ):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert sleeps == [15, 15, 15, 15, 120]
        conn.commit.assert_called_once()

    def test_non_retriable_fails_immediately(self):
        sleeps: list[float] = []

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch(
            "routers.mdb_writer.pyodbc.connect",
            side_effect=RuntimeError("syntax error in query"),
        ):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            with pytest.raises(MdbSyncError) as ei:
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert ei.value.attempts == 1
        assert sleeps == []

    def test_minus_1032_is_retriable(self):
        assert is_retriable_mdb_error(RuntimeError(_LOCK_MSG)) is True
        assert is_retriable_mdb_error(RuntimeError("syntax error")) is False

    def test_minus_1032_classified_as_permission(self):
        assert classify_mdb_error(RuntimeError(_LOCK_MSG)) == "permission"
        prod_msg = (
            _LOCK_MSG[:-2] + " (SQLDriverConnect); [HY000] [Microsoft][ODBC Driver Manager] "
            "Driver's SQLSetConnectAttr failed (0)\")"
        )
        assert classify_mdb_error(RuntimeError(prod_msg)) == "permission"

    def test_exhausted_permission_marks_access_denied(self):
        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep"
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch(
            "routers.mdb_writer.pyodbc.connect", side_effect=RuntimeError(_LOCK_MSG)
        ):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"
            mock_cfg.is_mdb_write_enabled.return_value = True

            with pytest.raises(MdbSyncError):
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)
            state = get_mdb_access_state()

        assert state["status"] == "error"
        assert state["kind"] == "permission"

    def test_permission_fails_fast_when_access_already_denied(self):
        sleeps: list[float] = []
        _record_mdb_access(r"I:\test.mdb", RuntimeError(_LOCK_MSG))

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch(
            "routers.mdb_writer.pyodbc.connect", side_effect=RuntimeError(_LOCK_MSG)
        ):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            with pytest.raises(MdbSyncError) as ei:
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert ei.value.attempts == 1
        assert sleeps == []

    def test_success_clears_access_denied(self):
        _record_mdb_access(r"I:\test.mdb", RuntimeError(_LOCK_MSG))
        conn = MagicMock()

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch("routers.mdb_writer.pyodbc.connect", return_value=conn):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"
            mock_cfg.is_mdb_write_enabled.return_value = True

            _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)
            assert get_mdb_access_state()["status"] == "ok"

    def test_minus_1022_network_interrupt_is_retriable(self):
        err = RuntimeError(_NETWORK_INTERRUPT_MSG)
        assert is_retriable_mdb_error(err) is True
        assert is_retriable_mdb_error(RuntimeError("(-1022)")) is True

    def test_network_interrupt_retries_with_fresh_connect(self):
        sleeps: list[float] = []
        net_err = RuntimeError(_NETWORK_INTERRUPT_MSG)
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value = cursor
        connect_results = [net_err, conn]

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch(
            "routers.mdb_writer.pyodbc.connect", side_effect=connect_results
        ) as mock_connect:
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert sleeps == [15]
        assert mock_connect.call_count == 2
        for call in mock_connect.call_args_list:
            assert call.kwargs.get("timeout") == 30
        conn.commit.assert_called_once()

    def test_invalid_mode_attribute_fails_immediately(self):
        sleeps: list[float] = []
        mode_err = RuntimeError(
            "('08004', \"[08004] [Microsoft][ODBC Microsoft Access Driver]"
            "Invalid connection string attribute Mode (8)\")"
        )

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch("routers.mdb_writer.pyodbc.connect", side_effect=mode_err):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            with pytest.raises(MdbSyncError) as ei:
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert ei.value.attempts == 1
        assert sleeps == []
        assert classify_mdb_error(mode_err) == "invalid_conn_str"

    def test_too_many_clients_uses_short_backoff(self):
        sleeps: list[float] = []
        sat_err = RuntimeError(
            "('08004', \"[08004] [Microsoft][ODBC Microsoft Access Driver] "
            "Too many client tasks. (-1036) (SQLDriverConnect)\")"
        )

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch("routers.mdb_writer.pyodbc.connect", side_effect=sat_err):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            with pytest.raises(MdbSyncError) as ei:
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert ei.value.attempts == 2
        assert sleeps == [60]
        assert classify_mdb_error(sat_err) == "saturation"

    def test_empty_hy000_is_saturation_not_ten_retries(self):
        sleeps: list[float] = []
        hy_err = RuntimeError("('HY000', 'The driver did not supply an error!')")

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch("routers.mdb_writer.pyodbc.connect", side_effect=hy_err):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            with pytest.raises(MdbSyncError) as ei:
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert ei.value.attempts == 2
        assert sleeps == [60]

    def test_circuit_pauses_next_transaction(self):
        sleeps: list[float] = []
        sat_err = RuntimeError("Too many client tasks. (-1036)")

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep", side_effect=lambda s: sleeps.append(s)
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch("routers.mdb_writer.pyodbc.connect", side_effect=sat_err):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            with pytest.raises(MdbSyncError):
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)
            with pytest.raises(MdbSyncError):
                _execute_mdb_transaction(84, "test_stage", lambda c, cur: None)

        assert sleeps[0] == 60
        assert any(s >= 60 for s in sleeps[1:])

    def test_recover_if_skips_error_when_already_synced(self):
        hy_err = RuntimeError("('HY000', 'The driver did not supply an error!')")
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value = cursor

        def boom(_c, _cur):
            raise hy_err

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.time.sleep"
        ), patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch("routers.mdb_writer.pyodbc.connect", return_value=conn):
            mock_cfg.get.side_effect = _cfg_get_retry
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"

            _execute_mdb_transaction(
                84, "test_stage", boom, recover_if=lambda _cur: True
            )

        conn.rollback.assert_called()

    def test_sync_andamento_recover_if_detects_trio(self):
        from types import SimpleNamespace

        mysql_row = {
            "CodStatus": "000842026-01",
            "SituacaoLink": "Em Execução",
            "SetorLink": "SEFOC",
            "Data": "2026-09-01",
            "UltimoStatus": 1,
            "Observaçao": "x",
            "Ponto": "1",
        }
        captured: dict = {}

        def fake_execute(nro, stage, cb, recover_if=None):
            captured["recover_if"] = recover_if
            cursor = MagicMock()
            cursor.fetchone.return_value = SimpleNamespace(
                CodStatus="000842026-01",
                SituacaoLink="Em Execução",
                SetorLink="SEFOC",
            )
            assert recover_if is not None
            assert recover_if(cursor) is True

        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.db"
        ) as mock_db, patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"I:\test.mdb"
        ), patch(
            "routers.mdb_writer._execute_mdb_transaction", side_effect=fake_execute
        ):
            mock_cfg.is_mdb_write_enabled.return_value = True
            mock_db.execute_query.return_value = [mysql_row]
            sync_andamento_from_mysql_to_mdb("000842026-01", 84, 2026)

        assert captured["recover_if"] is not None

    def test_combined_1036_and_mode_is_saturation(self):
        err = RuntimeError(
            "('08004', \"[08004] Too many client tasks. (-1036) (SQLDriverConnect); "
            "[08004] Invalid connection string attribute Mode (8)\")"
        )
        assert classify_mdb_error(err) == "saturation"


class TestMdbConnectionHardening:
    def test_pooling_disabled(self):
        import routers.mdb_writer as mdb_writer

        assert mdb_writer.pyodbc.pooling is False

    def test_connection_string_omits_mode(self):
        from config_manager import config_manager

        with patch.object(
            config_manager, "resolve_mdb_path", return_value=r"\\server\share\os.mdb"
        ):
            conn_str = config_manager.get_mdb_connection_string(r"I:\os.mdb")

        assert "Exclusive=0" in conn_str
        assert "Mode=" not in conn_str
        assert r"DBQ=\\server\share\os.mdb" in conn_str


class TestMdbAccessProbe:
    def setup_method(self):
        reset_mdb_access_state_for_tests()

    def teardown_method(self):
        reset_mdb_access_state_for_tests()

    def _patched(self, connect):
        mock_cfg = patch("routers.mdb_writer.config_manager")
        return mock_cfg, patch("routers.mdb_writer.pyodbc.connect", **connect)

    def test_probe_records_permission_error(self):
        cfg_patch, connect_patch = self._patched({"side_effect": RuntimeError(_LOCK_MSG)})
        with cfg_patch as mock_cfg, connect_patch, patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"\\dfs\os.mdb"
        ):
            mock_cfg.is_mdb_write_enabled.return_value = True
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"
            state = probe_mdb_access()

        assert state["status"] == "error"
        assert state["kind"] == "permission"
        assert state["path"] == r"\\dfs\os.mdb"

    def test_probe_ok_closes_connection(self):
        conn = MagicMock()
        cfg_patch, connect_patch = self._patched({"return_value": conn})
        with cfg_patch as mock_cfg, connect_patch, patch(
            "routers.mdb_writer.get_mdb_path", return_value=r"\\dfs\os.mdb"
        ):
            mock_cfg.is_mdb_write_enabled.return_value = True
            mock_cfg.resolve_mdb_path.side_effect = lambda p: p
            mock_cfg.get_mdb_connection_string.return_value = "DSN=test"
            state = probe_mdb_access()

        assert state["status"] == "ok"
        conn.close.assert_called_once()

    def test_probe_disabled_with_mysql_only(self):
        with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
            "routers.mdb_writer.pyodbc.connect"
        ) as mock_connect:
            mock_cfg.is_mdb_write_enabled.return_value = False
            assert probe_mdb_access() == {"status": "disabled"}
        mock_connect.assert_not_called()


def test_failure_detail_names_process_account_and_hint():
    exc = MdbSyncError(
        "andamento_015912026-04",
        1591,
        r"\\dfs\os.mdb",
        RuntimeError(_LOCK_MSG),
        attempts=10,
        cod_status="015912026-04",
        ano=2026,
    )
    with patch("routers.mdb_writer.config_manager") as mock_cfg, patch(
        "routers.mdb_writer.process_identity", return_value=r"REDECAMARA\P_918713"
    ), patch("routers.mdb_writer.read_release_info", return_value={}):
        mock_cfg.resolve_mdb_path.side_effect = lambda p: p
        detail = format_mdb_failure_detail(
            exc, task_name="history_add", andamento={"cod_status": "015912026-04"}
        )

    assert r"Conta do processo: REDECAMARA\P_918713" in detail
    assert "Release: (fora de releases/" in detail
    assert "SAGRA-Api" in detail
