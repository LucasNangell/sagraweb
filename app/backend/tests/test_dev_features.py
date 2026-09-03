"""Testes do catálogo de flags de desenvolvimento."""
from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture()
def dev_features_mod(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from services import dev_features as mod

    settings_path = tmp_path / "dev_features.json"
    monkeypatch.setattr(mod, "_SETTINGS_PATH", settings_path)
    return mod, settings_path


def test_defaults_disabled(dev_features_mod) -> None:
    mod, _ = dev_features_mod
    payload = mod.get_features_payload()
    assert payload["enabled"]["sequencia_producao"] is False
    assert payload["enabled"]["fluxo_producao"] is False
    assert payload["features"][0]["id"] == "sequencia_producao"
    assert payload["features"][0]["enabled"] is False
    assert any(f["id"] == "fluxo_producao" for f in payload["features"])
    assert mod.is_feature_enabled("sequencia_producao") is False
    assert mod.is_feature_enabled("fluxo_producao") is False


def test_persist_and_reload(dev_features_mod) -> None:
    mod, settings_path = dev_features_mod
    updated = mod.set_features_enabled(
        {"sequencia_producao": True, "fluxo_producao": True}
    )
    assert updated["enabled"]["sequencia_producao"] is True
    assert updated["enabled"]["fluxo_producao"] is True
    assert settings_path.is_file()
    raw = json.loads(settings_path.read_text(encoding="utf-8"))
    assert raw["sequencia_producao"] is True
    assert raw["fluxo_producao"] is True
    assert mod.get_features_payload()["enabled"]["sequencia_producao"] is True
    assert mod.get_features_payload()["enabled"]["fluxo_producao"] is True


def test_ignores_unknown_keys(dev_features_mod) -> None:
    mod, settings_path = dev_features_mod
    settings_path.write_text(
        json.dumps({"sequencia_producao": True, "feature_fantasma": True}),
        encoding="utf-8",
    )
    payload = mod.get_features_payload()
    assert payload["enabled"]["sequencia_producao"] is True
    assert "feature_fantasma" not in payload["enabled"]

    mod.set_features_enabled({"feature_fantasma": False, "sequencia_producao": False})
    raw = json.loads(settings_path.read_text(encoding="utf-8"))
    assert raw["sequencia_producao"] is False
    # chave desconhecida no arquivo de entrada permanece até ser sobrescrita só
    # pelas chaves conhecidas; set_features_enabled não remove extras do raw
    assert raw.get("feature_fantasma") is True
