"""Testes de carregamento de config do worker."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from config import (  # noqa: E402
    default_worker_id_from_hostname,
    load_config,
    normalize_api_base_url,
    resolve_worker_id,
)


def test_normalize_api_base_url_collapses_slashes():
    assert normalize_api_base_url("http://127.0.0.1//api") == "http://127.0.0.1/api"
    assert (
        normalize_api_base_url("https://cgrafsysvm/sagra/api/")
        == "https://cgrafsysvm.redecamara.camara.gov.br/sagra/api"
    )


def test_load_config_flat_api():
    cfg = load_config(_ROOT / "config.example.yaml")
    assert (
        cfg.api_base_url
        == "https://cgrafsysvm.redecamara.camara.gov.br/sagra/api"
    )
    assert cfg.ssl_verify is False


def test_load_config_load_balance_defaults():
    cfg = load_config(_ROOT / "config.example.yaml")
    assert cfg.load_balance_enabled is True
    assert cfg.max_cpu_percent == 75.0
    assert cfg.max_memory_percent == 80.0
    assert cfg.prevent_sleep is True


def test_resolve_worker_id_auto_from_hostname(monkeypatch):
    monkeypatch.delenv("SAGRA_PAPELARIA_WORKER_ID", raising=False)
    monkeypatch.setattr("config.socket.gethostname", lambda: "WS-COREL-07")
    assert resolve_worker_id("auto") == "corel-WS-COREL-07"
    assert resolve_worker_id("") == "corel-WS-COREL-07"


def test_resolve_worker_id_explicit():
    assert resolve_worker_id("corel-ws-manual") == "corel-ws-manual"


def test_resolve_worker_id_env_override(monkeypatch):
    monkeypatch.setenv("SAGRA_PAPELARIA_WORKER_ID", "corel-override")
    assert resolve_worker_id("auto") == "corel-override"


def test_default_worker_id_sanitizes_hostname(monkeypatch):
    monkeypatch.setattr("config.socket.gethostname", lambda: "MAQUINA/TESTE")
    assert default_worker_id_from_hostname() == "corel-MAQUINA-TESTE"


def test_load_config_auto_worker_id(monkeypatch, tmp_path):
    monkeypatch.delenv("SAGRA_PAPELARIA_WORKER_ID", raising=False)
    monkeypatch.setattr("config.socket.gethostname", lambda: "ws-01")
    path = tmp_path / "config.yaml"
    path.write_text(
        "api_base_url: https://cgrafsysvm/sagra/api\n"
        "worker_secret: x\n"
        "worker_id: auto\n"
        "models_dir: C:\\\\temp\n",
        encoding="utf-8",
    )
    cfg = load_config(path)
    assert cfg.worker_id == "corel-ws-01"


def test_load_config_legacy_profiles_still_work(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "active_profile: prod\n"
        "profiles:\n"
        "  prod:\n"
        "    api_base_url: https://cgrafsysvm/sagra/api\n"
        "    ssl_verify: false\n"
        "worker_secret: x\n"
        "models_dir: C:\\\\temp\n",
        encoding="utf-8",
    )
    cfg = load_config(path, profile="prod")
    assert (
        cfg.api_base_url
        == "https://cgrafsysvm.redecamara.camara.gov.br/sagra/api"
    )
