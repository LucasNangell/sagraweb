"""Crop de cabeçalho/rodapé a partir do PDF do Timbrado (Prova PDF)."""
from __future__ import annotations

from pathlib import Path

import fitz
import pytest


def test_regioes_digitais_do_config_e_default():
    from services.papelaria_timbrado_digital_service import regioes_digitais_efetivas

    page_w, page_h = 595.28, 841.89
    custom = regioes_digitais_efetivas(
        {
            "regioes_digitais": {
                "cabecalho": {"bbox": [0, 0.02, 1, 0.12], "unidade": "norm"},
                "rodape": {"bbox": [10, 280, 200, 297], "unidade": "mm"},
            }
        },
        page_width=page_w,
        page_height=page_h,
    )
    assert custom["cabecalho"][1] == pytest.approx(0.02 * page_h)
    assert custom["rodape"][2] > custom["rodape"][0]

    defaults = regioes_digitais_efetivas({}, page_width=page_w, page_height=page_h)
    assert defaults["cabecalho"][3] > defaults["cabecalho"][1]
    assert defaults["rodape"][1] > 700


def test_exportar_imagens_timbrado_modelo_20(tmp_path: Path):
    from services.papelaria_timbrado_digital_service import (
        exportar_imagens_timbrado_digital,
    )

    pdf_dir = Path("Modelos/papelaria/prova_pdf/20")
    if not (pdf_dir / "modelo.pdf").is_file():
        pytest.skip("modelo Timbrado prova_pdf/20 ausente")

    dados = {
        "nome_deputado": "Fulano de Tal",
        "partido": "PL",
        "uf": "DF",
        "gabinete": "716",
        "anexo": "IV",
        "email": "dep.fulano@camara.leg.br",
        "genero": "Deputado",
        "artigo": "do",
    }
    paths = exportar_imagens_timbrado_digital(20, dados, tmp_path, dpi=150)
    cab = Path(paths["cabecalho"])
    rod = Path(paths["rodape"])
    assert cab.is_file() and cab.stat().st_size > 100
    assert rod.is_file() and rod.stat().st_size > 100

    # PNG válido
    with fitz.open(cab) as _:
        pass
    pix = fitz.Pixmap(str(cab))
    assert pix.width > 100 and pix.height > 20
