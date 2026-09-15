"""Short-circuit de sync_lookup_tables_from_mdb_if_empty — sem Access no caminho quente."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import lookup_sync


def _reset_ttl() -> None:
    lookup_sync._lookup_populated_until_monotonic = 0.0


class TestSyncLookupTablesFromMdbIfEmpty:
    def setup_method(self) -> None:
        _reset_ttl()

    def teardown_method(self) -> None:
        _reset_ttl()

    @patch("lookup_sync._mdb_connection")
    @patch("lookup_sync._table_empty", return_value=False)
    @patch("lookup_sync._table_exists", return_value=True)
    @patch("lookup_sync.config_manager")
    def test_populated_tables_skip_mdb(
        self, _cfg, _exists, _empty, mock_mdb
    ) -> None:
        lookup_sync.sync_lookup_tables_from_mdb_if_empty()
        mock_mdb.assert_not_called()

    @patch("lookup_sync._mdb_connection")
    @patch("lookup_sync._table_empty", return_value=True)
    @patch("lookup_sync._table_exists", return_value=True)
    @patch("lookup_sync.config_manager")
    def test_mysql_only_empty_skips_mdb(
        self, mock_cfg, _exists, _empty, mock_mdb
    ) -> None:
        mock_cfg.is_mysql_only.return_value = True
        lookup_sync.sync_lookup_tables_from_mdb_if_empty()
        mock_mdb.assert_not_called()

    @patch("lookup_sync._sync_tabformatos")
    @patch("lookup_sync._sync_tabcores")
    @patch("lookup_sync._sync_tabpapel")
    @patch("lookup_sync._sync_tabcategorias")
    @patch("lookup_sync._mdb_connection")
    @patch("lookup_sync._table_empty", return_value=True)
    @patch("lookup_sync._table_exists", return_value=True)
    @patch("lookup_sync.config_manager")
    def test_access_enabled_empty_opens_mdb(
        self,
        mock_cfg,
        _exists,
        _empty,
        mock_mdb,
        mock_cats,
        mock_papel,
        mock_cores,
        mock_formatos,
    ) -> None:
        mock_cfg.is_mysql_only.return_value = False
        conn = MagicMock()
        mock_mdb.return_value = conn

        lookup_sync.sync_lookup_tables_from_mdb_if_empty()

        mock_mdb.assert_called_once()
        conn.cursor.assert_called_once()
        mock_cats.assert_called_once()
        mock_papel.assert_called_once()
        mock_cores.assert_called_once()
        mock_formatos.assert_called_once()
        conn.close.assert_called_once()

    @patch("lookup_sync._mdb_connection")
    @patch("lookup_sync._table_empty", return_value=False)
    @patch("lookup_sync._table_exists", return_value=True)
    @patch("lookup_sync.config_manager")
    def test_second_call_within_ttl_skips_mysql_and_mdb(
        self, _cfg, mock_exists, mock_empty, mock_mdb
    ) -> None:
        lookup_sync.sync_lookup_tables_from_mdb_if_empty()
        mock_mdb.assert_not_called()
        assert mock_exists.called
        assert mock_empty.called

        mock_exists.reset_mock()
        mock_empty.reset_mock()
        mock_mdb.reset_mock()

        lookup_sync.sync_lookup_tables_from_mdb_if_empty()
        mock_exists.assert_not_called()
        mock_empty.assert_not_called()
        mock_mdb.assert_not_called()
