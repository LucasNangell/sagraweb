"""Testes das correções pós-auditoria — Sub OS por componente (sem MySQL real)."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from routers.os_routes import _dedupe_os_search_rows
from services.andamento_operacional import (
    get_mirror_cod_statuses_for_os,
    recalc_ultimo_status_operacional,
)
from services.os_componentes_service import (
    _componente_has_sub_os,
    format_mirror_obs,
    is_os_frozen,
    sync_sub_os_congelada_flags,
)


class TestFormatMirrorObs:
    def test_primeira_linha_com_hora_e_componente(self):
        obs = format_mirror_obs(886, "Capa", "Saída p/ SIELT")
        lines = obs.split("\n")
        assert len(lines) == 2
        assert " - OS 886 [Capa]" in lines[0]
        assert lines[0][:2].isdigit() or lines[0][0] == "0"
        assert "h" in lines[0]
        assert lines[1] == "Saída p/ SIELT"

    def test_sem_observacao_usuario(self):
        obs = format_mirror_obs(100, "Miolo", "")
        assert " - OS 100 [Miolo]" in obs
        assert "\n" not in obs


class TestRecalcUltimoStatusOperacional:
    def test_promove_operacional_ignora_espelho(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"CodStatus": "000882026-02"}

        promoted = recalc_ultimo_status_operacional(cursor, 886, 2026)

        assert promoted == "000882026-02"
        execute_sql = " ".join(
            str(call.args[0]) for call in cursor.execute.call_args_list
        )
        assert "cod_status_espelho" in execute_sql.lower()
        assert "not exists" in execute_sql.lower()
        assert "collate" in execute_sql.lower()
        assert "substring_index" in execute_sql.lower()
        cursor.execute.assert_any_call(
            "UPDATE tabAndamento SET UltimoStatus = 1 WHERE CodStatus = %s",
            ("000882026-02",),
        )

    def test_sem_andamento_restante_retorna_none(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None

        assert recalc_ultimo_status_operacional(cursor, 1, 2026) is None


class TestGetMirrorCodStatuses:
    def test_lista_codigos_espelho(self):
        with patch("services.andamento_operacional.db") as mock_db:
            mock_db.execute_query.return_value = [
                {"cod": "008862026-05"},
                {"cod": "008862026-06"},
            ]
            result = get_mirror_cod_statuses_for_os(886, 2026)
        assert result == ["008862026-05", "008862026-06"]


class TestComponenteSubOsOrfa:
    def test_has_sub_os_sem_andamento(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"1": 1}
        assert _componente_has_sub_os(cursor, 42) is True

    def test_sem_sub_os(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        assert _componente_has_sub_os(cursor, 42) is False


class TestCongelamentoSubOs:
    def test_sync_congelada_quando_entregue(self):
        with patch("services.os_componentes_service.is_os_frozen", return_value=(True, "Entregue")):
            with patch("services.os_componentes_service.db") as mock_db:
                sync_sub_os_congelada_flags(886, 2026)
                mock_db.execute_query.assert_called_once_with(
                    "UPDATE tab_os_sub_os SET congelada = %s WHERE nro_protocolo = %s AND ano_protocolo = %s",
                    (1, 886, 2026),
                )

    def test_sync_descongela_quando_ativa(self):
        with patch("services.os_componentes_service.is_os_frozen", return_value=(False, "Em Execução")):
            with patch("services.os_componentes_service.db") as mock_db:
                sync_sub_os_congelada_flags(886, 2026)
                mock_db.execute_query.assert_called_once_with(
                    "UPDATE tab_os_sub_os SET congelada = %s WHERE nro_protocolo = %s AND ano_protocolo = %s",
                    (0, 886, 2026),
                )


class TestOsSearchDedupe:
    def test_uma_linha_por_os_principal(self):
        rows = [
            {"nr_os": 886, "ano": 2026, "has_sub_os": True, "sub_os_count": 2},
            {"nr_os": 886, "ano": 2026, "has_sub_os": True, "sub_os_count": 2},
            {"nr_os": 100, "ano": 2026, "has_sub_os": False, "sub_os_count": 0},
        ]
        deduped = _dedupe_os_search_rows(rows)
        assert len(deduped) == 2
        keys = {(r["nr_os"], r["ano"]) for r in deduped}
        assert keys == {(886, 2026), (100, 2026)}


class TestIsOsFrozen:
    def test_entregue_congela(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = [{"SituacaoLink": "Entregue"}]
            frozen, situacao = is_os_frozen(886, 2026)
        assert frozen is True
        assert situacao == "Entregue"

    def test_em_execucao_nao_congela(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = [{"SituacaoLink": "Em Execução"}]
            frozen, _ = is_os_frozen(886, 2026)
        assert frozen is False


class TestSubOsHistoryDatetimeSerialization:
    def test_normalize_history_row_converts_datetime(self):
        from datetime import datetime

        from services.os_componentes_service import _normalize_sub_os_history_row

        row = _normalize_sub_os_history_row(
            {
                "id": 1,
                "situacao": "Em Execução",
                "setor": "SEFOC",
                "observacao": "teste",
                "data": datetime(2024, 6, 8, 17, 35, 48),
                "ultimo_status": 1,
                "ponto": "12345",
                "cod_status_espelho": "000882026-05",
                "criado_em": datetime(2024, 6, 8, 17, 35, 48),
                "criado_por": "918713",
            }
        )
        assert row["data"] == "2024-06-08 17:35:48"
        assert row["criado_em"] == "2024-06-08 17:35:48"
        assert row["ultimo_status"] is True

    def test_sub_os_history_row_model_validate(self):
        from datetime import datetime

        from routers.os_sub_os_routes import SubOsHistoryRow
        from services.os_componentes_service import _normalize_sub_os_history_row

        raw = _normalize_sub_os_history_row(
            {
                "id": 2,
                "situacao": "Recebido",
                "setor": "PCP",
                "observacao": None,
                "data": datetime(2024, 6, 8, 17, 35, 48),
                "ultimo_status": 0,
                "ponto": None,
                "cod_status_espelho": None,
                "criado_em": datetime(2024, 6, 8, 17, 35, 48),
                "criado_por": None,
            }
        )
        validated = SubOsHistoryRow.model_validate(raw)
        assert validated.data == "2024-06-08 17:35:48"


class TestGetSubOsCurrentStatus:
    def test_prefer_ultimo_status_1(self):
        from services.os_componentes_service import get_sub_os_current_status

        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = [
                {
                    "id": 10,
                    "situacao": "Em Execução",
                    "setor": "SEFOC",
                    "observacao": "ok",
                    "data": "2024-06-08 10:00:00",
                    "ultimo_status": 1,
                }
            ]
            row = get_sub_os_current_status(5)
        assert row["situacao"] == "Em Execução"
        assert row["ultimo_status"] == 1

    def test_fallback_mais_recente_sem_ultimo_status(self):
        from services.os_componentes_service import get_sub_os_current_status

        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.side_effect = [
                [],
                [
                    {
                        "id": 11,
                        "situacao": "Recebido",
                        "setor": "PCP",
                        "observacao": None,
                        "data": "2024-06-07 09:00:00",
                        "ultimo_status": 0,
                    }
                ],
            ]
            row = get_sub_os_current_status(5)
        assert row["situacao"] == "Recebido"


class TestListSubOsWithCurrentStatus:
    def test_map_row_from_sub_os_andamento(self):
        from services.os_componentes_service import _map_sub_os_list_row

        with patch(
            "services.os_componentes_service.get_sub_os_current_status",
            return_value={
                "id": 99,
                "situacao": "Saída p/ SIELT",
                "setor": "SEFOC",
                "observacao": "teste",
                "data": "2024-06-08 12:00:00",
                "ultimo_status": 1,
            },
        ):
            with patch("services.os_componentes_service.db") as mock_db:
                mock_db.execute_query.return_value = [{"ok": 1}]
                mapped = _map_sub_os_list_row(
                    {
                        "id": 3,
                        "display_name": "886 [Capa]",
                        "componente_id": 7,
                        "componente_nome": "Capa",
                        "componente_tipo": "capa",
                        "ativo": 1,
                        "congelada": 0,
                    },
                    frozen=False,
                )
        assert mapped["situacao_atual"] == "Saída p/ SIELT"
        assert mapped["setor_atual"] == "SEFOC"
        assert mapped["ultimo_status_id"] == 99
        assert mapped["has_history"] is True
        assert mapped["row_kind"] == "sub_os"
        assert mapped["situacao"] == "Saída p/ SIELT"


class TestAddOsHistoryMainTargetGuard:
    def test_rejeita_sem_confirmacao_quando_tem_sub_os(self):
        from fastapi import HTTPException

        from routers.os_routes import HistoryItem, add_os_history

        with patch("services.os_componentes_service.os_has_active_componentes", return_value=False):
            with patch("services.os_componentes_service.count_sub_os", return_value=2):
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

    def test_aceita_com_confirmacao(self):
        from routers.os_routes import HistoryItem, add_os_history

        with patch("services.os_componentes_service.os_has_active_componentes", return_value=False):
            with patch("services.os_componentes_service.count_sub_os", return_value=1):
                with patch("routers.os_routes.db") as mock_db:
                    mock_db.execute_transaction.side_effect = Exception("stop-after-guard")
                    with pytest.raises(Exception, match="stop-after-guard"):
                        add_os_history(
                            2026,
                            886,
                            HistoryItem(
                                situacao="Em Execução",
                                setor="SEFOC",
                                obs="",
                                usuario="918713",
                                confirm_main_os_target=True,
                            ),
                        )

    def test_aceita_sem_confirmacao_quando_sem_sub_os_nem_componentes(self):
        from routers.os_routes import HistoryItem, add_os_history

        with patch("services.os_componentes_service.os_has_active_componentes", return_value=False):
            with patch("services.os_componentes_service.count_sub_os", return_value=0):
                with patch("routers.os_routes.db") as mock_db:
                    mock_db.execute_transaction.side_effect = Exception("stop-after-guard")
                    with pytest.raises(Exception, match="stop-after-guard"):
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


class TestRecalcCollationSafe:
    def test_query_usa_not_exists_com_collate(self):
        from services.andamento_operacional import MIRROR_EXCLUDE_CLAUSE

        assert "NOT EXISTS" in MIRROR_EXCLUDE_CLAUSE
        assert "COLLATE utf8mb4_general_ci" in MIRROR_EXCLUDE_CLAUSE
        assert "NOT IN" not in MIRROR_EXCLUDE_CLAUSE.upper()


class TestSubOsMirrorUltimoStatusZero:
    def test_espelho_insere_ultimo_status_zero(self):
        from services.os_componentes_service import add_sub_os_history

        captured_sql: list[str] = []

        def fake_transaction(fns):
            cursor = MagicMock()
            cursor.fetchone.side_effect = [
                None,
                {"max_cod": "008862026-04"},
                {
                    "id": 1,
                    "display_name": "886 [Capa]",
                    "componente_nome": "Capa",
                    "congelada": 0,
                },
            ]
            cursor.lastrowid = 100

            def execute(sql, params=None):
                captured_sql.append(str(sql))

            cursor.execute = execute
            return [fn(cursor) for fn in fns]

        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_transaction.side_effect = fake_transaction
            with patch("services.os_componentes_service.get_sub_os") as mock_get:
                mock_get.return_value = {
                    "id": 1,
                    "display_name": "886 [Capa]",
                    "componente_nome": "Capa",
                    "congelada": False,
                }
                with patch(
                    "services.os_componentes_service.is_os_frozen",
                    return_value=(False, "Em Execução"),
                ):
                    with patch("routers.os_routes._dispatch_mdb_sync"):
                        with patch("routers.realtime.schedule_broadcast"):
                            add_sub_os_history(
                                nro=886,
                                ano=2026,
                                sub_os_id=1,
                                situacao="Em Execução",
                                setor="SEFOC",
                                obs="",
                                usuario="918713",
                            )

        mirror_inserts = [
            s for s in captured_sql if "INSERT INTO tabAndamento" in s
        ]
        assert mirror_inserts
        assert "UltimoStatus" in mirror_inserts[0]
        assert "NOW(), 0," in mirror_inserts[0].replace("\n", " ")
