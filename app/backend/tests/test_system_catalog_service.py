"""Testes do catálogo administrável do sistema."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from services import system_catalog_service as svc


class TestSystemCatalogMerge(unittest.TestCase):
    @patch("services.system_catalog_service._fetch_catalog_rows")
    def test_merge_keeps_dynamic_when_not_in_catalog(self, mock_catalog):
        mock_catalog.return_value = []
        result = svc.merge_catalog_labels("setor", ["Arte", "Impressão"])
        self.assertEqual(result, ["Arte", "Gravação", "Impressão"])

    @patch("services.system_catalog_service._fetch_catalog_rows")
    def test_merge_hides_deactivated_usage_item(self, mock_catalog):
        mock_catalog.return_value = [
            {"Rotulo": "Arte", "Ativo": 0},
        ]
        result = svc.merge_catalog_labels("setor", ["Arte", "Impressão"])
        self.assertNotIn("Arte", result)
        self.assertIn("Impressão", result)

    @patch("services.system_catalog_service._fetch_catalog_rows")
    def test_merge_adds_catalog_only_active_item(self, mock_catalog):
        mock_catalog.return_value = [
            {"Rotulo": "Novo Setor", "Ativo": 1},
            {"Rotulo": "Oculto", "Ativo": 0},
        ]
        result = svc.merge_catalog_labels("produto", ["Folder"])
        self.assertIn("Folder", result)
        self.assertIn("Novo Setor", result)
        self.assertNotIn("Oculto", result)

    @patch("services.system_catalog_service.merge_catalog_labels")
    def test_apply_catalog_to_filter_rows_adds_catalog_only(self, mock_merge):
        mock_merge.return_value = ["Folder", "Cartaz"]
        rows = [{"value": "Folder", "label": "Folder", "count": 3}]
        result = svc.apply_catalog_to_filter_rows("produto", rows, limit=10)
        self.assertEqual(len(result), 2)
        values = {row["value"] for row in result}
        self.assertEqual(values, {"Folder", "Cartaz"})


class TestSystemCatalogAcabamento(unittest.TestCase):
    def test_acabamento_is_valid_category(self):
        self.assertIn("acabamento", svc.VALID_CATEGORIES)
        meta = svc.VALID_CATEGORIES["acabamento"]
        self.assertEqual(meta["label"], "Acabamentos")

    def test_list_categories_includes_acabamento(self):
        keys = {item["key"] for item in svc.list_categories_meta()}
        self.assertIn("acabamento", keys)

    def test_fetch_dynamic_labels_acabamento_is_empty(self):
        self.assertEqual(svc._fetch_dynamic_labels("acabamento"), [])

    @patch("services.system_catalog_service._fetch_catalog_rows")
    def test_merge_acabamento_only_active_catalog(self, mock_catalog):
        mock_catalog.return_value = [
            {"Rotulo": "Dobra", "Ativo": 1},
            {"Rotulo": "Verniz", "Ativo": 0},
        ]
        result = svc.merge_catalog_labels("acabamento", [])
        self.assertEqual(result, ["Dobra"])
        self.assertNotIn("Verniz", result)

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_create_acabamento_item(self, _mock_ensure, mock_db):
        mock_db.execute_query.side_effect = [
            [],  # existing check
            None,  # insert
            [{"ID": 42}],  # fetch id
            [  # _get_catalog_row
                {
                    "ID": 42,
                    "Categoria": "acabamento",
                    "Rotulo": "Hot Stamping",
                    "Ativo": 1,
                    "Ordem": 50,
                    "Origem": "catalog",
                    "CriadoEm": None,
                    "AtualizadoEm": None,
                    "AtualizadoPorPonto": "1",
                }
            ],
        ]
        created = svc.create_catalog_item(
            "acabamento", label="Hot Stamping", ordem=50, updated_by_ponto="1"
        )
        self.assertEqual(created["label"], "Hot Stamping")
        self.assertEqual(created["category"], "acabamento")
        self.assertTrue(created["active"])

    @patch("services.system_catalog_service._fetch_dynamic_labels", return_value=[])
    @patch("services.system_catalog_service.db")
    def test_deactivate_and_delete_acabamento(self, mock_db, _mock_dyn):
        row_active = {
            "ID": 7,
            "Categoria": "acabamento",
            "Rotulo": "Faca",
            "Ativo": 1,
            "Ordem": 80,
            "Origem": "catalog",
            "CriadoEm": None,
            "AtualizadoEm": None,
            "AtualizadoPorPonto": None,
        }
        row_inactive = {**row_active, "Ativo": 0}
        mock_db.execute_query.side_effect = [
            [row_active],  # _get_catalog_row before deactivate
            None,  # UPDATE
            [row_inactive],  # _get_catalog_row after deactivate
            [row_inactive],  # _get_catalog_row for delete
            None,  # DELETE
        ]
        deactivated = svc.set_catalog_item_active(
            "acabamento", 7, active=False, updated_by_ponto="1"
        )
        self.assertFalse(deactivated["active"])

        svc.delete_catalog_item("acabamento", 7)
        delete_calls = [
            c
            for c in mock_db.execute_query.call_args_list
            if c.args and "DELETE FROM tabSystemCatalog" in str(c.args[0])
        ]
        self.assertEqual(len(delete_calls), 1)


class TestAcabamentoVariacoes(unittest.TestCase):
    """Testes do CRUD de variações de acabamento."""

    def _make_variacao_row(self, **kwargs) -> dict:
        base = {
            "ID": 1,
            "CatalogID": 10,
            "Rotulo": "Fosca",
            "Ativo": 1,
            "Ordem": 10,
            "CriadoEm": None,
            "AtualizadoEm": None,
            "AtualizadoPorPonto": None,
        }
        base.update(kwargs)
        return base

    def _make_catalog_row(self, **kwargs) -> dict:
        base = {
            "ID": 10,
            "Categoria": "acabamento",
            "Rotulo": "Laminação",
        }
        base.update(kwargs)
        return base

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_list_variacoes(self, _mock_ensure, mock_db):
        catalog_row = self._make_catalog_row()
        variacao_row = self._make_variacao_row()
        mock_db.execute_query.side_effect = [
            [catalog_row],  # _require_acabamento_item
            [variacao_row],  # SELECT variacoes
        ]
        result = svc.list_variacoes(10)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["label"], "Fosca")
        self.assertTrue(result[0]["active"])
        self.assertEqual(result[0]["catalog_id"], 10)

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_create_variacao(self, _mock_ensure, mock_db):
        catalog_row = self._make_catalog_row()
        variacao_row = self._make_variacao_row(ID=5, Rotulo="Brilho")
        mock_db.execute_query.side_effect = [
            [catalog_row],  # _require_acabamento_item
            [],             # existing check (no duplicate)
            None,           # INSERT
            [variacao_row], # SELECT after insert
        ]
        result = svc.create_variacao(10, label="Brilho", updated_by_ponto="1")
        self.assertEqual(result["label"], "Brilho")
        self.assertEqual(result["id"], 5)

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_create_variacao_duplicate_raises(self, _mock_ensure, mock_db):
        catalog_row = self._make_catalog_row()
        mock_db.execute_query.side_effect = [
            [catalog_row],          # _require_acabamento_item
            [{"ID": 1}],            # existing check → duplicate found
        ]
        with self.assertRaises(ValueError) as ctx:
            svc.create_variacao(10, label="Fosca")
        self.assertIn("já está cadastrado", str(ctx.exception))

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_create_variacao_invalid_category_raises(self, _mock_ensure, mock_db):
        mock_db.execute_query.return_value = [
            {"ID": 99, "Categoria": "produto", "Rotulo": "Folder"},
        ]
        with self.assertRaises(ValueError) as ctx:
            svc.create_variacao(99, label="A4")
        self.assertIn("Acabamentos", str(ctx.exception))

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_set_variacao_active(self, _mock_ensure, mock_db):
        catalog_row = self._make_catalog_row()
        variacao_row = self._make_variacao_row()
        variacao_row_inactive = self._make_variacao_row(Ativo=0)
        mock_db.execute_query.side_effect = [
            [catalog_row],           # _require_acabamento_item
            [variacao_row],          # SELECT variacao
            None,                    # UPDATE
            [variacao_row_inactive], # SELECT after update
        ]
        result = svc.set_variacao_active(10, 1, active=False, updated_by_ponto="1")
        self.assertFalse(result["active"])

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_delete_variacao(self, _mock_ensure, mock_db):
        catalog_row = self._make_catalog_row()
        variacao_row = self._make_variacao_row()
        mock_db.execute_query.side_effect = [
            [catalog_row],   # _require_acabamento_item
            [variacao_row],  # SELECT for existence check
            None,            # DELETE
        ]
        svc.delete_variacao(10, 1)
        delete_calls = [
            c
            for c in mock_db.execute_query.call_args_list
            if c.args and "DELETE FROM tabSystemCatalogVariacao" in str(c.args[0])
        ]
        self.assertEqual(len(delete_calls), 1)

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_delete_variacao_not_found_raises(self, _mock_ensure, mock_db):
        catalog_row = self._make_catalog_row()
        mock_db.execute_query.side_effect = [
            [catalog_row],  # _require_acabamento_item
            [],             # SELECT → not found
        ]
        with self.assertRaises(KeyError):
            svc.delete_variacao(10, 999)

    @patch("services.system_catalog_service.db")
    @patch("services.system_catalog_service.ensure_system_catalog_schema")
    def test_item_not_found_raises_key_error(self, _mock_ensure, mock_db):
        mock_db.execute_query.return_value = []
        with self.assertRaises(KeyError):
            svc.list_variacoes(9999)


if __name__ == "__main__":
    unittest.main()
