"""Builder JDF Apogee (A5 2×1) e helpers de path."""
from __future__ import annotations

from pathlib import Path

import pytest


def test_build_jdf_filename_nao_duplica_nro_os():
    from services.papelaria_jdf_service import (
        build_jdf_filename,
        ensure_os_prefixed_name,
        strip_leading_os_number,
    )

    assert (
        build_jdf_filename(
            ano=2026,
            nro=6227,
            folder_basename="06227-AirtonFaleiro-BlocoA5_2x1",
        )
        == "2026_06227_AirtonFaleiro-BlocoA5_2x1.jdf"
    )
    assert (
        build_jdf_filename(
            ano=2026,
            nro=6227,
            folder_basename="06227-06227-AirtonFaleiro-BlocoA5_2x1",
        )
        == "2026_06227_AirtonFaleiro-BlocoA5_2x1.jdf"
    )
    assert (
        build_jdf_filename(
            ano=2026,
            nro=6227,
            folder_basename="6227-AirtonFaleiro-BlocoA5_2x1",
        )
        == "2026_06227_AirtonFaleiro-BlocoA5_2x1.jdf"
    )
    assert (
        build_jdf_filename(
            ano=2026,
            nro=6227,
            folder_basename="AirtonFaleiro-BlocoA5_2x1",
        )
        == "2026_06227_AirtonFaleiro-BlocoA5_2x1.jdf"
    )
    assert strip_leading_os_number("06227-06227-Nome", 6227) == "Nome"
    assert strip_leading_os_number("6227-Nome", 6227) == "Nome"
    assert (
        ensure_os_prefixed_name("6227-06227-AirtonFaleiro", 6227)
        == "06227-AirtonFaleiro"
    )


def test_path_to_file_url_drive():
    from services.papelaria_jdf_service import path_to_file_url

    url = path_to_file_url(r"J:\2026\OS\Sefoc\arquivo.pdf")
    assert url.startswith("file:///J:/")
    assert url.endswith("arquivo.pdf")
    assert "\\" not in url


def test_path_to_file_url_unc():
    from services.papelaria_jdf_service import path_to_file_url

    url = path_to_file_url(r"\\apogee\share\file.pdf")
    assert url.startswith("file://apogee/")
    assert url.endswith("file.pdf")


def test_compute_positions_a5_2x1_centralizado():
    from services.papelaria_jdf_service import compute_content_positions, mm_to_pt

    # Folha A4 paisagem 297×210; página A5 148×210; 2×1; gap 0
    positions = compute_content_positions(
        folha_w_mm=297,
        folha_h_mm=210,
        page_w_mm=148,
        page_h_mm=210,
        cols=2,
        rows=1,
        gap_h_mm=0,
        gap_v_mm=0,
        centralizar=True,
    )
    assert len(positions) == 2
    # sobra 1 mm → 0,5 mm cada lado
    assert positions[0][0] == pytest.approx(0.5, abs=0.01)
    assert positions[1][0] == pytest.approx(148.5, abs=0.01)
    assert mm_to_pt(0.5) == pytest.approx(1.417, abs=0.01)


def _base_config(**overrides):
    cfg = {
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
        "grid": {"colunas": 2, "linhas": 1},
        "espacamento_mm": {"horizontal": 0, "vertical": 0},
        "sangria_mm": 0,
        "marcas_corte": False,
        "centralizar_na_folha": True,
        "work_style": "Simplex",
    }
    cfg.update(overrides)
    return cfg


def test_build_apogee_jdf_xml_a5_2x1(tmp_path: Path):
    from services.papelaria_jdf_service import build_apogee_jdf_xml

    pdf = tmp_path / "06227-AirtonFaleiro-BlocoA5-BaseSefoc.pdf"
    pdf.write_bytes(b"%PDF")
    xml = build_apogee_jdf_xml(
        ano=2026,
        nro=6227,
        descriptive_name="AirtonFaleiro-BlocoA5",
        comment="teste 2x1",
        export_folder=str(tmp_path),
        export_filename="06227-AirtonFaleiro-BlocoA5_Imposição.pdf",
        base_pdf_path=str(pdf),
        base_pdf_user_name=pdf.stem,
        config=_base_config(),
        page_w_mm=148,
        page_h_mm=210,
    )
    assert 'JobID="2026"' in xml
    assert 'JobPartID="06227"' in xml
    assert 'DescriptiveName="06227"' in xml
    assert "xmlns:mis=" not in xml
    assert "mis:ExportFolder" not in xml
    assert 'IDUsage="JobDescription" IDValue="AirtonFaleiro-BlocoA5"' in xml
    assert 'IDUsage="ExportFolder"' in xml
    # ExportFileName / JobDescription sem Nr OS e sem sufixo Imposição.
    assert 'IDUsage="ExportFileName" IDValue="AirtonFaleiro-BlocoA5"' in xml
    assert 'IDUsage="JobDescription" IDValue="06227' not in xml
    assert "_Imposição" not in xml
    assert "06227-06227" not in xml
    assert "6227-06227" not in xml


