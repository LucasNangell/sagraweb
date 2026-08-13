"""Regressão UltimoStatus único (MySQL + espelhamento MDB)."""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.andamento_operacional import (
    ULTIMO_ORDER_BY_SQL,
    align_ultimo_status_mysql_then_mdb,
    assert_or_fix_unico_ultimo_status,
    insert_andamento_as_ultimo,
    recalc_ultimo_status_operacional,
    select_expected_ultimo_cod,
)


class TestRecalcUltimoStatusOperacional:
    def test_zera_todos_da_os_nao_so_flag_1(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"CodStatus": "000882026-03"}

        promoted = recalc_ultimo_status_operacional(cursor, 886, 2026)

        assert promoted == "000882026-03"
        first_sql = str(cursor.execute.call_args_list[0].args[0])
        assert "UltimoStatus = 0" in first_sql
        assert "AND UltimoStatus = 1" not in first_sql.replace("\n", " ")
        assert "SUBSTRING_INDEX" in " ".join(
            str(c.args[0]) for c in cursor.execute.call_args_list
        )

    def test_order_by_prioriza_sufixo_antes_de_data(self):
        assert "SUBSTRING_INDEX" in ULTIMO_ORDER_BY_SQL
        assert "UNSIGNED" in ULTIMO_ORDER_BY_SQL
        # Sufixo deve vir antes de Data no ORDER BY
        idx_sufixo = ULTIMO_ORDER_BY_SQL.index("SUBSTRING_INDEX")
        idx_data = ULTIMO_ORDER_BY_SQL.index("`Data`")
        assert idx_sufixo < idx_data

    def test_promove_maior_codstatus_mesmo_com_data_antiga(self):
        """Simula SELECT esperado retornando maior sufixo."""
        cursor = MagicMock()
        # select_expected / recalc: fetchone = maior CodStatus
        cursor.fetchone.return_value = {"CodStatus": "000882026-10"}
        promoted = recalc_ultimo_status_operacional(cursor, 886, 2026)
        assert promoted == "000882026-10"
        set_sql = str(cursor.execute.call_args_list[-1].args[0])
        assert "UltimoStatus = 1" in set_sql

    def test_sem_andamento_retorna_none(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        assert recalc_ultimo_status_operacional(cursor, 1, 2026) is None

    def test_insert_andamento_as_ultimo_zera_todos(self):
        cursor = MagicMock()
        insert_andamento_as_ultimo(
            cursor,
            cod_status="000882026-04",
            nro=886,
            ano=2026,
            situacao="Recebido",
            setor="SEGEP",
            obs="x",
            ponto="1",
        )
        first_sql = str(cursor.execute.call_args_list[0].args[0])
        assert "UltimoStatus = 0" in first_sql
        assert "AND UltimoStatus = 1" not in first_sql.replace("\n", " ")


class TestAssertOrFixUnicoUltimo:
    def test_ja_correto_nao_regrava(self):
        cursor = MagicMock()
        # select_expected
        cursor.fetchone.return_value = {"CodStatus": "000882026-05"}
        # marked flags
        cursor.fetchall.return_value = [{"CodStatus": "000882026-05"}]
        result = assert_or_fix_unico_ultimo_status(cursor, 886, 2026)
        assert result == "000882026-05"
        # Nao deve ter UPDATE de heal alem do SELECT
        sqls = [str(c.args[0]) for c in cursor.execute.call_args_list]
        assert not any("UltimoStatus = 0" in s for s in sqls)

    def test_dois_flags_dispara_heal(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"CodStatus": "000882026-05"},  # expected
            {"CodStatus": "000882026-05"},  # select_expected dentro do recalc
        ]
        cursor.fetchall.return_value = [
            {"CodStatus": "000882026-03"},
            {"CodStatus": "000882026-05"},
        ]
        with patch(
            "services.andamento_operacional.recalc_ultimo_status_operacional",
            return_value="000882026-05",
        ) as recalc:
            result = assert_or_fix_unico_ultimo_status(cursor, 886, 2026)
        assert result == "000882026-05"
        recalc.assert_called_once()


class TestAlignUltimoStatusMysqlThenMdb:
    def test_recalc_e_push_mdb(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"CodStatus": "000882026-05"}

        with patch(
            "routers.mdb_writer.push_os_ultimo_status_to_mdb"
        ) as push:
            promoted = align_ultimo_status_mysql_then_mdb(
                886, 2026, cursor=cursor, push_mdb=True
            )

        assert promoted == "000882026-05"
        push.assert_called_once_with(886, 2026, promoted_cod="000882026-05")

    def test_skip_push_mdb(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"CodStatus": "000882026-05"}

        with patch(
            "routers.mdb_writer.push_os_ultimo_status_to_mdb"
        ) as push:
            align_ultimo_status_mysql_then_mdb(
                886, 2026, cursor=cursor, push_mdb=False
            )

        push.assert_not_called()


