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
        "marcas_pdf_path": None,
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
        assert parsed["marcas_pdf_path"] is None
        assert parsed["work_style"] == "Simplex"

    def test_marcas_corte_exige_pdf_path(self):
        from services.papelaria_imposicao_config_service import (
            normalize_imposicao_config_json,
            validate_imposicao_config_payload,
        )

        bad = _valid_payload()
        bad["marcas_corte"] = True
        # Leitura (opções da OS) permite incompleto.
        soft = validate_imposicao_config_payload(bad, require_marcas_pdf=False)
        assert soft["marcas_corte"] is True
        assert soft["marcas_pdf_path"] is None
        # Gravação / gerar JDF exige o caminho.
        with pytest.raises(ValueError, match="caminho do PDF de marcas"):
            validate_imposicao_config_payload(bad, require_marcas_pdf=True)
        with pytest.raises(ValueError, match="caminho do PDF de marcas"):
            normalize_imposicao_config_json(bad)

        ok = _valid_payload()
        ok["marcas_corte"] = True
        ok["marcas_pdf_path"] = (
            r"\\redecamara\dfsdata\CGraf\Modelos\ImposicaoSIELT_5x2_A4.pdf"
        )
        out = validate_imposicao_config_payload(ok, require_marcas_pdf=True)
        assert out["marcas_pdf_path"].endswith("ImposicaoSIELT_5x2_A4.pdf")

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


class TestProdutoImposicaoResolve:
    def test_parse_modelo_legado_aplica_nas_duas_variantes(self):
        from services.papelaria_produto_imposicao_service import (
            parse_modelo_variants_override,
        )

        out = parse_modelo_variants_override(_valid_payload())
        assert out["digital"]["grid"] == {"colunas": 2, "linhas": 1}
        assert out["offset"] == out["digital"]

    def test_parse_modelo_envelope_parcial(self):
        from services.papelaria_produto_imposicao_service import (
            parse_modelo_variants_override,
        )

        out = parse_modelo_variants_override(
            {"digital": _valid_payload(), "offset": None}
        )
        assert out["digital"] is not None
        assert out["offset"] is None

    def test_resolve_override_modelo_vence_produto(self, monkeypatch):
        from services import papelaria_produto_imposicao_service as svc

        produto_cfg = _valid_payload()
        produto_cfg["grid"] = {"colunas": 1, "linhas": 1}
        modelo_cfg = _valid_payload()
        modelo_cfg["grid"] = {"colunas": 3, "linhas": 2}

        monkeypatch.setattr(
            svc,
            "get_produto_imposicao_map",
            lambda _p: {"digital": produto_cfg, "offset": None},
        )
        out = svc.resolve_imposicao_opcoes(
            produto="Cartao",
            modelo_imposicao_config_json={"digital": modelo_cfg},
        )
        assert out["digital"]["grid"] == {"colunas": 3, "linhas": 2}
        assert out["fontes"]["digital"] == "modelo"
        assert out["variantes_disponiveis"] == ["digital"]

    def test_resolve_herda_marcas_pdf_do_produto(self, monkeypatch):
        from services import papelaria_produto_imposicao_service as svc

        produto_cfg = _valid_payload()
        produto_cfg["marcas_corte"] = True
        produto_cfg["marcas_pdf_path"] = (
            r"\\redecamara\dfsdata\CGraf\ImposicaoSIELT_5x2_A4.pdf"
        )
        # Legado no modelo: marcas sem path (sombra incompleta).
        modelo_cfg = _valid_payload()
        modelo_cfg["marcas_corte"] = True
        modelo_cfg.pop("marcas_pdf_path", None)

        monkeypatch.setattr(
            svc,
            "get_produto_imposicao_map",
            lambda _p: {"digital": produto_cfg, "offset": None},
        )
        out = svc.resolve_imposicao_opcoes(
            produto="Ct Visita",
            modelo_imposicao_config_json=modelo_cfg,
        )
        assert out["fontes"]["digital"] == "modelo"
        assert out["digital"]["marcas_corte"] is True
        assert out["digital"]["marcas_pdf_path"].endswith(
            "ImposicaoSIELT_5x2_A4.pdf"
        )

    def test_resolve_sem_produto_usa_so_modelo(self):
        from services.papelaria_produto_imposicao_service import (
            resolve_imposicao_opcoes,
        )

        out = resolve_imposicao_opcoes(
            produto="",
            modelo_imposicao_config_json={"offset": _valid_payload()},
        )
        assert out["variantes_disponiveis"] == ["offset"]
        assert out["fontes"]["offset"] == "modelo"
