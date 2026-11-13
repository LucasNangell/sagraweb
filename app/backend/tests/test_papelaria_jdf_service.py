"""Builder JDF Apogee (A5 2×1) e helpers de path."""
from __future__ import annotations

from pathlib import Path

import pytest


def test_build_jdf_filename_nao_duplica_nro_os():
    from services.papelaria_jdf_service import build_jdf_filename

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
            folder_basename="AirtonFaleiro-BlocoA5_2x1",
        )
        == "2026_06227_AirtonFaleiro-BlocoA5_2x1.jdf"
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


def test_build_apogee_jdf_xml_a5_2x1(tmp_path: Path):
    from services.papelaria_jdf_service import build_apogee_jdf_xml

    config = {
        "folha_mm": {"largura": 297, "altura": 210},
        "pagina": {"origem": "fixixa", "largura_mm": 148, "altura_mm": 210},
        "grid": {"colunas": 2, "linhas": 1},
        "espacamento_mm": {"horizontal": 0, "vertical": 0},
        "sangria_mm": 0,
        "marcas_corte": False,
        "centralizar_na_folha": True,
        "work_style": "Simplex",
    }
    pdf = tmp_path / "06227-AirtonFaleiro-BlocoA5-BaseSefoc.pdf"
    pdf.write_bytes(b"%PDF")
    xml = build_apogee_jdf_xml(
        ano=2026,
        nro=6227,
        descriptive_name="06227-AirtonFaleiro-BlocoA5",
        comment="teste 2x1",
        export_folder=str(tmp_path),
        export_filename="06227-AirtonFaleiro-BlocoA5_Imposição.pdf",
        base_pdf_path=str(pdf),
        base_pdf_user_name=pdf.stem,
        config=config,
        page_w_mm=148,
        page_h_mm=210,
    )
    assert 'JobID="2026"' in xml
    assert 'JobPartID="06227"' in xml
    assert "ContentObject" in xml
    assert xml.count("<ContentObject") == 2
    assert "file:///" in xml or "file://apogee" in xml or "file://J" in xml.lower() or "file:///" in xml
    assert "TrimSize=\"419.528 595.276\"" in xml or "419.528" in xml
    assert "SourceWorkStyle=\"Simplex\"" in xml


def test_write_jdf_file(tmp_path: Path):
    from services.papelaria_jdf_service import write_jdf_file

    out = write_jdf_file("<JDF/>", str(tmp_path), "teste.jdf")
    assert Path(out).is_file()
    assert Path(out).read_text(encoding="utf-8") == "<JDF/>"
