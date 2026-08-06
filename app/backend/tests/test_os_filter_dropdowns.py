"""Dropdowns inteligentes — ano modo, produtos/solicitantes múltiplos."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from services.os_filter_options_service import normalize_label, search_products
from services.os_search_service import (
    OS_SEARCH_MAX_MULTI_FILTER_ITEMS,
    _clean_multi_filter_values,
    execute_os_search,
)

_ENRICH = "services.os_search_service._enrich_rows_with_details"
_DB = "services.os_search_service.db"
_FT = "services.os_search_service.fulltext_text_search_indexes_ready"


class TestCleanMultiFilterValues:
    def test_dedupes_and_trims(self):
        assert _clean_multi_filter_values([" A ", "A", "", "B"]) == ["A", "B"]


class TestAnoModeSearch:
    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_ano_specific_equals(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(ano=2025, ano_mode="specific", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "p.AnoProtocolo = %(ano)s" in sql
        assert "p.AnoProtocolo >= %(ano)s" not in sql

    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_ano_from_gte(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(ano=2024, ano_mode="from", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "p.AnoProtocolo >= %(ano)s" in sql

    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_anos_in_overrides_ano_mode(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(
            anos=[2025, 2026],
            ano=2020,
            ano_mode="from",
            simple_pagination=True,
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        params = mock_db.execute_query.call_args.args[1]
        assert "p.AnoProtocolo IN" in sql
        assert "p.AnoProtocolo >= %(ano)s" not in sql
        assert "p.AnoProtocolo = %(ano)s" not in sql
        assert params["ano_sel_0"] == 2025
        assert params["ano_sel_1"] == 2026


class TestProcessoCategoriaMaquinaSearch:
    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_processo_prefix(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(processo="12.345", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        params = mock_db.execute_query.call_args.args[1]
        assert "p.ProcessoSolicit LIKE %(processo_prefix)s" in sql
        assert params["processo_prefix"].startswith("12345")
        assert params["processo_prefix"].endswith("%")
        assert "." not in params["processo_prefix"]

    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_processo_exact_when_full(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(processo="12.345.678/9012", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        params = mock_db.execute_query.call_args.args[1]
        assert "p.ProcessoSolicit = %(processo_exact)s" in sql
        assert params["processo_exact"] == "123456789012"

    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_categorias_in(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(categorias=["Deputado", "Senado"], simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        params = mock_db.execute_query.call_args.args[1]
        assert "p.CategoriaLink IN" in sql
        assert params["cat_sel_0"] == "Deputado"
        assert params["cat_sel_1"] == "Senado"

    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_maquinas_exists(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(maquinas=["A1", "B2"], simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        params = mock_db.execute_query.call_args.args[1]
        assert "MaquinaLink IN" in sql
        assert "EXISTS" in sql
        assert params["maq_sel_0"] == "A1"
        assert params["maq_sel_1"] == "B2"


class TestMultiSelectSearch:
    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_produtos_in_exists(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(
            produtos=["Cartão", "Folder"],
            simple_pagination=True,
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        params = mock_db.execute_query.call_args.args[1]
        assert "TipoPublicacaoLink IN" in sql
        assert "EXISTS" in sql
        assert "MATCH" not in sql
        assert params["prod_sel_0"] == "Cartão"
        assert params["prod_sel_1"] == "Folder"

    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_solicitantes_in(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(
            solicitantes=["João", "Maria"],
            simple_pagination=True,
        )
        sql = str(mock_db.execute_query.call_args.args[0])
        params = mock_db.execute_query.call_args.args[1]
        assert "p.NomeUsuario IN" in sql
        assert params["sol_sel_0"] == "João"
        assert params["sol_sel_1"] == "Maria"

    @patch(_FT, return_value=True)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_legacy_produto_fulltext_when_no_array(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(produto="folder", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "MATCH" in sql

    @patch(_FT, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_max_produtos_raises(self, _enrich, mock_db, _ft):
        too_many = [f"P{i}" for i in range(OS_SEARCH_MAX_MULTI_FILTER_ITEMS + 1)]
        with pytest.raises(ValueError, match="produtos"):
            execute_os_search(produtos=too_many, simple_pagination=True)


class TestFilterOptionsNormalize:
    def test_normalize_label(self):
        assert normalize_label("  João  ") == "joao"


class TestFilterOptionsProducts:
    @patch("services.os_filter_options_service._table_has_rows", return_value=True)
    @patch("services.os_filter_options_service.db")
    def test_prefix_search_on_aux_table(self, mock_db, _has_rows):
        mock_db.execute_query.return_value = [
            {"value": "Cartão", "label": "Cartão", "count": 10},
        ]
        rows = search_products(q="cart", limit=30)
        assert rows[0]["value"] == "Cartão"
        sql = mock_db.execute_query.call_args.args[0]
        assert "produto_normalizado LIKE" in sql
