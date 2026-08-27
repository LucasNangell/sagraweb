"""Lookups e persistência dos campos de Entrega da gerência."""
from __future__ import annotations

import inspect
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from mdb_helpers import prepare_os_protocol_params
from routers.auxiliar_routes import get_formas_entrega, get_responsaveis_grafica
from routers.os_routes import SaveOSRequest, require_entreg_data_for_priority, save_os
from schemas.auxiliar import FormaEntregaRow, ResponsavelGrafRow


class _FakeResponse:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


class TestAuxEntregaLookups:
    @patch("routers.auxiliar_routes.db")
    def test_formas_entrega_distinct(self, mock_db):
        mock_db.execute_query.return_value = [
            {"FormaEntrega": "Avisar Contato"},
            {"FormaEntrega": "  "},
            {"FormaEntrega": None},
            {"FormaEntrega": "Entreg. na SEDIR IV"},
        ]
        response = _FakeResponse()
        rows = get_formas_entrega(response)  # type: ignore[arg-type]
        assert response.headers.get("Cache-Control") == "private, max-age=60"
        assert rows == [
            FormaEntregaRow(FormaEntrega="Avisar Contato"),
            FormaEntregaRow(FormaEntrega="Entreg. na SEDIR IV"),
        ]
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "DISTINCT EntregaFormaLink" in sql

    @patch("routers.auxiliar_routes.db")
    def test_responsaveis_grafica_distinct(self, mock_db):
        mock_db.execute_query.return_value = [
            {"ResponsavelGraf": "Daniela"},
            {"ResponsavelGraf": None},
            {"ResponsavelGraf": "Diretoria Deapa"},
        ]
        response = _FakeResponse()
        rows = get_responsaveis_grafica(response)  # type: ignore[arg-type]
        assert rows == [
            ResponsavelGrafRow(ResponsavelGraf="Daniela"),
            ResponsavelGrafRow(ResponsavelGraf="Diretoria Deapa"),
        ]
        sql = str(mock_db.execute_query.call_args.args[0])
        assert "DISTINCT ResponsavelGrafLink" in sql


class TestEntregaPersistence:
    def test_save_request_accepts_entrega_fields(self):
        req = SaveOSRequest(
            ResponsavelGrafLink="Daniela",
            EntregaFormaLink="Avisar Contato",
            EntregPeriodo="Noite",
        )
        assert req.ResponsavelGrafLink == "Daniela"
        assert req.EntregaFormaLink == "Avisar Contato"
        assert req.EntregPeriodo == "Noite"

    def test_save_os_sql_includes_entrega_columns(self):
        src = inspect.getsource(save_os)
        assert "ResponsavelGrafLink=%s" in src
        assert "EntregaFormaLink=%s" in src
        assert "EntregPeriodo=%s" in src
        assert "data.ResponsavelGrafLink" in src
        assert "data.EntregaFormaLink" in src
        assert "data.EntregPeriodo" in src

    def test_prepare_os_protocol_params_includes_entrega(self):
        params = prepare_os_protocol_params(
            {
                "NroProtocolo": 84,
                "ResponsavelGrafLink": "Daniela",
                "EntregaFormaLink": "Avisar Contato",
                "EntregPeriodo": "Noite",
            }
        )
        assert params["ResponsavelGrafLink"] == "Daniela"
        assert params["EntregaFormaLink"] == "Avisar Contato"
        assert params["EntregPeriodo"] == "Noite"


class TestEntregaDataObrigatoria:
    def test_normal_permite_data_vazia(self):
        require_entreg_data_for_priority("Normal", None)
        require_entreg_data_for_priority("Normal", "")

    def test_prioridade_diferente_exige_data(self):
        with pytest.raises(HTTPException) as exc:
            require_entreg_data_for_priority("Solicitado p/", None)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Informe a Data Entrega."

    def test_prioridade_diferente_com_data_ok(self):
        require_entreg_data_for_priority("Prometido p/", "2026-08-28")
