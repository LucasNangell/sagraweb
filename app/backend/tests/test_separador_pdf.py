import fitz

from services.separador_pdf_service import build_separador_pdf


def test_separador_pdf_page_size_and_cad_sequence():
    pdf_bytes = build_separador_pdf(
        os_label="2532/2026",
        until=3,
        titulo="Ata da sessao",
        solicitante="Gabinete 12",
        produto="Livro",
    )
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        assert doc.page_count == 3
        rect = doc[0].rect
        width_mm = rect.width * 25.4 / 72
        height_mm = rect.height * 25.4 / 72
        assert abs(width_mm - 102) < 0.3
        assert abs(height_mm - 297) < 0.3
        text = "\n".join(page.get_text() for page in doc)
        assert "2532/2026" in text
        assert "01" in text
        assert "02" in text
        assert "03" in text
        assert "Gabinete 12" in text
        assert "Livro" in text
    finally:
        doc.close()


def test_separador_pdf_rejects_invalid_until():
    try:
        build_separador_pdf(
            os_label="1/2026",
            until=0,
            titulo="",
            solicitante="",
            produto="",
        )
    except ValueError:
        return
    raise AssertionError("until=0 deveria falhar")
