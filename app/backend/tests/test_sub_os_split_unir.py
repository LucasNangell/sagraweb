"""Split de Sub OS para todos os componentes, busca home e união."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.os_componentes_service import (
    SOURCE_INHERITED_MAIN_OS,
    SOURCE_MANUAL_SUB_OS,
    deactivate_all_sub_os,
    ensure_split_for_all_componentes,
    os_has_any_manual_sub_os_andamento,
)
from services.os_search_service import (
    _dedupe_os_search_rows,
    _expand_split_os_search_rows,
)
from services.os_sub_os_queries import build_main_or_sub_os_filter_sql


class TestEnsureSplitForAllComponentes:
    def test_cria_e_semeia_irmao_sem_status(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"id": 1}, {"id": 2}]
        cursor.lastrowid = 20

        def execute_side_effect(sql, params=None):
            execute_side_effect.sql = sql
            return None

        cursor.execute.side_effect = execute_side_effect
        # SELECT id,ativo (capa existente), SELECT id,ativo (miolo inexistente),
        # then inserts/seeds. fetchone sequence is hard; stub helpers.

        with patch(
            "services.os_componentes_service._ensure_sub_os_for_componente_cursor",
            side_effect=[10, 20],
        ):
            with patch(
                "services.os_componentes_service._fetch_main_operacional_andamento",
                return_value={
                    "CodStatus": "013962026-01",
                    "SituacaoLink": "Saída p/",
                    "SetorLink": "SEFOC",
                    "Observaçao": None,
                    "Ponto": "918713",
                },
            ):
                with patch(
                    "services.os_componentes_service._seed_inherited_from_main"
                ) as mock_seed:
                    ids = ensure_split_for_all_componentes(
                        cursor,
                        nro=1396,
                        ano=2026,
                        skip_seed_sub_os_id=20,
                        ponto="918713",
                    )
        assert ids == [10, 20]
        mock_seed.assert_called_once()
        assert mock_seed.call_args.kwargs["sub_os_id"] == 10

    def test_nao_semeia_quando_skip_e_unico(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"id": 2}]
        with patch(
            "services.os_componentes_service._ensure_sub_os_for_componente_cursor",
            return_value=20,
        ):
            with patch(
                "services.os_componentes_service._fetch_main_operacional_andamento",
                return_value={"CodStatus": "x", "SituacaoLink": "Saída p/", "SetorLink": "SEFOC"},
            ):
                with patch(
                    "services.os_componentes_service._seed_inherited_from_main"
                ) as mock_seed:
                    ensure_split_for_all_componentes(
                        cursor, nro=1396, ano=2026, skip_seed_sub_os_id=20
                    )
        mock_seed.assert_not_called()


class TestOsHasAnyManual:
    def test_sql_manual(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"ok": 1}
        assert os_has_any_manual_sub_os_andamento(cursor, 1396, 2026) is True
        sql = cursor.execute.call_args[0][0]
        assert SOURCE_MANUAL_SUB_OS in sql or "manual_sub_os" in sql


class TestDeactivateAll:
    def test_zera_ativo(self):
        cursor = MagicMock()
        deactivate_all_sub_os(cursor, 1396, 2026)
        sql, params = cursor.execute.call_args[0]
        assert "SET ativo = 0" in sql
        assert params == (1396, 2026)


class TestSplitAwareSearchFilter:
    def test_home_split_aware_exclui_principal_dividida(self):
        params = {}
        sql = build_main_or_sub_os_filter_sql(
            setores=["SEFOC"],
            situacoes=["Saída p/"],
            params=params,
            include_sub_os=True,
            split_aware=True,
            require_manual=False,
        )
        assert "sx.ativo = 1" in sql
        assert "NOT (" in sql
        assert "sa_m" not in sql
        assert params["subfx_setor_0"] == "SEFOC"

    def test_painel_sem_sub_os(self):
        params = {}
        sql = build_main_or_sub_os_filter_sql(
            setores=["SEFOC"],
            situacoes=None,
            params=params,
            include_sub_os=False,
            split_aware=True,
            require_manual=False,
        )
        assert "tab_os_sub_os" not in sql


class TestExpandSplitSearchRows:
    def test_substitui_pai_por_sub_os_do_setor(self):
        parent = {
            "nr_os": 1396,
            "ano": 2026,
            "situacao": "Saída p/",
            "setor": "SEFOC",
            "has_sub_os": True,
            "titulo": "Revista",
            "prioridade": "Normal",
        }
        with patch(
            "services.os_search_service.fetch_home_sub_os_rows_for_pairs",
            return_value=[
                {
                    "nr_os": 1396,
                    "ano": 2026,
                    "situacao": "Saída p/",
                    "setor": "SEFOC",
                    "sub_os_id": 11,
                    "display_label": "1396 [Capa]",
                    "componente_nome": "Capa",
                    "componente_id": 1,
                    "parent_nr_os": 1396,
                    "parent_ano": 2026,
                    "kind": "sub_os",
                    "is_sub_os": True,
                }
            ],
        ):
            out = _expand_split_os_search_rows(
                [parent],
                setores=["SEFOC"],
                situacoes=["Saída p/"],
            )
        assert len(out) == 1
        assert out[0]["kind"] == "sub_os"
        assert out[0]["display_label"] == "1396 [Capa]"
        assert out[0]["titulo"] == "Revista"
        assert out[0]["has_sub_os"] is False

    def test_os_unida_permanece_principal(self):
        parent = {
            "nr_os": 100,
            "ano": 2026,
            "situacao": "Saída p/",
            "setor": "SEFOC",
            "has_sub_os": False,
        }
        out = _expand_split_os_search_rows([parent], setores=["SEFOC"])
        assert len(out) == 1
        assert out[0].get("kind") in (None, "main_os")
        assert not out[0].get("is_sub_os")


class TestDedupeSearchRows:
    def test_mantem_duas_sub_os_da_mesma_os(self):
        rows = [
            {"nr_os": 1396, "ano": 2026, "kind": "sub_os", "sub_os_id": 1},
            {"nr_os": 1396, "ano": 2026, "kind": "sub_os", "sub_os_id": 2},
        ]
        out = _dedupe_os_search_rows(rows)
        assert len(out) == 2


class TestUnirHistoryFlag:
    def test_history_item_aceita_unir_sub_os(self):
        from routers.os_routes import HistoryItem

        item = HistoryItem(
            situacao="Saída p/",
            setor="SEFOC",
            obs="",
            usuario="918713",
            unir_sub_os=True,
        )
        assert item.unir_sub_os is True
        assert SOURCE_INHERITED_MAIN_OS == "inherited_main_os"
