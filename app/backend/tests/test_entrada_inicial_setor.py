"""Resolução do setor da Entrada Inicial ao criar OS."""
from __future__ import annotations

import inspect
from unittest.mock import patch

from routers.os_routes import (
    SaveOSRequest,
    resolve_entrada_inicial_setor,
    save_os,
)


class TestResolveEntradaInicialSetor:
    def test_payload_wins(self):
        assert resolve_entrada_inicial_setor("SEORG", "1234") == "SEORG"

    def test_strips_payload(self):
        assert resolve_entrada_inicial_setor("  SECOG  ", None) == "SECOG"

    def test_blank_payload_uses_user_setor(self):
        with patch(
            "routers.setor_painel_routes.fetch_user_setor",
            return_value="SEDIR",
        ) as mock_fetch:
            assert resolve_entrada_inicial_setor("  ", "1234") == "SEDIR"
            mock_fetch.assert_called_once_with("1234")

    def test_missing_user_setor_falls_back_to_sefoc(self):
        with patch(
            "routers.setor_painel_routes.fetch_user_setor",
            return_value=None,
        ):
            assert resolve_entrada_inicial_setor(None, "1234") == "SEFOC"

    def test_no_ponto_falls_back_to_sefoc(self):
        assert resolve_entrada_inicial_setor(None, None) == "SEFOC"
        assert resolve_entrada_inicial_setor("", "") == "SEFOC"


class TestSaveOsEntradaInicialSetor:
    def test_save_request_accepts_setor_andamento(self):
        req = SaveOSRequest(SetorAndamento="SEORG")
        assert req.SetorAndamento == "SEORG"

    def test_save_os_uses_resolved_setor_not_hardcoded_sefoc(self):
        src = inspect.getsource(save_os)
        assert "resolve_entrada_inicial_setor" in src
        assert "'Entrada Inicial', %s" in src
        assert "'Entrada Inicial', 'SEFOC'" not in src
        assert "setor=setor_entrada" in src
