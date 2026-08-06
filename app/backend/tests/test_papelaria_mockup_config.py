"""Testes — MockupConfigJson modelos Papelaria."""
from __future__ import annotations

import json

import pytest

from services.papelaria_mockup_config_service import (
    normalize_mockup_config_json,
    parse_mockup_config_json,
    validate_mockup_config_payload,
)


def _valid_config() -> dict:
    return {
        "id": "cartao_duplo_retrato_lateral",
        "nome": "Cartão duplo",
        "modo": "cartao_dobrado",
        "larguraAbertaMm": 210,
        "alturaAbertaMm": 296,
        "faces": [
            {
                "id": "capa",
                "nome": "Capa",
                "pageIndex": 0,
                "style3d": {"rotateY": -18},
            },
            {
                "id": "interior",
                "nome": "Interior",
                "pageIndex": 1,
                "style3d": {"rotateY": 0},
            },
        ],
    }


class TestPapelariaMockupConfigService:
    def test_validate_ok(self):
        validate_mockup_config_payload(_valid_config())

    def test_validate_sem_modo(self):
        cfg = _valid_config()
        del cfg["modo"]
        with pytest.raises(ValueError, match="modo"):
            validate_mockup_config_payload(cfg)

    def test_validate_face_sem_page_index(self):
        cfg = _valid_config()
        del cfg["faces"][0]["pageIndex"]
        with pytest.raises(ValueError, match="pageIndex"):
            validate_mockup_config_payload(cfg)

    def test_normalize_vazio(self):
        assert normalize_mockup_config_json(None) is None
        assert normalize_mockup_config_json("") is None

    def test_normalize_json_string(self):
        raw = json.dumps(_valid_config())
        out = normalize_mockup_config_json(raw)
        assert out is not None
        parsed = parse_mockup_config_json(out)
        assert parsed["modo"] == "cartao_dobrado"

    def test_parse_json_invalido(self):
        with pytest.raises(ValueError, match="JSON inválido"):
            parse_mockup_config_json("{")
