"""Placements absolutos Pasta/Timbrado + PDF de marcas com OP."""
from __future__ import annotations

from pathlib import Path

import fitz
import pytest


def test_default_jdf_import_root_unificado():
    from services.papelaria_imposicao_juntada_service import (
        DEFAULT_JDF_IMPORT_ROOT_PAPELARIA,
        default_jdf_import_root,
    )

    assert default_jdf_import_root("Pasta Avulso c/ Bolso") == (
        DEFAULT_JDF_IMPORT_ROOT_PAPELARIA
    )
    assert default_jdf_import_root("Timbrado A4") == DEFAULT_JDF_IMPORT_ROOT_PAPELARIA
    assert DEFAULT_JDF_IMPORT_ROOT_PAPELARIA.endswith(r"\Papelaria")


def test_placements_pasta_coords():
    from services.papelaria_imposicao_juntada_service import placements_pasta

    slots = placements_pasta(n_slots=2)
    assert len(slots) == 2
    assert slots[0]["x_mm"] == pytest.approx(52.46)
    assert slots[0]["y_mm"] == pytest.approx(285.0)
    assert slots[0]["rotacao"] == 90
    assert slots[0]["pagina"] == 1
    assert slots[1]["x_mm"] == pytest.approx(52.46)
    assert slots[1]["y_mm"] == pytest.approx(65.0)
    assert slots[1]["pagina"] == 2


def test_placements_timbrado_coords():
    from services.papelaria_imposicao_juntada_service import placements_timbrado

    slots = placements_timbrado(n_slots=4)
    assert len(slots) == 4
    assert slots[0]["x_mm"] == pytest.approx(69.528)
    assert slots[0]["y_mm"] == pytest.approx(285.0)
    assert slots[2]["x_mm"] == pytest.approx(378.525)
    assert slots[3]["y_mm"] == pytest.approx(75.0)
    assert all(s["rotacao"] == 90 for s in slots)


def test_compute_content_positions_absolutos():
    from services.papelaria_jdf_service import compute_content_positions
    from services.papelaria_imposicao_juntada_service import placements_pasta

    ocupadas = placements_pasta(n_slots=2)
    positions = compute_content_positions(
        folha_w_mm=745,
        folha_h_mm=605,
        page_w_mm=220,
        page_h_mm=320,
        cols=1,
        rows=2,
        gap_h_mm=0,
        gap_v_mm=0,
        centralizar=True,
        ocupadas=ocupadas,
    )
    assert positions[0][:2] == pytest.approx((52.46, 285.0))
    assert positions[0][2] == 1
    assert positions[0][3] == 90
    assert positions[1][:2] == pytest.approx((52.46, 65.0))


def test_format_marcas_op_token():
    from services.papelaria_jdf_service import format_marcas_op_token

    assert format_marcas_op_token([6220]) == "06220_SM74"
    assert format_marcas_op_token([6220, 6221]) == "06220-06221_SM74"


def test_prepare_marcas_pdf_with_ops(tmp_path: Path):
    from services.papelaria_jdf_service import (
        MARCAS_OP_PLACEHOLDER,
        prepare_marcas_pdf_with_ops,
    )

    src = tmp_path / "PastaMarks.pdf"
    dest = tmp_path / "out-Marcas-OP.pdf"
    doc = fitz.open()
    page = doc.new_page(width=745 * 72 / 25.4, height=605 * 72 / 25.4)
    page.insert_text(
        (50, 100),
        f"OS nro [{MARCAS_OP_PLACEHOLDER}] [Pasta Avulso]",
        fontsize=16,
    )
    page.insert_text(
        (400, 500),
        f"[{MARCAS_OP_PLACEHOLDER}]",
        fontsize=16,
    )
    doc.save(src)
    doc.close()

    out = prepare_marcas_pdf_with_ops(
        source_pdf_path=str(src),
        output_pdf_path=str(dest),
        nros=[6220, 6221],
    )
    assert Path(out).is_file()
    with fitz.open(out) as check:
        text = check[0].get_text()
    assert MARCAS_OP_PLACEHOLDER not in text
    assert "06220-06221_SM74" in text


def test_jdf_pasta_com_marcas_e_placements(tmp_path: Path):
    from services.papelaria_jdf_service import MM_TO_PT, build_apogee_jdf_xml
    from services.papelaria_imposicao_juntada_service import (
        FOLHA_PRE_IMPRESSO_MM,
        placements_pasta,
    )

    arte = tmp_path / "gang.pdf"
    doc = fitz.open()
    doc.new_page(width=220 * MM_TO_PT, height=320 * MM_TO_PT)
    doc.new_page(width=220 * MM_TO_PT, height=320 * MM_TO_PT)
    doc.save(arte)
    doc.close()

    marcas = tmp_path / "marcas-op.pdf"
    mdoc = fitz.open()
    mdoc.new_page(
        width=FOLHA_PRE_IMPRESSO_MM["largura"] * MM_TO_PT,
        height=FOLHA_PRE_IMPRESSO_MM["altura"] * MM_TO_PT,
    )
    mdoc.save(marcas)
    mdoc.close()

    ocupadas = placements_pasta(n_slots=2)
    xml = build_apogee_jdf_xml(
        ano=2026,
        nro=6220,
        descriptive_name="JoaoCury-PastaAvulsocBolso",
        comment="pasta com marcas",
        export_folder=str(tmp_path),
        export_filename="JoaoCury-PastaAvulsocBolso.pdf",
        base_pdf_path=str(arte),
        base_pdf_user_name=arte.stem,
        config={
            "folha_mm": dict(FOLHA_PRE_IMPRESSO_MM),
            "pagina": {
                "origem": "fixixa",
                "largura_mm": 220,
                "altura_mm": 320,
            },
            "grid": {"colunas": 1, "linhas": 2, "ocupadas": ocupadas},
            "espacamento_mm": {"horizontal": 0, "vertical": 0},
            "sangria_mm": 0,
            "marcas_corte": True,
            "marcas_pdf_path": str(marcas),
            "centralizar_na_folha": False,
            "work_style": "Simplex",
        },
        page_w_mm=220,
        page_h_mm=320,
    )
    assert "MarkObject" not in xml
    assert "JDFNoMarks" in xml
    assert 'Run="Marcas"' in xml
    assert "ImpositionPreparation" in xml
    assert "<Layout " in xml
    # 2 artes + 1 marcas
    assert xml.count("<ContentObject") == 3
    assert 'ContentObject Ord="0"' in xml
    assert 'ContentObject Ord="1"' in xml
    assert 'ContentObject Ord="2"' in xml
    # CTM rot 90 usa origem (x+h, y) em pt
    # Pasta1: x=52.46 y=285 → x_pt+h_pt, y_pt
    x_pt = 52.46 * MM_TO_PT
    y_pt = 285.0 * MM_TO_PT
    h_pt = 320 * MM_TO_PT
    needle = f"0 1 -1 0 {x_pt + h_pt:.3f} {y_pt:.3f}"
    assert needle in xml
