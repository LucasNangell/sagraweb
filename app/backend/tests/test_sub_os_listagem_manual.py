"""Testes — Sub OS listável apenas com andamento manual exclusivo."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.os_componentes_service import (
    MANUAL_ANDAMENTO_SQL,
    SOURCE_INHERITED_MAIN_OS,
    SOURCE_MANUAL_SUB_OS,
    count_sub_os,
    list_sub_os,
    sub_os_has_manual_history,
    sync_sub_os_listable_state,
)


class TestSubOsHasManualHistory:
    def test_true_quando_manual(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = [{"ok": 1}]
            assert sub_os_has_manual_history(5) is True
            sql = mock_db.execute_query.call_args[0][0]
            assert "manual_sub_os" in sql

    def test_false_quando_vazio(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = []
            assert sub_os_has_manual_history(5) is False


class TestListSubOsListableOnly:
    def test_filtra_por_andamento_manual(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = []
            with patch("services.os_componentes_service.is_os_frozen", return_value=(False, None)):
                list_sub_os(2532, 2026, listable_only=True)
            sql = mock_db.execute_query.call_args[0][0]
            assert "EXISTS" in sql
            assert "manual_sub_os" in sql

    def test_include_all_sem_filtro_manual(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = []
            with patch("services.os_componentes_service.is_os_frozen", return_value=(False, None)):
                list_sub_os(2532, 2026, listable_only=False)
            sql = mock_db.execute_query.call_args[0][0]
            assert "manual_sub_os" not in sql


class TestCountSubOsListable:
    def test_conta_apenas_com_manual(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = [{"cnt": 0}]
            assert count_sub_os(2532, 2026) == 0
            sql = mock_db.execute_query.call_args[0][0]
            assert MANUAL_ANDAMENTO_SQL.strip()[:20] in sql or "manual_sub_os" in sql


class TestSyncSubOsListableState:
    def test_inativa_sem_manual(self):
        cursor = MagicMock()
        with patch(
            "services.os_componentes_service.sub_os_has_manual_history",
            return_value=False,
        ):
            assert sync_sub_os_listable_state(cursor, 9) is False
        cursor.execute.assert_called_with(
            "UPDATE tab_os_sub_os SET ativo = %s WHERE id = %s",
            (0, 9),
        )

    def test_reativa_com_manual(self):
        cursor = MagicMock()
        with patch(
            "services.os_componentes_service.sub_os_has_manual_history",
            return_value=True,
        ):
            assert sync_sub_os_listable_state(cursor, 9) is True
        cursor.execute.assert_called_with(
            "UPDATE tab_os_sub_os SET ativo = %s WHERE id = %s",
            (1, 9),
        )


class TestManualAndamentoSql:
    def test_sql_reconhece_tipos(self):
        assert "manual_sub_os" in MANUAL_ANDAMENTO_SQL
        assert "inherited_main_os" in MANUAL_ANDAMENTO_SQL
        assert SOURCE_MANUAL_SUB_OS in MANUAL_ANDAMENTO_SQL
        assert SOURCE_INHERITED_MAIN_OS in MANUAL_ANDAMENTO_SQL


class TestSubOsQueriesManualFilter:
    def test_filtro_busca_exige_manual(self):
        from services.os_sub_os_queries import build_main_or_sub_os_filter_sql

        sql = build_main_or_sub_os_filter_sql(
            setores=["SIELT"],
            situacoes=None,
            params={},
        )
        assert "sa_m" in sql
        assert "manual_sub_os" in sql

    def test_fila_pcp_exige_manual(self):
        with patch("services.os_sub_os_queries.db") as mock_db:
            mock_db.execute_query.return_value = []
            from services.os_sub_os_queries import fetch_sub_os_queue_rows

            fetch_sub_os_queue_rows(base_setor="SIELT", display_setor="SIELT")
            sql = mock_db.execute_query.call_args[0][0]
            assert "sa_m" in sql
            assert "manual_sub_os" in sql


class TestDeleteSubOsHistoryListable:
    def test_retorna_still_listable_false(self):
        from services.os_componentes_service import delete_sub_os_history

        def tx(fns):
            cursor = MagicMock()
            cursor.fetchone.return_value = {
                "id": 10,
                "situacao": "Em Execução",
                "setor": "SEFOC",
                "observacao": None,
                "data": "2024-01-01",
                "ultimo_status": 1,
                "ponto": "918713",
                "cod_status_espelho": "025322026-05",
                "source_type": SOURCE_MANUAL_SUB_OS,
                "source_cod_status": None,
                "herdado_da_os_principal": 0,
            }
            return [fn(cursor) for fn in fns]

        with patch("services.os_componentes_service.get_sub_os", return_value={"id": 5, "display_name": "2532 [Capa]", "congelada": 0}):
            with patch("services.os_componentes_service.is_os_frozen", return_value=(False, "Em Execução")):
                with patch("services.os_componentes_service.db") as mock_db:
                    mock_db.execute_transaction.side_effect = tx
                    with patch("services.os_componentes_service.ensure_audit_table"):
                        with patch("services.os_componentes_service.insert_entries"):
                            with patch("services.os_componentes_service.recalc_sub_os_ultimo_status", return_value=None):
                                with patch("services.os_componentes_service.sync_sub_os_listable_state", return_value=False):
                                    with patch("routers.os_audit_service.log_andamento_deleted"):
                                        with patch("routers.realtime.schedule_broadcast"):
                                            with patch("routers.os_routes._dispatch_mdb_sync"):
                                                result = delete_sub_os_history(
                                                    nro=2532,
                                                    ano=2026,
                                                    sub_os_id=5,
                                                    history_id=10,
                                                )
        assert result["still_listable"] is False
