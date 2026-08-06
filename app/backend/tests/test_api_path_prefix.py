"""Testes do prefixo de API alinhado ao Nginx (/sagra/api)."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest


@pytest.fixture
def fresh_config_manager():
    from config_manager import ConfigManager

    ConfigManager._instance = None
    yield ConfigManager()
    ConfigManager._instance = None


def test_dev_local_uses_direct_api(fresh_config_manager):
    cm = fresh_config_manager
    env = {
        "ENV": "development",
        "SAGRA_PUBLIC_WEB_BASE": "",
    }
    with patch.dict(os.environ, env, clear=False):
        cm.config.pop("public_web_base", None)
        cm.load_config()
        assert cm.get_api_path_prefix() == "/api"
        assert cm.get_api_base() == "http://127.0.0.1:8001/api"
        assert cm.get_api_internal_base().endswith("/api")


def test_dev_with_public_web_base_uses_nginx_path(fresh_config_manager):
    cm = fresh_config_manager
    env = {
        "ENV": "development",
        "SAGRA_PUBLIC_WEB_BASE": "https://cgrafsysvm.camara.leg.br",
    }
    with patch.dict(os.environ, env, clear=False):
        cm.load_config()
        assert cm.uses_nginx_api_path() is True
        assert cm.get_api_path_prefix() == "/sagra/api"
        assert cm.get_api_ws_path() == "/sagra/api/ws"
        assert cm.get_api_base() == "/sagra/api"


def test_production_uses_nginx_path(fresh_config_manager):
    cm = fresh_config_manager
    cm.config["env"] = "production"
    cm.config["server_port"] = 8050
    cm.config["public_web_base"] = "https://cgrafsysvm.redecamara.camara.gov.br"
    with patch.dict(os.environ, {"ENV": "production"}, clear=False):
        cm.load_config()
        cm.config["server_port"] = 8050
        assert cm.get_api_path_prefix() == "/sagra/api"
        assert cm.get_api_base() == "/sagra/api"
        assert cm.get_api_internal_base() == "http://127.0.0.1:8050/api"
