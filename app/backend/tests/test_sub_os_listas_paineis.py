"""Testes — Sub OS em listas e painéis (filtros virtuais)."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from services.os_sub_os_queries import (
    annotate_search_sub_os_matches,
    build_main_or_sub_os_filter_sql,
    dedupe_queue_rows_with_sub_os,
)


class TestBuildMainOrSubOsFilterSql:
    def test_setor_inclui_exists_sub_os(self):
        params = {}
        sql = build_main_or_sub_os_filter_sql(
            setores=["SIELT"],
            situacoes=None,
            params=params,
        )
        assert "a.SetorLink IN" in sql
        assert "EXISTS" in sql
        assert "sa.setor IN" in sql
        assert "sa.ultimo_status = 1" in sql
        assert params["subfx_setor_0"] == "SIELT"

    def test_setor_e_situacao_combinados(self):
        params = {}
        sql = build_main_or_sub_os_filter_sql(
            setores=["SIELT"],
            situacoes=["Saída p/ SIELT"],
            params=params,
        )
        assert "a.SetorLink IN" in sql
        assert "a.SituacaoLink IN" in sql
        assert "sa.setor IN" in sql
        assert "sa.situacao IN" in sql

    def test_vazio_sem_filtro(self):
        assert build_main_or_sub_os_filter_sql(setores=[], situacoes=[], params={}) == ""


class TestAnnotateSearchSubOsMatches:
    def test_marca_quando_main_nao_bate(self):
        rows = [
            {
                "nr_os": 2532,
                "ano": 2026,
                "setor": "SEFOC",
                "situacao": "Em Execução",
                "has_sub_os": True,
            }
        ]
        out = annotate_search_sub_os_matches(rows, setores=["SIELT"], situacoes=None)
        assert out[0]["matched_via_sub_os"] is True

    def test_nao_marca_quando_main_bate(self):
        rows = [
            {
                "nr_os": 100,
                "ano": 2026,
                "setor": "SIELT",
                "situacao": "Em Execução",
                "has_sub_os": True,
            }
        ]
        out = annotate_search_sub_os_matches(rows, setores=["SIELT"], situacoes=None)
        assert out[0]["matched_via_sub_os"] is False


class TestDedupeQueueWithSubOs:
    def test_main_e_sub_os_mesma_os(self):
        rows = [
            {"nr_os": 2532, "ano": 2026, "row_kind": "main_os"},
            {
                "nr_os": 2532,
                "ano": 2026,
                "row_kind": "sub_os",
                "sub_os_id": 7,
            },
        ]
        out = dedupe_queue_rows_with_sub_os(rows)
        assert len(out) == 2


class TestFetchSubOsQueueRows:
    def test_query_usa_ultimo_status(self):
        with patch("services.os_sub_os_queries.db") as mock_db:
            mock_db.execute_query.return_value = []
            from services.os_sub_os_queries import fetch_sub_os_queue_rows

            fetch_sub_os_queue_rows(base_setor="SIELT", display_setor="SIELT")
            sql = mock_db.execute_query.call_args[0][0]
            assert "ultimo_status = 1" in sql
            assert "row_kind" in sql
