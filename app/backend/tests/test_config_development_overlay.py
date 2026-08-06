"""Overlay config.development.json — só em ENV=development; não grava em config.json."""
from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture
def fresh_config_manager(tmp_path, monkeypatch):
    import config_manager as cm_mod

    cm_mod.ConfigManager._instance = None

    base = {
        "env": "production",
        "db_host": "10.1.1.73",
        "db_port": 3306,
        "db_user": "usr_sagraweb",
        "db_password": "",
        "db_name": "sagrafulldb",
        "server_host": "10.1.1.73",
        "server_port": 8001,
        "mdb_os_atual_path": r"\\prod\OS Atual.mdb",
        "mdb_papelaria_path": r"\\prod\Papelaria Atual.mdb",
        "mdb_os_antiga_path": r"\\prod\OS Antiga.mdb",
        "mdb_papelaria_antiga_path": r"\\prod\Papelaria Antiga.mdb",
        "allowed_ips": {"master": "10.0.0.1", "local_network": "10.1.1.73"},
    }
    overlay = {
        "db_host": "127.0.0.1",
        "db_user": "root",
        "db_name": "sagrafulldb",
        "mdb_os_atual_path": r"c:\_sagra\Sagra Base - OS Atual.mdb",
        "mdb_papelaria_path": r"c:\_sagra\Sagra Base - Papelaria Atual.mdb",
    }

    cfg_file = tmp_path / "config.json"
    dev_file = tmp_path / "config.development.json"
    cfg_file.write_text(json.dumps(base), encoding="utf-8")
    dev_file.write_text(json.dumps(overlay), encoding="utf-8")

    monkeypatch.setattr(cm_mod, "CONFIG_FILE", cfg_file)
    monkeypatch.setattr(cm_mod, "CONFIG_DEVELOPMENT_FILE", dev_file)

    yield cm_mod
    cm_mod.ConfigManager._instance = None


def test_development_overlay_switches_mysql_and_mdb(fresh_config_manager):
    cm_mod = fresh_config_manager
    env = {
        "ENV": "development",
        "DB_HOST": "10.1.1.73",
        "DB_USER": "usr_sagraweb",
        "DB_PASSWORD": "",
        "SAGRA_PUBLIC_WEB_BASE": "",
    }
    with patch.dict(os.environ, env, clear=False):
        cm = cm_mod.ConfigManager()
        assert cm.is_development() is True
        assert cm.get("db_host") == "127.0.0.1"
        assert cm.get("db_user") == "root"
        assert cm.get("mdb_os_atual_path") == r"c:\_sagra\Sagra Base - OS Atual.mdb"
        assert cm.get("mdb_papelaria_path") == r"c:\_sagra\Sagra Base - Papelaria Atual.mdb"
        assert cm.get("db_password") == ""
        # .env apontando produção não vence o overlay DEV
        assert cm.get("db_host") != "10.1.1.73"


def test_development_loopback_uses_env_password(fresh_config_manager):
    """Com host local, DB_PASSWORD do ambiente (inclui vazio) prevalece após overlay."""
    cm_mod = fresh_config_manager
    env = {
        "ENV": "development",
        "DB_PASSWORD": "",
        "SAGRA_PUBLIC_WEB_BASE": "",
    }
    with patch.dict(os.environ, env, clear=False):
        os.environ["DB_PASSWORD"] = ""
        cm = cm_mod.ConfigManager()
        assert cm.get("db_host") == "127.0.0.1"
        assert cm.get("db_password") == ""


def test_production_ignores_development_overlay(fresh_config_manager):
    cm_mod = fresh_config_manager
    env = {
        "ENV": "production",
        "DB_HOST": "10.1.1.73",
        "DB_USER": "usr_sagraweb",
        "DB_PASSWORD": "prod_only",
        "DB_NAME": "sagrafulldb",
        "SAGRA_PUBLIC_WEB_BASE": "https://cgrafsysvm.camara.leg.br",
    }
    with patch.dict(os.environ, env, clear=False):
        cm = cm_mod.ConfigManager()
        assert cm.is_development() is False
        assert cm.get("db_host") == "10.1.1.73"
        assert cm.get("db_user") == "usr_sagraweb"
        assert cm.get("mdb_os_atual_path") == r"\\prod\OS Atual.mdb"
        assert "c:\\_sagra" not in str(cm.get("mdb_os_atual_path") or "").lower()


def test_save_config_does_not_persist_dev_overlay(fresh_config_manager):
    cm_mod = fresh_config_manager
    env = {"ENV": "development", "DB_PASSWORD": "", "SAGRA_PUBLIC_WEB_BASE": ""}
    with patch.dict(os.environ, env, clear=False):
        cm = cm_mod.ConfigManager()
        assert cm.get("db_host") == "127.0.0.1"
        cm.set("credenciais_depol", {"auto_criar_os": True, "os_template_nro": 1, "os_template_ano": 2026})
        cm.save_config()

        on_disk = json.loads(Path(cm_mod.CONFIG_FILE).read_text(encoding="utf-8"))
        assert on_disk["db_host"] == "10.1.1.73"
        assert on_disk["mdb_os_atual_path"] == r"\\prod\OS Atual.mdb"
        assert on_disk["credenciais_depol"]["auto_criar_os"] is True
