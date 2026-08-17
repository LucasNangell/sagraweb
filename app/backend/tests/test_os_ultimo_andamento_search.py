"""Tabela materializada + busca OS otimizada + ordenação default."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.os_search_service import (
    OS_SEARCH_DEFAULT_ORDER,
    _details_filter_exists_sql,
    _legacy_andamento_join_sql,
    _materialized_andamento_join_sql,
    _os_search_default_date_sql,
    _os_search_priority_rank_sql,
    execute_os_search,
)
from services.os_ultimo_andamento_service import (
    fetch_operacional_row,
    refresh_os_ultimo_andamento_operacional,
)

_MAT_POPULATED = "services.os_search_service.materialized_table_populated"


class TestOsSearchDefaultOrder:
    def test_priority_rank_prometido_before_solicitado_before_normal(self):
        sql = _os_search_priority_rank_sql()
        assert "Prometido p/" in sql
        assert "Solicitado p/" in sql
        assert "THEN 1" in sql
        assert "THEN 2" in sql
        assert "ELSE 3" in sql

    def test_default_date_uses_entregdata_with_dataentrada_fallback(self):
        sql = _os_search_default_date_sql()
        assert "COALESCE(p.EntregData, p.DataEntrada)" in sql

    def test_default_order_includes_priority_date_and_tiebreak(self):
        sql = OS_SEARCH_DEFAULT_ORDER
        assert "COALESCE(p.EntregData, p.DataEntrada) ASC" in sql
        assert "p.AnoProtocolo DESC" in sql
        assert "p.NroProtocolo DESC" in sql


class TestOperacionalSelectSql:
    def test_ranking_usa_ultimostatus1_tabandamento(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {
            "cod_status": "000012026-02",
            "situacao": "Em Execução",
            "setor": "SEFOC",
            "data": "2026-01-01",
            "observacao": "obs",
            "ponto": "12345",
            "ultimo_status": 1,
        }
        row = fetch_operacional_row(1, 2026, cursor=cursor)
        assert row["cod_status"] == "000012026-02"
        sql = " ".join(str(c.args[0]) for c in cursor.execute.call_args_list)
        assert "UltimoStatus = 1" in sql
        assert "`Data` DESC" in sql
        assert "CodStatus DESC" in sql
        assert "cod_status_espelho" in sql.lower()


class TestRefreshMaterialized:
    def test_delete_quando_sem_andamento(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        refresh_os_ultimo_andamento_operacional(99, 2026, cursor=cursor)
        delete_calls = [
            c for c in cursor.execute.call_args_list if "DELETE FROM" in str(c.args[0])
        ]
        assert delete_calls

    def test_upsert_quando_ha_andamento(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {
            "cod_status": "x",
            "situacao": "s",
            "setor": "SEFOC",
            "data": None,
            "observacao": None,
            "ponto": None,
            "ultimo_status": 1,
        }
        refresh_os_ultimo_andamento_operacional(1, 2026, cursor=cursor)
        upsert_calls = [
            c for c in cursor.execute.call_args_list if "INSERT INTO" in str(c.args[0])
        ]
        assert upsert_calls


class TestOsSearchDetailsFilter:
    def test_exists_em_vez_de_join_global(self):
        params: dict = {}
        sql = _details_filter_exists_sql(
            produto_term="folder",
            titulo_term=None,
            params=params,
        )
        assert "EXISTS" in sql
        assert "tabDetalhesServico" in sql
        assert "produto_like" in params


class TestOsSearchDetailsEnrich:
    @patch("services.os_search_service.db")
    def test_enrich_overwrites_null_placeholders(self, mock_db):
        from services.os_search_service import _enrich_rows_with_details

        mock_db.execute_query.return_value = [
            {
                "nr_os": 988,
                "ano": 2026,
                "titulo": "Adesivo",
                "produto": "Impresso",
                "formato": "A4",
            }
        ]
        rows = [
            {
                "nr_os": 988,
                "ano": 2026,
                "titulo": None,
                "produto": None,
                "formato": None,
            }
        ]
        out = _enrich_rows_with_details(rows)
        assert out[0]["titulo"] == "Adesivo"
        assert out[0]["produto"] == "Impresso"
        assert out[0]["formato"] == "A4"


class TestOsSearchMaterializedAndamento:
    @patch("services.os_search_service._prefer_materialized_andamento", return_value=True)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_join_materializada_sem_row_number(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "tab_os_ultimo_andamento_operacional" in sql
        assert "ROW_NUMBER()" not in sql
        assert "a_op.situacao" in sql
        assert "a_live.SituacaoLink" in sql

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_default_uses_tabandamento_live_join(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "ROW_NUMBER()" in sql
        assert "a_op.SituacaoLink" in sql
        assert "tab_os_ultimo_andamento_operacional" not in sql

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=True)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_setor_filter_uses_left_join_not_inner_driver(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(
            simple_pagination=True,
            include_finished=False,
            setor=["SEFOC"],
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "FROM tabProtocolos" in sql
        assert "LEFT JOIN tab_os_ultimo_andamento_operacional" in sql
        assert "INNER JOIN tabProtocolos" not in sql
        assert "subfx_setor" in sql
        assert "a_live.SetorLink" in sql


class TestOsSearchActiveFilter:
    @patch("services.os_search_service._prefer_materialized_andamento", return_value=True)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_active_filter_allows_null_or_non_finished(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(solicitante="Gab", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "IS NULL OR" in sql
        assert "'Entregue'" in sql
        assert "a_live.SituacaoLink" in sql

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_active_filter_live_uses_situacao_link(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(solicitante="Gab", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "IS NULL OR" in sql
        assert "a_live.SituacaoLink" in sql

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=True)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_excludes_finished_when_not_included(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(simple_pagination=True, include_finished=False)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "'Entregue'" in sql
        assert "'Cancelada'" in sql

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_exact_os_lookup_skips_setor_situacao_filters(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(
            nr_os=2244,
            ano=2026,
            situacao=["Em Execução"],
            setor=["SEFOC"],
            prioridade=["Normal"],
            exact_os_lookup=True,
            simple_pagination=True,
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "p.NroProtocolo = %(nr_os)s" in sql
        assert "subfx_setor" not in sql
        assert "subfx_sit" not in sql
        assert "prio_0" not in sql

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch(
        "services.os_search_service._enrich_operacional_from_live",
        side_effect=lambda rows: [
            {
                **r,
                "situacao": "Em Execução" if int(r["ano"]) == 2026 else "Entregue",
                "setor": "SEFOC" if int(r["ano"]) == 2026 else "OUTRO",
            }
            for r in rows
        ],
    )
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_exact_os_lookup_applies_choice_filters_after_enrich(
        self, _enrich, _live, mock_db, _pop, _prefer
    ):
        mock_db.execute_query.return_value = [
            {
                "nr_os": 2244,
                "ano": 2026,
                "prioridade": "Normal",
                "has_sub_os": False,
            },
            {
                "nr_os": 2244,
                "ano": 2025,
                "prioridade": "Normal",
                "has_sub_os": False,
            },
        ]
        result = execute_os_search(
            nr_os=2244,
            situacao=["Em Execução"],
            setor=["SEFOC"],
            prioridade=["Normal"],
            exact_os_lookup=True,
            simple_pagination=True,
            include_finished=True,
        )
        assert len(result["data"]) == 1
        assert result["data"][0]["ano"] == 2026
        assert result["data"][0]["situacao"] == "Em Execução"

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch(
        "services.os_search_service._enrich_operacional_from_live",
        side_effect=lambda rows: rows,
    )
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_exact_os_lookup_applies_os_sp_toggles_after_enrich(
        self, _enrich, _live, mock_db, _pop, _prefer
    ):
        mock_db.execute_query.return_value = [
            {"nr_os": 100, "ano": 2026, "prioridade": "Normal", "has_sub_os": False},
            {"nr_os": 5100, "ano": 2026, "prioridade": "Normal", "has_sub_os": False},
        ]
        result = execute_os_search(
            nr_os=100,
            include_os=False,
            include_sp=True,
            exact_os_lookup=True,
            simple_pagination=True,
            include_finished=True,
        )
        assert [int(r["nr_os"]) for r in result["data"]] == [5100]

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_exact_os_lookup_skips_os_sp_toggles(self, _enrich, mock_db, _pop, _prefer):
        mock_db.execute_query.return_value = []
        execute_os_search(
            nr_os=100,
            include_os=False,
            include_sp=False,
            exact_os_lookup=True,
            simple_pagination=True,
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "p.NroProtocolo >= 5000" not in sql
        assert "p.NroProtocolo < 5000" not in sql

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=True)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_exact_os_lookup_skips_global_andamento_join(
        self, _enrich, mock_db, _pop, _prefer
    ):
        mock_db.execute_query.return_value = []
        execute_os_search(
            nr_os=2244,
            exact_os_lookup=True,
            simple_pagination=True,
            include_total=True,
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "p.NroProtocolo = %(nr_os)s" in sql
        assert "ROW_NUMBER()" not in sql
        assert "tabAndamento" not in sql
        assert mock_db.execute_query.call_count == 1

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_exact_os_lookup_skips_count_even_when_requested(
        self, _enrich, mock_db, _pop, _prefer
    ):
        mock_db.execute_query.return_value = []
        execute_os_search(
            nr_os=2244,
            exact_os_lookup=True,
            simple_pagination=True,
            include_total=True,
        )
        assert mock_db.execute_query.call_count == 1
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "COUNT(DISTINCT" not in sql
        assert "ROW_NUMBER()" not in sql


class TestOsSearchSimplePagination:
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_simple_pagination_sem_count(self, _enrich, mock_db, _pop):
        mock_db.execute_query.return_value = [{"nr_os": 1, "ano": 2026}]
        result = execute_os_search(simple_pagination=True, include_total=False)
        assert result["meta"]["simple_pagination"] is True
        assert "total_records" not in result["meta"]
        assert mock_db.execute_query.call_count == 1


class TestOsSearchDisplayedAndamentoFilter:
    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch(
        "services.os_search_service._enrich_operacional_from_live",
        side_effect=lambda rows: [
            {
                **r,
                "situacao": "Na Fila",
                "setor": "Impressão",
            }
            for r in rows
        ],
    )
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_paginated_search_drops_rows_after_live_enrich_mismatch(
        self, _enrich, _live, mock_db, _pop, _prefer
    ):
        mock_db.execute_query.return_value = [
            {
                "nr_os": 100,
                "ano": 2026,
                "situacao": "Em Execução",
                "setor": "SEFOC",
                "has_sub_os": False,
            }
        ]
        result = execute_os_search(
            simple_pagination=True,
            include_finished=True,
            situacao=["Em Execução"],
            setor=["SEFOC"],
        )
        assert result["data"] == []

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch(
        "services.os_search_service._enrich_operacional_from_live",
        side_effect=lambda rows: [
            {
                **r,
                "situacao": "Em Execução",
                "setor": "SEFOC",
            }
            for r in rows
        ],
    )
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_paginated_search_keeps_rows_when_live_enrich_matches(
        self, _enrich, _live, mock_db, _pop, _prefer
    ):
        mock_db.execute_query.return_value = [
            {
                "nr_os": 100,
                "ano": 2026,
                "situacao": "Em Execução",
                "setor": "SEFOC",
                "has_sub_os": False,
            }
        ]
        result = execute_os_search(
            simple_pagination=True,
            include_finished=True,
            situacao=["Em Execução"],
            setor=["SEFOC"],
        )
        assert len(result["data"]) == 1
        assert result["data"][0]["nr_os"] == 100

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=False)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch(
        "services.os_search_service._enrich_operacional_from_live",
        side_effect=lambda rows: [
            {
                **r,
                "situacao": "Na Fila",
                "setor": "SEFOC",
            }
            for r in rows
        ],
    )
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_exact_os_lookup_does_not_keep_row_via_sub_os(
        self, _enrich, _live, mock_db, _pop, _prefer
    ):
        mock_db.execute_query.return_value = [
            {
                "nr_os": 2244,
                "ano": 2026,
                "prioridade": "Normal",
                "has_sub_os": True,
            }
        ]
        result = execute_os_search(
            nr_os=2244,
            situacao=["Em Execução"],
            setor=["SEFOC"],
            exact_os_lookup=True,
            simple_pagination=True,
            include_finished=True,
        )
        assert result["data"] == []

    @patch("services.os_search_service._prefer_materialized_andamento", return_value=True)
    @patch(_MAT_POPULATED, return_value=True)
    @patch("services.os_search_service.db")
    @patch("services.os_search_service._enrich_rows_with_details", side_effect=lambda r: r)
    def test_paginated_situacao_filter_uses_live_scalar_like_nr_os_lookup(
        self, _enrich, mock_db, _pop, _prefer
    ):
        """Lista sem Nr OS deve filtrar o mesmo UltimoStatus=1 live do lookup exato."""
        mock_db.execute_query.return_value = []
        execute_os_search(
            simple_pagination=True,
            include_finished=True,
            situacao=["Comentário"],
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "a_live.SituacaoLink" in sql
        assert "subfx_sit_0" in sql
        assert "a_op.nro_protocolo IS NULL" not in sql


class TestLegacyAndamentoJoinExport:
    def test_materialized_join_exposed(self):
        sql = _materialized_andamento_join_sql()
        assert "tab_os_ultimo_andamento_operacional" in sql
        assert "ROW_NUMBER()" not in sql

    def test_legacy_live_join_still_available(self):
        with patch(
            "services.os_search_service.get_andamento_table",
            return_value="tabAndamento",
        ):
            sql = _legacy_andamento_join_sql()
        assert "ROW_NUMBER()" in sql
        assert "UltimoStatus = 1" in sql
        assert "FROM tabAndamento AS a2" in sql
        assert "cod_status_espelho" in sql.lower()