def test_build_apogee_jdf_xml_strip_os_da_descricao_e_export(tmp_path: Path):
    from services.papelaria_jdf_service import build_apogee_jdf_xml

    pdf = tmp_path / "base.pdf"
    pdf.write_bytes(b"%PDF")
    xml = build_apogee_jdf_xml(
        ano=2026,
        nro=6227,
        descriptive_name="06227-AirtonFaleiro-BlocoA5",
        comment="06227 — imposição 2x1",
        export_folder=str(tmp_path),
        export_filename="06227-AirtonFaleiro-BlocoA5_Imposição.pdf",
        base_pdf_path=str(pdf),
        base_pdf_user_name="06227-AirtonFaleiro-BlocoA5-BaseSefoc",
        config=_base_config(),
        page_w_mm=148,
        page_h_mm=210,
    )
    assert 'IDUsage="JobDescription" IDValue="AirtonFaleiro-BlocoA5"' in xml
    assert 'IDUsage="ExportFileName" IDValue="AirtonFaleiro-BlocoA5"' in xml
    assert 'UserFileName="AirtonFaleiro-BlocoA5-BaseSefoc"' in xml
    assert "_Imposição" not in xml
    assert "06227 —" not in xml
    assert "06227-06227" not in xml
    assert "JDFNoMarks" in xml
    assert (
        'NamedFeatures="Imposition JDFNoMarks resultexport ExportPDF_Sefoc '
        'resultexport@Export ExportPDF_Sefoc"'
    ) in xml
    assert (
        'NamedFeatures="Imposition JDFNoMarks resultexport ExportPDF_Sefoc"'
    ) in xml
    assert 'DescriptiveName="PrePress"' in xml
    assert xml.count("<ContentObject") == 2
    assert "MarkObject" not in xml
    assert "CutMark" not in xml
    assert "SourceWorkStyle=\"Simplex\"" in xml


def test_path_to_file_url_unc_encode_espacos():
    from services.papelaria_jdf_service import path_to_file_url

    url = path_to_file_url(
        r"\\redecamara\dfsdata\CGraf\Modelos Corel\ImposicaoSIELT_5x2_A4.pdf"
    )
    assert url.startswith("file://redecamara/")
    assert "Modelos%20Corel" in url
    assert url.endswith("ImposicaoSIELT_5x2_A4.pdf")


def test_build_apogee_jdf_xml_com_marcas_corte(tmp_path: Path):
    import fitz

    from services.papelaria_jdf_service import MM_TO_PT, build_apogee_jdf_xml

    pdf = tmp_path / "06227-AirtonFaleiro-BlocoA5-BaseSefoc.pdf"
    pdf.write_bytes(b"%PDF")
    # PDF de marcas A4 com TrimBox deslocada (como ImposicaoSIELT_5x2_A4).
    marcas_path = tmp_path / "ImposicaoSIELT_5x2_A4.pdf"
    doc = fitz.open()
    page = doc.new_page(width=210 * MM_TO_PT, height=297 * MM_TO_PT)
    # TrimBox ≈ grade centralizada 170×250 mm em A4 → origem ~20×23.5 mm
    trim = fitz.Rect(20 * MM_TO_PT, 23.5 * MM_TO_PT, 190 * MM_TO_PT, 273.5 * MM_TO_PT)
    page.set_trimbox(trim)
    doc.save(str(marcas_path))
    doc.close()

    xml = build_apogee_jdf_xml(
        ano=2026,
        nro=6227,
        descriptive_name="AirtonFaleiro-BlocoA5",
        comment="teste com marcas como conteúdo",
        export_folder=str(tmp_path),
        export_filename="AirtonFaleiro-BlocoA5.pdf",
        base_pdf_path=str(pdf),
        base_pdf_user_name=pdf.stem,
        config=_base_config(
            marcas_corte=True,
            marcas_pdf_path=str(marcas_path),
            folha_mm={"largura": 210, "altura": 297},
            grid={"colunas": 5, "linhas": 2},
        ),
        page_w_mm=85,
        page_h_mm=50,
    )
    # Marcas como conteúdo (Ord=1), sem MarkObject / RL_Marcas.
    assert "JDFNoMarks" in xml
    assert "MarkObject" not in xml
    assert 'ID="RL_Marcas"' not in xml
    assert 'ProcessUsage="Marks"' not in xml
    assert 'Run="Arte"' in xml
    assert 'Run="Marcas"' in xml
    assert 'NPage="2"' in xml
    assert 'ContentObject Ord="1"' in xml
    assert 'CTM="1 0 0 1 0 0"' in xml
    assert "ImposicaoSIELT_5x2_A4" in xml
    # TrimCTM usa origem da TrimBox (~56.693, 66.614)
    assert "TrimCTM=\"1 0 0 1 56.693 66.614\"" in xml
    # Arte Ord=0 + marcas Ord=1
    assert xml.count('ContentObject Ord="0"') == 10
    assert xml.count('ContentObject Ord="1"') == 1


def test_build_apogee_jdf_xml_marcas_sem_path_falha(tmp_path: Path):
    from services.papelaria_jdf_service import build_apogee_jdf_xml

    pdf = tmp_path / "base.pdf"
    pdf.write_bytes(b"%PDF")
    with pytest.raises(ValueError, match="caminho do PDF de marcas"):
        build_apogee_jdf_xml(
            ano=2026,
            nro=6227,
            descriptive_name="x",
            comment="x",
            export_folder=str(tmp_path),
            export_filename="x.pdf",
            base_pdf_path=str(pdf),
            base_pdf_user_name="x",
            config=_base_config(marcas_corte=True),
            page_w_mm=148,
            page_h_mm=210,
        )


def test_write_jdf_file(tmp_path: Path):
    from services.papelaria_jdf_service import write_jdf_file

    out = write_jdf_file("<JDF/>", str(tmp_path), "teste.jdf")
    assert Path(out).is_file()
    assert Path(out).read_text(encoding="utf-8") == "<JDF/>"
