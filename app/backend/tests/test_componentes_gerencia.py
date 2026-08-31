"""Testes de persistência e carregamento de componentes da Gerência (MySQL-only)."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from routers.os_routes import TechSpecComponentePayload, TechSpecLotePayload, TechSpecPayload
from services.os_componentes_service import (
    _lote_to_dict,
    load_componentes_for_os,
    sync_componentes_from_techspec,
)


class TestLoteSerialization:
    def test_lote_to_dict_preserves_all_fields(self):
        lote = TechSpecLotePayload(
            id="lote_1",
            paginas=12,
            maquina_link="Offset",
            papel_link="Couché 150g",
            cores_link="4x4",
            papel_desc="nota papel",
            cores_desc="nota cores",
            impressao="4/0",
        )
        data = _lote_to_dict(lote)
        assert data["paginas"] == 12
        assert data["maquina_link"] == "Offset"
        assert data["papel_link"] == "Couché 150g"
        assert data["cores_link"] == "4x4"
        assert data["papel_desc"] == "nota papel"
        assert data["cores_desc"] == "nota cores"
        assert data["impressao"] == "4/0"
        assert data["frente_verso"] is False
        assert data["acabamentos"] == []


class TestSyncComponentesFromTechspec:
    def _cursor_with_existing(self, existing=None):
        cursor = MagicMock()
        cursor.fetchall.return_value = existing or []
        cursor.fetchone.return_value = None
        cursor.lastrowid = 99
        return cursor

    def test_saves_full_techspec_json(self):
        cursor = self._cursor_with_existing()
        techspec = TechSpecPayload(
            componentes=[
                TechSpecComponentePayload(
                    nome="Encarte Especial",
                    lotes=[
                        TechSpecLotePayload(
                            id="l1",
                            paginas=8,
                            maquina_link="Digital",
                            papel_link="Sulfite",
                            cores_link="P/B",
                            papel_desc="",
                            cores_desc="",
                        )
                    ],
                )
            ]
        )
        sync_componentes_from_techspec(cursor, nro=886, ano=2026, techspec=techspec, ponto="123")

        insert_calls = [
            c for c in cursor.execute.call_args_list if "INSERT INTO tab_os_componentes" in str(c[0][0])
        ]
        assert insert_calls
        techspec_json = insert_calls[0][0][1][6]
        parsed = json.loads(techspec_json)
        lote = parsed["lotes"][0]
        assert lote["paginas"] == 8
        assert lote["maquina_link"] == "Digital"
        assert lote["papel_link"] == "Sulfite"
        assert lote["cores_link"] == "P/B"

    def test_saves_lote_impressao(self):
        cursor = self._cursor_with_existing()
        techspec = TechSpecPayload(
            componentes=[
                TechSpecComponentePayload(
                    nome="Capa",
                    tipo="CAPA",
                    lotes=[
                        TechSpecLotePayload(
                            id="l1",
                            paginas=4,
                            cores_link="4x4",
                            impressao="4/0",
                        )
                    ],
                )
            ]
        )
        sync_componentes_from_techspec(cursor, nro=886, ano=2026, techspec=techspec, ponto="123")

        insert_calls = [
            c for c in cursor.execute.call_args_list if "INSERT INTO tab_os_componentes" in str(c[0][0])
        ]
        parsed = json.loads(insert_calls[0][0][1][6])
        assert parsed["lotes"][0]["impressao"] == "4/0"
        assert "verso_em_branco" not in parsed


    def test_empty_componentes_list_cleans_up_without_sub_os(self):
        cursor = self._cursor_with_existing(
            [{"id": 5, "nome": "Capa", "tipo": "CAPA", "ativo": 1, "techspec_json": "{}"}]
        )

        def fetchone_side_effect():
            return None

        cursor.fetchone.side_effect = fetchone_side_effect

        sync_componentes_from_techspec(
            cursor, nro=886, ano=2026, techspec=TechSpecPayload(componentes=[]), ponto="123"
        )

        delete_calls = [
            c for c in cursor.execute.call_args_list if "DELETE FROM tab_os_componentes" in str(c[0][0])
        ]
        assert delete_calls

    def test_empty_list_does_not_create_components(self):
        cursor = self._cursor_with_existing()
        sync_componentes_from_techspec(
            cursor, nro=886, ano=2026, techspec=TechSpecPayload(componentes=[]), ponto="123"
        )
        insert_calls = [
            c for c in cursor.execute.call_args_list if "INSERT INTO tab_os_componentes" in str(c[0][0])
        ]
        assert not insert_calls

    def test_update_keeps_componente_id(self):
        cursor = self._cursor_with_existing(
            [{"id": 7, "nome": "Capa", "tipo": "CAPA", "ativo": 1, "techspec_json": "{}"}]
        )
        techspec = TechSpecPayload(
            componentes=[
                TechSpecComponentePayload(
                    componente_id=7,
                    nome="Capa Revista",
                    tipo="CAPA",
                    lotes=[TechSpecLotePayload(paginas=4, papel_link="Couché")],
                )
            ]
        )
        sync_componentes_from_techspec(cursor, nro=886, ano=2026, techspec=techspec, ponto="123")

        update_calls = [
            c for c in cursor.execute.call_args_list if "UPDATE tab_os_componentes" in str(c[0][0])
        ]
        assert update_calls
        assert update_calls[0][0][1][0] == "Capa Revista"

    def test_remove_with_sub_os_inactivates(self):
        cursor = self._cursor_with_existing(
            [{"id": 8, "nome": "Miolo", "tipo": "MIOLO", "ativo": 1, "techspec_json": "{}"}]
        )
        cursor.fetchone.return_value = {"1": 1}

        sync_componentes_from_techspec(
            cursor, nro=886, ano=2026, techspec=TechSpecPayload(componentes=[]), ponto="123"
        )

        inactivate_calls = [
            c
            for c in cursor.execute.call_args_list
            if "UPDATE tab_os_componentes SET ativo = 0" in str(c[0][0])
        ]
        assert inactivate_calls


class TestLoadComponentesForOs:
    def test_returns_empty_for_os_without_componentes(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = []
            rows = load_componentes_for_os(100, 2020)
        assert rows == []

    def test_parses_techspec_json_lotes(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = [
                {
                    "id": 1,
                    "nome": "Capa",
                    "nome_normalizado": "capa",
                    "tipo": "CAPA",
                    "ordem": 0,
                    "ativo": 1,
                    "techspec_json": json.dumps(
                        {
                            "lotes": [
                                {
                                    "id": "l1",
                                    "paginas": 4,
                                    "maquina_link": "Offset",
                                    "papel_link": "Couché",
                                    "cores_link": "4x4",
                                    "papel_desc": "",
                                    "cores_desc": "",
                                }
                            ]
                        }
                    ),
                }
            ]
            rows = load_componentes_for_os(886, 2026)
        assert len(rows) == 1
        assert rows[0]["lotes"][0]["paginas"] == 4
        assert rows[0]["lotes"][0]["papel_link"] == "Couché"

    def test_parses_verso_em_branco(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = [
                {
                    "id": 1,
                    "nome": "Capa",
                    "nome_normalizado": "capa",
                    "tipo": "CAPA",
                    "ordem": 0,
                    "ativo": 1,
                    "techspec_json": json.dumps(
                        {
                            "lotes": [{"id": "l1", "paginas": 4, "cores_link": "4x4"}],
                            "verso_em_branco": True,
                        }
                    ),
                }
            ]
            rows = load_componentes_for_os(886, 2026)
        assert rows[0]["verso_em_branco"] is True

    def test_ativos_only_false_includes_inactive(self):
        with patch("services.os_componentes_service.db") as mock_db:
            mock_db.execute_query.return_value = []
            load_componentes_for_os(886, 2026, ativos_only=False)
            sql = mock_db.execute_query.call_args[0][0]
            assert "ativo = 1" not in sql


class TestComponentesEndpointIncludeInactive:
    def test_passes_ativos_only_false(self):
        from routers.os_sub_os_routes import get_os_componentes

        with patch("routers.os_sub_os_routes.load_componentes_for_os") as mock_load:
            mock_load.return_value = []
            get_os_componentes(2026, 886, include_inactive=True)
            mock_load.assert_called_once_with(886, 2026, ativos_only=False)


class TestMdbWriterIsolation:
    def test_sync_os_does_not_query_componentes_table(self):
        with patch("routers.mdb_writer.config_manager") as mock_cfg:
            mock_cfg.is_mdb_write_enabled.return_value = True
            with patch("routers.mdb_writer.db") as mock_db:
                mock_db.execute_query.side_effect = [
                    [{"NroProtocolo": 886}],
                    [{"Pags": 10, "Titulo": "Teste"}],
                ]
                with patch("routers.mdb_writer._execute_mdb_transaction") as mock_tx:
                    from routers.mdb_writer import sync_os_from_mysql_to_mdb

                    sync_os_from_mysql_to_mdb(886, 2026)
                    for call in mock_db.execute_query.call_args_list:
                        sql = str(call[0][0]).lower()
                        assert "tab_os_componentes" not in sql
                        assert "techspec_json" not in sql
                    mock_tx.assert_called_once()
