"""Busca OS — limites, filtros LIKE e SQL de andamento operacional."""
from __future__ import annotations

from routers.os_routes import (
    OS_SEARCH_FETCH_ALL_MAX_LIMIT,
    OS_SEARCH_MAX_LIMIT,
    OS_SEARCH_MIN_LIKE_CHARS,
    _clamp_os_search_pagination,
    _dedupe_os_search_rows,
    _os_search_like_term,
)
from services.os_search_service import (
    _legacy_andamento_join_sql,
    _materialized_andamento_join_sql,
    _resolve_os_search_pagination,
)


class TestOsSearchGuards:
    def test_clamp_pagination(self):
        page, limit = _clamp_os_search_pagination(0, 500)
        assert page == 1
        assert limit == OS_SEARCH_MAX_LIMIT

    def test_clamp_minimum_limit(self):
        page, limit = _clamp_os_search_pagination(2, 0)
        assert page == 2
        assert limit == 1

    def test_fetch_all_uses_home_cap_not_page_limit(self):
        page, limit, max_limit = _resolve_os_search_pagination(
            3, 20, fetch_all=True
        )
        assert page == 1
        assert limit == OS_SEARCH_FETCH_ALL_MAX_LIMIT
        assert max_limit == OS_SEARCH_FETCH_ALL_MAX_LIMIT
        assert limit > OS_SEARCH_MAX_LIMIT

    def test_fetch_all_cap_is_100000(self):
        assert OS_SEARCH_FETCH_ALL_MAX_LIMIT == 100_000

    def test_like_term_short_without_os_filter(self):
        assert _os_search_like_term("ab", has_nr_os=False, has_ano=False) is None

    def test_like_term_short_allowed_with_nr_os(self):
        assert (
            _os_search_like_term("ab", has_nr_os=True, has_ano=False) == "ab"
        )

    def test_like_term_minimum_length(self):
        term = "abc"
        assert (
            _os_search_like_term(term, has_nr_os=False, has_ano=False) == term
        )
        assert len(term) >= OS_SEARCH_MIN_LIKE_CHARS


class TestOsSearchAndamentoJoin:
    def test_search_uses_materialized_join(self):
        sql = _materialized_andamento_join_sql()
        assert "tab_os_ultimo_andamento_operacional" in sql
        assert "ROW_NUMBER()" not in sql
        assert "nro_protocolo" in sql

    def test_legacy_live_join_preserved_for_debug(self):
        sql = _legacy_andamento_join_sql()
        assert "ROW_NUMBER()" in sql
        assert "PARTITION BY a2.NroProtocoloLink, a2.AnoProtocoloLink" in sql
        assert "ranked._rn = 1" in sql


class TestOsSearchPaginationDedupe:
    def test_has_next_uses_raw_rows_before_dedupe(self):
        limit = 20
        raw = [{"nr_os": i, "ano": 2026} for i in range(21)]
        raw.extend({"nr_os": 1, "ano": 2026} for _ in range(5))
        has_next_raw = len(raw) > limit
        deduped = _dedupe_os_search_rows(raw)
        assert has_next_raw is True
        assert len(deduped) == 21
        page_rows = deduped[:limit]
        assert len(page_rows) == 20
