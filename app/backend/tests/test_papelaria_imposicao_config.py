"""Testes — ImposicaoConfigJson normalize/validate."""
from __future__ import annotations

import json

import pytest


def _valid_payload() -> dict:
    return {
        "folha": {"largura_mm": 320, "altura_mm": 450},
        "pagina": {"origem": "borda", "rotacao_graus": 0},
        "grid": {"colunas": 2, "linhas": 5, "repeticoes": 10},
        "espacamento_mm": {"horizontal": 2, "vertical": 2},
        "margens_mm": {
            "esquerda": 5,
            "direita": 5,
            "superior": 5,
            "inferior": 5,
        },
        "marcas_corte": True,
        "separacao_paginas": True,
        "incluir_verso": True,
    }


class TestImposicaoConfigService:
    def test_normalize_vazio_vira_none(self):
        from services.papelaria_imposicao_config_service import (
            normalize_imposicao_config_json,
        )

        assert normalize_imposicao_config_json(None) is None
        assert normalize_imposicao_config_json("") is None
        assert normalize_imposicao_config_json("   ") is None

    def test_normalize_payload_valido(self):
        from services.papelaria_imposicao_config_service import (
            normalize_imposicao_config_json,
        )

        out = normalize_imposicao_config_json(_valid_payload())
        assert out is not None
        parsed = json.loads(out)
        assert parsed["folha"]["largura_mm"] == 320
        assert parsed["grid"]["colunas"] == 2
        assert parsed["marcas_corte"] is True

    def test_rejeita_folha_invalida(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        bad = _valid_payload()
        bad["folha"]["largura_mm"] = 0
        with pytest.raises(ValueError, match="largura_mm"):
            validate_imposicao_config_payload(bad)

    def test_rejeita_grid_zero(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        bad = _valid_payload()
        bad["grid"]["repeticoes"] = 0
        with pytest.raises(ValueError, match="repeticoes"):
            validate_imposicao_config_payload(bad)

    def test_aceita_espacamento_zero(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        payload = _valid_payload()
        payload["espacamento_mm"]["horizontal"] = 0
        out = validate_imposicao_config_payload(payload)
        assert out["espacamento_mm"]["horizontal"] == 0
