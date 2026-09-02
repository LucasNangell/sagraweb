"""Testes de grupos e configurações adicionais de máquinas."""
from __future__ import annotations

import unittest
from decimal import Decimal
from unittest.mock import patch

from services import machine_catalog_service as svc


class TestMachineCatalogService(unittest.TestCase):
    @patch("services.machine_catalog_service.catalog_svc.list_admin_items")
    @patch("services.machine_catalog_service.db")
    @patch("services.machine_catalog_service.ensure_machine_catalog_schema")
    def test_list_machine_admin_view_merges_catalog_and_config(
        self,
        _mock_ensure,
        mock_db,
        mock_catalog_items,
    ):
        mock_catalog_items.return_value = [
            {
                "id": 10,
                "label": "Komori",
                "active": True,
                "ordem": 50,
                "source": "catalog",
                "in_use": False,
            }
        ]
        mock_db.execute_query.side_effect = [
            [
                {
                    "ID": 1,
                    "Nome": "Impressoras",
                    "Tipo": "impressora",
                    "Ativo": 1,
                    "Ordem": 50,
                    "CriadoEm": None,
                    "AtualizadoEm": None,
                    "AtualizadoPorPonto": None,
                }
            ],
            [
                {
                    "MaquinaRotulo": "Komori",
                    "GrupoID": 1,
                    "Tecnologia": "offset",
                    "PapelMaxAlturaMm": Decimal("720.00"),
                    "PapelMaxLarguraMm": Decimal("1020.00"),
                    "PapelPadraoAlturaMm": None,
                    "PapelPadraoLarguraMm": None,
                    "MargemSuperiorMm": Decimal("10.00"),
                    "MargemDireitaMm": Decimal("12.00"),
                    "MargemInferiorMm": Decimal("10.00"),
                    "MargemEsquerdaMm": Decimal("12.00"),
                }
            ],
        ]

        result = svc.list_machine_admin_view()

        self.assertEqual(result["groups"][0]["nome"], "Impressoras")
        machine = result["machines"][0]
        self.assertEqual(machine["label"], "Komori")
        self.assertEqual(machine["config"]["grupo_id"], 1)
        self.assertEqual(machine["config"]["tecnologia"], "offset")
        self.assertEqual(machine["config"]["papel_max_largura_mm"], 1020.0)

    @patch("services.machine_catalog_service.db")
    @patch("services.machine_catalog_service.ensure_machine_catalog_schema")
    def test_create_group_rejects_duplicate(self, _mock_ensure, mock_db):
        mock_db.execute_query.return_value = [{"ID": 1}]

        with self.assertRaises(ValueError) as ctx:
            svc.create_group(nome="Impressoras", tipo="impressora")

        self.assertIn("já cadastrado", str(ctx.exception))

    @patch("services.machine_catalog_service._known_machine_label", return_value="Komori")
    @patch("services.machine_catalog_service.db")
    @patch("services.machine_catalog_service.ensure_machine_catalog_schema")
    def test_update_machine_config_persists_optional_printer_fields(
        self,
        _mock_ensure,
        mock_db,
        _mock_known,
    ):
        mock_db.execute_query.side_effect = [
            [{"ID": 1}],
            None,
            [
                {
                    "MaquinaRotulo": "Komori",
                    "GrupoID": 1,
                    "Tecnologia": "digital",
                    "PapelMaxAlturaMm": Decimal("330.00"),
                    "PapelMaxLarguraMm": Decimal("480.00"),
                    "PapelPadraoAlturaMm": None,
                    "PapelPadraoLarguraMm": None,
                    "MargemSuperiorMm": Decimal("3.00"),
                    "MargemDireitaMm": Decimal("3.00"),
                    "MargemInferiorMm": Decimal("3.00"),
                    "MargemEsquerdaMm": Decimal("3.00"),
                }
            ],
        ]

        result = svc.update_machine_config(
            "Komori",
            grupo_id=1,
            tecnologia="digital",
            papel_max_altura_mm=330,
            papel_max_largura_mm=480,
            margem_superior_mm=3,
            margem_direita_mm=3,
            margem_inferior_mm=3,
            margem_esquerda_mm=3,
            updated_by_ponto="918713",
        )

        self.assertEqual(result["maquina_rotulo"], "Komori")
        self.assertEqual(result["tecnologia"], "digital")
        self.assertEqual(result["papel_max_altura_mm"], 330.0)

    @patch("services.machine_catalog_service._known_machine_label", return_value="Komori")
    @patch("services.machine_catalog_service.db")
    @patch("services.machine_catalog_service.ensure_machine_catalog_schema")
    def test_update_machine_config_requires_dimension_pairs(
        self,
        _mock_ensure,
        mock_db,
        _mock_known,
    ):
        mock_db.execute_query.return_value = []

        with self.assertRaises(ValueError) as ctx:
            svc.update_machine_config("Komori", papel_max_altura_mm=330)

        self.assertIn("altura e largura", str(ctx.exception))

    @patch("services.machine_catalog_service._known_machine_label", return_value="Komori")
    @patch("services.machine_catalog_service.db")
    @patch("services.machine_catalog_service.ensure_machine_catalog_schema")
    def test_update_machine_config_rejects_invalid_technology(
        self,
        _mock_ensure,
        mock_db,
        _mock_known,
    ):
        mock_db.execute_query.return_value = []

        with self.assertRaises(ValueError) as ctx:
            svc.update_machine_config("Komori", tecnologia="laser")

        self.assertIn("Tecnologia", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