class TestFixUltimoStatusMdb:
    def test_promove_cod_do_mysql(self):
        from routers.mdb_writer import _fix_ultimo_status_mdb

        cursor = MagicMock()
        cursor.fetchone.return_value = (1,)

        with patch(
            "services.andamento_operacional.get_mirror_cod_statuses_for_os",
            return_value=[],
        ), patch(
            "services.andamento_operacional.get_ultimo_operacional_cod_mysql",
            return_value="000882026-05",
        ):
            chosen = _fix_ultimo_status_mdb(
                cursor, 886, 2026, promoted_cod="000882026-05"
            )

        assert chosen == "000882026-05"
        sqls = [str(c.args[0]) for c in cursor.execute.call_args_list]
        assert any("UltimoStatus = ?" in s and "NroProtocoloLink" in s for s in sqls)
        assert any(
            "UPDATE tabAndamento SET UltimoStatus = ? WHERE CodStatus = ?" in s
            for s in sqls
        )

    def test_fallback_escolhe_maior_sufixo(self):
        from routers.mdb_writer import _fix_ultimo_status_mdb

        cursor = MagicMock()
        # COUNT for promoted missing
        cursor.fetchone.return_value = (0,)
        cursor.fetchall.return_value = [
            SimpleNamespace(CodStatus="000882026-99", Data=datetime(2026, 1, 1)),
            SimpleNamespace(CodStatus="000882026-100", Data=datetime(2026, 1, 1)),
            SimpleNamespace(CodStatus="000882026-50", Data=datetime(2026, 1, 2)),
        ]

        with patch(
            "services.andamento_operacional.get_mirror_cod_statuses_for_os",
            return_value=[],
        ), patch(
            "services.andamento_operacional.get_ultimo_operacional_cod_mysql",
            return_value=None,
        ):
            chosen = _fix_ultimo_status_mdb(cursor, 886, 2026, promoted_cod=None)

        # Maior sufixo (100) vence Data mais nova do -50
        assert chosen == "000882026-100"


class TestSyncAndamentoUpsertFixesOs:
    def test_upsert_chama_fix_ultimo_status(self):
        from routers.mdb_writer import sync_andamento_from_mysql_to_mdb

        row = {
            "CodStatus": "000882026-05",
            "SituacaoLink": "Recebido",
            "SetorLink": "SEGEP",
            "Data": datetime(2026, 8, 12),
            "UltimoStatus": 1,
            "Observaçao": "",
            "Ponto": "1",
        }

        with patch("routers.mdb_writer._ensure_mdb_write_enabled"), patch(
            "routers.mdb_writer._log_mdb_write_start"
        ), patch("routers.mdb_writer._log_mdb_write_ok"), patch(
            "routers.mdb_writer.db"
        ) as mock_db, patch(
            "routers.mdb_writer._execute_mdb_transaction"
        ) as mock_txn, patch(
            "routers.mdb_writer._upsert_andamento_row"
        ) as mock_upsert, patch(
            "routers.mdb_writer._fix_ultimo_status_mdb"
        ) as mock_fix, patch(
            "routers.mdb_writer._ensure_protocolo_in_mdb", return_value=(886, 2026)
        ):
            mock_db.execute_query.return_value = [row]

            def run_work(_nro, _stage, work):
                work(None, MagicMock())

            mock_txn.side_effect = run_work

            sync_andamento_from_mysql_to_mdb("000882026-05", 886, 2026)

        mock_upsert.assert_called_once()
        mock_fix.assert_called_once()


class TestSyncDeleteAlwaysFixesUltimo:
    def test_delete_ausente_ainda_fixa_ultimo(self):
        from routers.mdb_writer import sync_andamento_delete_to_mdb

        cursor = MagicMock()
        cursor.fetchone.return_value = (0,)

        with patch("routers.mdb_writer._ensure_mdb_write_enabled"), patch(
            "routers.mdb_writer._log_mdb_write_start"
        ), patch("routers.mdb_writer._log_mdb_write_ok"), patch(
            "routers.mdb_writer.get_mdb_path", return_value="x.mdb"
        ), patch(
            "routers.mdb_writer._execute_mdb_transaction"
        ) as mock_txn, patch(
            "routers.mdb_writer._fix_ultimo_status_mdb"
        ) as mock_fix:

            def run_work(_nro, _stage, work):
                work(None, cursor)

            mock_txn.side_effect = run_work
            sync_andamento_delete_to_mdb("000882026-05", 886, 2026)

        mock_fix.assert_called_once()


class TestSyncEnsureDoesNotCopyMdbFlags:
    def test_old_ensure_recalc_then_push(self):
        import sync_andamentos_v2_Old as sync_mod

        engine = MagicMock()
        engine.ensure_mysql_ultimo_status_from_mdb = (
            sync_mod.AndamentosSynchronizer.ensure_mysql_ultimo_status_from_mdb.__get__(
                engine, sync_mod.AndamentosSynchronizer
            )
        )
        engine._recalc_mysql_ultimo_status_operacional = MagicMock(
            return_value="000882026-05"
        )
        engine._push_ultimo_status_to_mdb = MagicMock()
        engine.logger = MagicMock()

        result = engine.ensure_mysql_ultimo_status_from_mdb(886, 2026)

        assert result == "000882026-05"
        engine._recalc_mysql_ultimo_status_operacional.assert_called_once_with(886, 2026)
        engine._push_ultimo_status_to_mdb.assert_called_once_with(
            886, 2026, "000882026-05"
        )

    def test_andamentos_differ_ignora_ultimo_status(self):
        import sync_andamentos_v2_Old as sync_mod

        engine = MagicMock()
        engine.format_observacao = lambda obs, data: obs
        engine.format_ponto = lambda p: p
        differ = sync_mod.AndamentosSynchronizer._andamentos_differ.__get__(
            engine, sync_mod.AndamentosSynchronizer
        )

        mdb = {
            "SituacaoLink": "Recebido",
            "SetorLink": "SEGEP",
            "Data": "2026-08-12 10:00:00",
            "UltimoStatus": True,
            "Observaçao": "a",
            "Ponto": "1",
            "NroProtocoloLink": 886,
            "AnoProtocoloLink": 2026,
        }
        mysql = dict(mdb)
        mysql["UltimoStatus"] = False

        assert differ(mdb, mysql) is False
