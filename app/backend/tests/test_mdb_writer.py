"""Testes mínimos do dual-write MySQL → MDB (andamentos)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from routers.mdb_writer import (
    MdbWriteDisabledError,
    _map_protocolo_cols_for_mdb,
    _resolve_mdb_column,
    _write_protocolo_extra_cols,
    mdb_dest_label,
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
    def test_duplicado_faz_update(self):
        row = {
            "CodStatus": "000842026-99",
            "SituacaoLink": "Teste",
            "SetorLink": "SEFOC",
            "Data": "2026-06-11",
            "UltimoStatus": 1,
            "Observaçao": "obs",
            "Ponto": "918713",
        }
        executed: list[str] = []

        def fake_execute(sql, params=None):
            executed.append(str(sql).strip().upper())

        cursor = MagicMock()
        cursor.execute.side_effect = fake_execute
        cursor.fetchone.return_value = MagicMock(__getitem__=lambda s, i: 1)

        with patch("routers.mdb_writer._andamento_exists", return_value=True):
            from routers.mdb_writer import _upsert_andamento_row

            _upsert_andamento_row(cursor, row, 84, 2026)

        assert any("UPDATE TABANDAMENTO" in s for s in executed)
        assert not any(s.startswith("INSERT") for s in executed if "TABANDAMENTO" in s)

    def test_ultimo_status_desmarca_anteriores(self):
        row = {
            "CodStatus": "000842026-99",
            "SituacaoLink": "X",
            "SetorLink": "Y",
            "Data": "2026-06-11",
            "UltimoStatus": 1,
            "Observaçao": "",
            "Ponto": "",
        }
        executed: list[str] = []

        cursor = MagicMock()
        cursor.execute.side_effect = lambda sql, params=None: executed.append(str(sql))
        cursor.fetchone.return_value = MagicMock(__getitem__=lambda s, i: 0)

        with patch("routers.mdb_writer._andamento_exists", return_value=False):
            from routers.mdb_writer import _upsert_andamento_row

            _upsert_andamento_row(cursor, row, 84, 2026)

        assert any("UltimoStatus" in s and "UPDATE" in s for s in executed)


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
