"""Painel — rotas com prefixo /sagra/api (Uvicorn unificado)."""
from __future__ import annotations

from security.painel_access import is_painel_data_api_route


def test_painel_data_route_accepts_sagra_api_prefix():
    assert is_painel_data_api_route("/sagra/api/pcp/queue", "GET") is True
    assert is_painel_data_api_route("/sagra/api/os/search", "GET") is True
    assert is_painel_data_api_route("/sagra/api/aux/setores", "GET") is True


def test_painel_data_route_keeps_api_prefix():
    assert is_painel_data_api_route("/api/pcp/queue", "GET") is True
