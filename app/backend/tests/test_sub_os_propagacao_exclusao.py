"""Testes — propagação de andamento principal e exclusão Sub OS."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.os_componentes_service import (
    SOURCE_INHERITED_MAIN_OS,
    SOURCE_MANUAL_SUB_OS,
    _resolve_sub_history_source_type,
    delete_inherited_andamento_for_main_cod,
    propagate_main_os_andamento_to_sub_os,
    recalc_sub_os_ultimo_status,
)


class TestPropagateMainOsAndamento:
    def test_propaga_para_componentes_ativos_sem_espelho(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [{"id": 10}, {"id": 11}],
            None,
            None,
        ]
        cursor.fetchone.side_effect = [
            None,
            None,
            None,
            None,
        ]
        cursor.lastrowid = 501

        with patch(
            "services.os_componentes_service.get_componente",
            side_effect=[
                {"id": 10, "nome": "Capa", "ativo": True},
                {"id": 11, "nome": "Miolo", "ativo": True},
            ],
        ):
            with patch("services.os_componentes_service.ensure_audit_table"):
                with patch("services.os_componentes_service.insert_entries"):
                    affected = propagate_main_os_andamento_to_sub_os(
                        cursor,
                        nro=2532,
                        ano=2026,
                        source_cod_status="025322026-03",
                        situacao="Em Execução",
                        setor="SEFOC",
                        obs="teste",
                        ponto="918713",
                    )

        assert affected == [501, 501]
        insert_sql = " ".join(
            str(c.args[0]) for c in cursor.execute.call_args_list if "INSERT INTO tab_os_sub_os_andamento" in str(c.args[0])
        )
        assert "herdado_da_os_principal" in insert_sql.lower() or "inherited" in insert_sql.lower() or SOURCE_INHERITED_MAIN_OS in str(cursor.execute.call_args_list)
        andamento_inserts = [
            c for c in cursor.execute.call_args_list
            if "tab_os_sub_os_andamento" in str(c.args[0]) and "INSERT" in str(c.args[0])
        ]
        assert len(andamento_inserts) == 2
        for call in andamento_inserts:
            params = call.args[1]
            assert params[-2] == SOURCE_INHERITED_MAIN_OS
            assert params[-1] == "025322026-03"

        tab_andamento_inserts = [
            c for c in cursor.execute.call_args_list
            if "tabAndamento" in str(c.args[0]) and "INSERT" in str(c.args[0])
        ]
        assert len(tab_andamento_inserts) == 0

    def test_nao_duplica_mesmo_source_cod_status(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"id": 10}]
        cursor.fetchone.side_effect = [{"id": 99}, {"id": 1}]
        cursor.lastrowid = 100

        with patch(
            "services.os_componentes_service.get_componente",
            return_value={"id": 10, "nome": "Capa", "ativo": True},
        ):
            affected = propagate_main_os_andamento_to_sub_os(
                cursor,
                nro=2532,
                ano=2026,
                source_cod_status="025322026-03",
                situacao="Em Execução",
                setor="SEFOC",
                obs="",
                ponto="918713",
            )

        assert affected == []
        andamento_inserts = [
            c for c in cursor.execute.call_args_list
            if "INSERT INTO tab_os_sub_os_andamento" in str(c.args[0])
        ]
        assert len(andamento_inserts) == 0

    def test_sem_componentes_retorna_vazio(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        assert (
            propagate_main_os_andamento_to_sub_os(
                cursor,
                nro=1,
                ano=2026,
                source_cod_status="000012026-01",
                situacao="Recebido",
                setor="PCP",
                obs="",
                ponto="1",
            )
            == []
        )


class TestDeleteInheritedAndamento:
    def test_remove_herdados_e_recalcula(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"sub_os_id": 5}, {"sub_os_id": 6}]
        cursor.fetchone.return_value = {"id": 88}

        with patch(
            "services.os_componentes_service.recalc_sub_os_ultimo_status",
            return_value=88,
        ) as mock_recalc:
            with patch(
                "services.os_componentes_service.sync_sub_os_listable_state",
                return_value=True,
            ) as mock_listable:
                with patch("services.os_componentes_service.ensure_audit_table"):
                    with patch("services.os_componentes_service.insert_entries"):
                        sub_ids = delete_inherited_andamento_for_main_cod(
                            cursor, "025322026-03", nro=2532, ano=2026
                        )

        assert sub_ids == [5, 6]
        assert mock_recalc.call_count == 2
        assert mock_listable.call_count == 2
        delete_calls = [
            c
            for c in cursor.execute.call_args_list
            if "DELETE FROM tab_os_sub_os_andamento" in str(c.args[0])
        ]
        assert len(delete_calls) == 1
        assert delete_calls[0].args[1] == ("025322026-03", "025322026-03")

    def test_remove_por_cod_status_espelho(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"sub_os_id": 9}]

        with patch(
            "services.os_componentes_service.recalc_sub_os_ultimo_status",
            return_value=11,
        ):
            with patch(
                "services.os_componentes_service.sync_sub_os_listable_state",
                return_value=False,
            ):
                with patch("services.os_componentes_service.ensure_audit_table"):
                    with patch("services.os_componentes_service.insert_entries"):
                        sub_ids = delete_inherited_andamento_for_main_cod(
                            cursor, "025322026-05", nro=2532, ano=2026
                        )

        assert sub_ids == [9]
        select_sql = str(cursor.execute.call_args_list[0].args[0])
        assert "cod_status_espelho" in select_sql


class TestRecalcSubOsUltimoStatus:
    def test_promove_mais_recente(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"id": 42}

        promoted = recalc_sub_os_ultimo_status(cursor, 7)

        assert promoted == 42
        cursor.execute.assert_any_call(
            "UPDATE tab_os_sub_os_andamento SET ultimo_status = 1 WHERE id = %s",
            (42,),
        )


class TestResolveSubHistorySourceType:
    def test_manual_explicito(self):
        assert (
            _resolve_sub_history_source_type({"source_type": SOURCE_MANUAL_SUB_OS})
            == SOURCE_MANUAL_SUB_OS
        )

    def test_herdado_por_flag(self):
        assert (
            _resolve_sub_history_source_type({"herdado_da_os_principal": 1})
            == SOURCE_INHERITED_MAIN_OS
        )

    def test_herdado_por_source_cod_sem_espelho(self):
        assert (
            _resolve_sub_history_source_type(
                {"source_cod_status": "025322026-01", "cod_status_espelho": None}
            )
            == SOURCE_INHERITED_MAIN_OS
        )


class TestDeleteSubOsHistory:
    def test_herdado_nao_mexe_tab_andamento(self):
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
                "cod_status_espelho": None,
                "source_type": SOURCE_INHERITED_MAIN_OS,
                "source_cod_status": "025322026-03",
                "herdado_da_os_principal": 1,
            }
            results = [fn(cursor) for fn in fns]
            return results

        with patch("services.os_componentes_service.get_sub_os", return_value={"id": 5, "display_name": "2532 [Capa]", "congelada": 0}):
            with patch("services.os_componentes_service.is_os_frozen", return_value=(False, "Em Execução")):
                with patch("services.os_componentes_service.db") as mock_db:
                    mock_db.execute_transaction.side_effect = tx
                    with patch("services.os_componentes_service.ensure_audit_table"):
                        with patch("services.os_componentes_service.insert_entries"):
                            with patch("services.os_componentes_service.recalc_sub_os_ultimo_status", return_value=9):
                                with patch("services.os_componentes_service.sync_sub_os_listable_state", return_value=True):
                                    with patch("routers.realtime.schedule_broadcast"):
                                        result = delete_sub_os_history(
                                            nro=2532,
                                            ano=2026,
                                            sub_os_id=5,
                                            history_id=10,
                                        )

        assert result["inherited"] is True
        assert result["mirror_cod_status"] is None

    def test_manual_com_espelho_dispara_mdb(self):
        from services.os_componentes_service import delete_sub_os_history

        executed: list[str] = []

        def tx(fns):
            cursor = MagicMock()
            cursor.fetchone.side_effect = [
                {
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
                },
                {
                    "SituacaoLink": "Em Execução",
                    "SetorLink": "SEFOC",
                    "Data": "2024-01-01",
                    "UltimoStatus": 0,
                    "Observaçao": "obs",
                    "Ponto": "918713",
                },
            ]

            def execute(sql, params=None):
                executed.append(str(sql))

            cursor.execute = execute
            results = [fn(cursor) for fn in fns]
            return results

        mdb_called: list[str] = []

        def fake_dispatch(_name, cb):
            cb()
            mdb_called.append("ok")

        with patch("services.os_componentes_service.get_sub_os", return_value={"id": 5, "display_name": "2532 [Capa]", "congelada": 0}):
            with patch("services.os_componentes_service.is_os_frozen", return_value=(False, "Em Execução")):
                with patch("services.os_componentes_service.db") as mock_db:
                    mock_db.execute_transaction.side_effect = tx
                    with patch("services.os_componentes_service.ensure_audit_table"):
                        with patch("services.os_componentes_service.insert_entries"):
                            with patch("services.os_componentes_service.recalc_sub_os_ultimo_status", return_value=9):
                                with patch("services.os_componentes_service.sync_sub_os_listable_state", return_value=False):
                                    with patch("routers.os_audit_service.log_andamento_deleted"):
                                        with patch("routers.realtime.schedule_broadcast"):
                                            with patch(
                                                "routers.os_routes._dispatch_mdb_sync",
                                                side_effect=fake_dispatch,
                                            ):
                                                with patch(
                                                    "routers.mdb_writer.sync_andamento_delete_to_mdb",
                                                ) as mock_mdb:
                                                    result = delete_sub_os_history(
                                                        nro=2532,
                                                        ano=2026,
                                                        sub_os_id=5,
                                                        history_id=10,
                                                    )
                                                    assert mock_mdb.called

        assert result["inherited"] is False
        assert result["mirror_cod_status"] == "025322026-05"
        assert any("UltimoStatus = 0" in s for s in executed)


class TestAddOsHistoryGuardWithComponentes:
    def test_rejeita_sem_confirmacao_quando_tem_componentes_ativos(self):
        from fastapi import HTTPException

        from routers.os_routes import HistoryItem, add_os_history

        with patch("services.os_componentes_service.count_sub_os", return_value=0):
            with patch("services.os_componentes_service.os_has_active_componentes", return_value=True):
                with pytest.raises(HTTPException) as exc:
                    add_os_history(
                        2026,
                        886,
                        HistoryItem(
                            situacao="Em Execução",
                            setor="SEFOC",
                            obs="",
                            usuario="918713",
                            confirm_main_os_target=False,
                        ),
                    )
        assert exc.value.status_code == 403
