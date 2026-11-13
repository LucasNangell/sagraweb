"""Testes — ImposicaoConfigJson (schema JDF)."""
from __future__ import annotations

import json

import pytest


def _valid_payload() -> dict:
    return {
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
        "grid": {"colunas": 2, "linhas": 1},
        "espacamento_mm": {"horizontal": 0, "vertical": 0},
        "sangria_mm": 0,
        "marcas_corte": False,
        "centralizar_na_folha": True,
        "work_style": "Simplex",
    }


class TestImposicaoConfigService:
    def test_normalize_vazio_vira_none(self):
        from services.papelaria_imposicao_config_service import (
            normalize_imposicao_config_json,
        )

        assert normalize_imposicao_config_json(None) is None
        assert normalize_imposicao_config_json("") is None

    def test_normalize_exemplo_jdf_a5_2x1(self):
        from services.papelaria_imposicao_config_service import (
            normalize_imposicao_config_json,
        )

        out = normalize_imposicao_config_json(_valid_payload())
        assert out is not None
        parsed = json.loads(out)
        assert parsed["folha_mm"]["largura"] == 297
        assert parsed["pagina"]["largura_mm"] == 148
        assert parsed["grid"] == {"colunas": 2, "linhas": 1}
        assert parsed["marcas_corte"] is False
        assert parsed["work_style"] == "Simplex"

    def test_pagina_borda_sem_tamanho_fixo(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        payload = _valid_payload()
        payload["pagina"] = {"origem": "borda"}
        out = validate_imposicao_config_payload(payload)
        assert out["pagina"] == {"origem": "borda"}

    def test_pagina_fixixa_exige_mm(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        bad = _valid_payload()
        bad["pagina"] = {"origem": "fixixa"}
        with pytest.raises(ValueError, match="pagina.largura_mm"):
            validate_imposicao_config_payload(bad)

    def test_aceita_legado_folha_largura_mm(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        legado = {
            "folha": {"largura_mm": 297, "altura_mm": 210},
            "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
            "grid": {"colunas": 2, "linhas": 1, "repeticoes": 2},
            "espacamento_mm": {"horizontal": 0, "vertical": 0},
            "marcas_corte": False,
        }
        out = validate_imposicao_config_payload(legado)
        assert out["folha_mm"]["largura"] == 297
        assert out["centralizar_na_folha"] is True
