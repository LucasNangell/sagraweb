"""Testes — juntada Timbrado/Pasta e slots de tiragem."""
from __future__ import annotations

import pytest


class TestImposicaoJuntada:
    def test_familia_produto(self):
        from services.papelaria_imposicao_juntada_service import (
            is_pasta_avulso_familia,
            is_pre_impresso_produto,
            is_timbrado_a4_offset,
            mesma_familia_produto,
            max_slots,
        )

        assert is_pasta_avulso_familia("Pasta Avulso c/ Bolso")
        assert is_pasta_avulso_familia("pasta avulso s/ bolso")
        assert is_timbrado_a4_offset("Timbrado A4")
        assert not is_timbrado_a4_offset("Timbrado A4 (Digital)")
        assert is_pre_impresso_produto("Timbrado A4")
        assert mesma_familia_produto(
            "Pasta Avulso c/ Bolso", "Pasta Avulso s/ Bolso"
        )
        assert not mesma_familia_produto("Timbrado A4", "Pasta Avulso c/ Bolso")
        assert max_slots("Timbrado A4") == 4
        assert max_slots("Pasta Avulso c/ Bolso") == 2

    def test_timbrado_slots_500_500_1000(self):
        from services.papelaria_imposicao_juntada_service import alocar_slots

        out = alocar_slots([500, 500, 1000], produto="Timbrado A4")
        assert out["slots"] == [1, 1, 2]
        assert out["unit"] == 500
        assert out["folhas"] == 500
        assert out["total_slots"] == 4
        assert out["pdfs_enviados"] == 4

    def test_timbrado_uma_os_duplica_ate_4(self):
        from services.papelaria_imposicao_juntada_service import alocar_slots

        out = alocar_slots([1000], produto="Timbrado A4")
        assert out["slots"] == [4]
        assert out["total_slots"] == 4

    def test_timbrado_duas_os_duplica_ate_4(self):
        from services.papelaria_imposicao_juntada_service import alocar_slots

        out = alocar_slots([500, 500], produto="Timbrado A4")
        assert out["slots"] == [2, 2]
        assert out["total_slots"] == 4

    def test_timbrado_excede_slots(self):
        from services.papelaria_imposicao_juntada_service import alocar_slots

        with pytest.raises(ValueError, match="Máximo de 4"):
            alocar_slots([500, 500, 500, 500, 500], produto="Timbrado A4")
        with pytest.raises(ValueError, match=r"somam 8|máx\. 4"):
            alocar_slots([500, 1500, 2000], produto="Timbrado A4")

    def test_pasta_tiragens_iguais(self):
        from services.papelaria_imposicao_juntada_service import alocar_slots

        out = alocar_slots([200, 200], produto="Pasta Avulso c/ Bolso")
        assert out["slots"] == [1, 1]
        assert out["folhas"] == 200
        assert out["pdfs_enviados"] == 2

    def test_pasta_uma_os_duplica_ate_2(self):
        from services.papelaria_imposicao_juntada_service import alocar_slots

        out = alocar_slots([200], produto="Pasta Avulso c/ Bolso")
        assert out["slots"] == [2]
        assert out["total_slots"] == 2

    def test_pasta_tiragens_diferentes(self):
        from services.papelaria_imposicao_juntada_service import alocar_slots

        with pytest.raises(ValueError, match="iguais"):
            alocar_slots([200, 300], produto="Pasta Avulso s/ Bolso")

    def test_montar_ocupadas(self):
        from services.papelaria_imposicao_juntada_service import (
            expandir_paginas_por_slots,
            montar_ocupadas_por_slots,
        )

        assert expandir_paginas_por_slots([1, 1, 2]) == [0, 1, 2, 2]
        ocup = montar_ocupadas_por_slots(
            colunas=2, linhas=2, slots_por_pagina=[1, 1, 2]
        )
        # PDF ganged já tem 4 páginas físicas (com duplicata).
        assert ocup == [
            {"col": 0, "row": 0, "pagina": 1},
            {"col": 1, "row": 0, "pagina": 2},
            {"col": 0, "row": 1, "pagina": 3},
            {"col": 1, "row": 1, "pagina": 4},
        ]

    def test_jdf_root_defaults(self):
        from services.papelaria_imposicao_juntada_service import (
            DEFAULT_JDF_IMPORT_ROOT_PASTA,
            DEFAULT_JDF_IMPORT_ROOT_TIMBRADO,
            resolve_jdf_import_root,
        )

        assert resolve_jdf_import_root({}, produto="Timbrado A4") == (
            DEFAULT_JDF_IMPORT_ROOT_TIMBRADO
        )
        assert resolve_jdf_import_root(
            {"jdf_import_root": r"\\custom\hot"},
            produto="Timbrado A4",
        ) == r"\\custom\hot"
        assert resolve_jdf_import_root(
            {}, produto="Pasta Avulso c/ Bolso"
        ) == DEFAULT_JDF_IMPORT_ROOT_PASTA

    def test_resolve_template_pdf(self):
        from services.papelaria_imposicao_juntada_service import (
            resolve_imposicao_template_pdf,
        )

        assert resolve_imposicao_template_pdf(
            {"imposicao_pdf_path": r"\\x\a.pdf", "marcas_pdf_path": r"\\x\b.pdf"}
        ) == r"\\x\a.pdf"
        assert resolve_imposicao_template_pdf(
            {"marcas_pdf_path": r"\\x\b.pdf"}
        ) == r"\\x\b.pdf"
        assert resolve_imposicao_template_pdf({}) == ""

    def test_descricao_juntada(self):
        from services.papelaria_imposicao_juntada_service import (
            format_juntada_descricao,
        )

        text = format_juntada_descricao(
            {"nro": 6227, "label": "06227-Fulano"},
            [{"nro": 6228, "label": "Beltrano"}, {"nro": 6230, "label": ""}],
        )
        assert "06227-Fulano" in text
        assert "juntada:" in text
        assert "06228-Beltrano" in text
        assert "06230" in text


class TestImposicaoConfigPreImpresso:
    def test_validate_inclui_campos_novos(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        payload = {
            "folha_mm": {"largura": 297, "altura": 210},
            "pagina": {"origem": "fixixa", "largura_mm": 210, "altura_mm": 297},
            "grid": {"colunas": 2, "linhas": 2},
            "espacamento_mm": {"horizontal": 0, "vertical": 0},
            "sangria_mm": 0,
            "marcas_corte": False,
            "marcas_pdf_path": None,
            "centralizar_na_folha": True,
            "work_style": "Simplex",
            "usar_pre_impresso": True,
            "jdf_import_root": r"\\apogee\JDFImportRoot\Papelaria_Timbrado",
        }
        out = validate_imposicao_config_payload(payload)
        assert out["usar_pre_impresso"] is True
        assert out["jdf_import_root"].endswith("Papelaria_Timbrado")

    def test_validate_default_pre_impresso_false(self):
        from services.papelaria_imposicao_config_service import (
            validate_imposicao_config_payload,
        )

        payload = {
            "folha_mm": {"largura": 297, "altura": 210},
            "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
            "grid": {"colunas": 2, "linhas": 1},
            "espacamento_mm": {"horizontal": 0, "vertical": 0},
            "sangria_mm": 0,
            "marcas_corte": False,
            "centralizar_na_folha": True,
            "work_style": "Simplex",
        }
        out = validate_imposicao_config_payload(payload)
        assert out["usar_pre_impresso"] is False
        assert out["jdf_import_root"] is None
