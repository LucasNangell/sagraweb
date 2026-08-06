"""Busca textual FULLTEXT — lista de OSs."""
from __future__ import annotations

from unittest.mock import patch

from services.os_search_service import (
    _details_filter_fulltext_sql,
    _details_filter_like_sql,
    _solicitante_filter_sql,
    execute_os_search,
)
from services.os_text_search_utils import (
    build_fulltext_boolean_query,
    is_text_search_term_too_short,
    parse_text_search_term,
)

_FT_READY = "services.os_search_service.fulltext_text_search_indexes_ready"
_ENRICH = "services.os_search_service._enrich_rows_with_details"
_DB = "services.os_search_service.db"


class TestFulltextBooleanQuery:
    def test_multi_word_tokens(self):
        q = build_fulltext_boolean_query("cartao visita")
        assert q == "+cartao* +visita*"

    def test_ignores_stopwords(self):
        q = build_fulltext_boolean_query("relatorio da camara")
        assert q is not None
        assert "+relatorio*" in q
        assert "+camara*" in q
        assert "da" not in q.split()

    def test_escapes_special_chars(self):
        q = build_fulltext_boolean_query("test@email")
        assert "@" not in (q or "")


class TestTextTermParsing:
    def test_short_term_rejected_without_anchor(self):
        assert parse_text_search_term("ab", has_nr_os=False, has_ano=False) is None
        assert is_text_search_term_too_short("ab") is True

    def test_short_allowed_with_nr_os(self):
        assert parse_text_search_term("12", has_nr_os=True, has_ano=False) == "12"

    def test_short_rejected_even_with_ano(self):
        assert parse_text_search_term("ab", has_nr_os=False, has_ano=True) is None
        assert is_text_search_term_too_short("ab", has_ano=True) is True


class TestDetailsFulltextSql:
    def test_produto_uses_match(self):
        params: dict = {}
        sql = _details_filter_fulltext_sql(
            produto_term="folder",
            titulo_term=None,
            params=params,
        )
        assert "MATCH(d_f.TipoPublicacaoLink)" in sql
        assert "AGAINST" in sql
        assert "ft_produto" in params
        assert "LIKE" not in sql

    def test_titulo_uses_match(self):
        params: dict = {}
        sql = _details_filter_fulltext_sql(
            produto_term=None,
            titulo_term="relatorio",
            params=params,
        )
        assert "MATCH(d_f.Titulo)" in sql
        assert "ft_titulo" in params

    def test_both_fields_anded(self):
        params: dict = {}
        sql = _details_filter_fulltext_sql(
            produto_term="impresso",
            titulo_term="cartao",
            params=params,
        )
        assert "TipoPublicacaoLink" in sql
        assert "Titulo" in sql
        assert "ft_produto" in params
        assert "ft_titulo" in params


class TestSolicitanteFilter:
    def test_fulltext_mode(self):
        params: dict = {}
        sql, mode = _solicitante_filter_sql(
            solicitante_term="Gabriel",
            params=params,
            use_fulltext=True,
        )
        assert mode == "fulltext"
        assert "MATCH(p.NomeUsuario)" in sql
        assert "ft_solicitante" in params

    def test_prefix_fallback(self):
        params: dict = {}
        sql, mode = _solicitante_filter_sql(
            solicitante_term="Gabriel",
            params=params,
            use_fulltext=False,
        )
        assert mode == "prefix"
        assert "LIKE" in sql
        assert params["solicitante_prefix"].startswith("Gabriel")
        assert not params["solicitante_prefix"].startswith("%")


class TestExecuteOsSearchTextPaths:
    @patch(_FT_READY, return_value=True)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_search_uses_fulltext_not_like(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        with patch(
            "services.os_search_service.materialized_table_populated",
            return_value=True,
        ):
            execute_os_search(titulo="relatorio", produto="folder", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "MATCH" in sql
        assert "AGAINST" in sql
        assert "LIKE %(titulo_like)s" not in sql
        assert "LIKE %(produto_like)s" not in sql

    @patch(_FT_READY, return_value=True)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_titulo_uses_inverted_driver_without_row_number(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        with patch(
            "services.os_search_service.materialized_table_populated",
            return_value=True,
        ):
            execute_os_search(titulo="relatorio", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "MATCH(d_ft.Titulo)" in sql
        assert "ROW_NUMBER()" not in sql
        assert "tabAndamento" not in sql
        assert "INNER JOIN tabProtocolos AS p" in sql

    @patch(_FT_READY, return_value=True)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_solicitante_fulltext(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(solicitante="Silva", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "MATCH(p.NomeUsuario)" in sql

    @patch(_FT_READY, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_short_text_not_in_sql(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(titulo="ab", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "MATCH" not in sql
        assert "titulo_like" not in sql

    @patch(_FT_READY, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_short_text_with_ano_still_ignored(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        execute_os_search(titulo="ab", ano=2025, simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "MATCH" not in sql
        assert "titulo_like" not in sql

    @patch(_FT_READY, return_value=False)
    @patch(_DB)
    @patch(_ENRICH, side_effect=lambda r: r)
    def test_slow_like_only_when_enabled(self, _enrich, mock_db, _ft):
        mock_db.execute_query.return_value = []
        with patch("services.os_search_service._allow_slow_text_fallback", return_value=True):
            execute_os_search(titulo="relatorio", simple_pagination=True)
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "LIKE %(titulo_like)s" in sql
