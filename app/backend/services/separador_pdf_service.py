"""PDF do separador de cadernos em 102 x 297 mm."""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import fitz
from fpdf import FPDF

PAGE_W_MM = 102.0
PAGE_H_MM = 297.0
MARGIN_X = 7.0
INK = (35, 33, 32)
HEADER_FILL = (187, 189, 191)
CAD_MIN = 1
CAD_MAX = 99

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
LOGO_PATH = _TEMPLATES_DIR / "separador_logo.png"


def _txt(value: Any) -> str:
    return str(value or "").encode("latin-1", "replace").decode("latin-1")


def format_cad_numero(n: int) -> str:
    return f"{n:02d}"


def _fit_font_size(pdf: FPDF, text: str, max_width: float, max_size: float, min_size: float) -> float:
    size = max_size
    while size > min_size:
        pdf.set_font("Helvetica", "B", size)
        if pdf.get_string_width(text) <= max_width:
            return size
        size -= 0.5
    pdf.set_font("Helvetica", "B", min_size)
    return min_size


def _ellipsize(pdf: FPDF, text: str, max_width: float) -> str:
    pdf.set_font("Helvetica", "", 7.5)
    if pdf.get_string_width(text) <= max_width:
        return text
    trimmed = text
    while trimmed and pdf.get_string_width(trimmed + "...") > max_width:
        trimmed = trimmed[:-1]
    return trimmed + "..."


def _draw_legend_box(
    pdf: FPDF,
    x: float,
    y: float,
    w: float,
    h: float,
    legend: str,
) -> None:
    pdf.set_draw_color(*INK)
    pdf.set_line_width(0.45)
    pdf.rect(x, y, w, h)
    pdf.set_font("Helvetica", "B", 16)
    label = _txt(legend)
    lw = pdf.get_string_width(label) + 5
    lx = x + (w - lw) / 2
    pdf.set_fill_color(255, 255, 255)
    pdf.rect(lx, y - 3.2, lw, 6.4, style="F")
    pdf.set_xy(lx, y - 3.6)
    pdf.set_text_color(*INK)
    pdf.cell(lw, 6.4, label, align="C")


def _draw_page(
    pdf: FPDF,
    os_label: str,
    cad_label: str,
    titulo: str,
    solicitante: str,
    produto: str,
) -> None:
    pdf.add_page()
    pdf.set_text_color(*INK)
    pdf.set_draw_color(*INK)
    content_w = PAGE_W_MM - 2 * MARGIN_X
    x = MARGIN_X

    if LOGO_PATH.is_file():
        pdf.image(str(LOGO_PATH), x=x, y=10.0, w=content_w)

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_xy(x, 43.0)
    pdf.cell(content_w, 8, "SEPARADOR", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(x)
    pdf.cell(content_w, 8, "DE CADERNOS", align="C")

    mark_y = 100.0
    pdf.set_dash_pattern(dash=0.8, gap=1.1)
    pdf.set_line_width(0.3)
    pdf.line(x + 2, mark_y, x + content_w - 2, mark_y)
    pdf.set_dash_pattern()

    os_y = 104.0
    os_h = 36.0
    _draw_legend_box(pdf, x, os_y, content_w, os_h, "OS")
    os_text = _txt(os_label)
    os_size = _fit_font_size(pdf, os_text, content_w - 6, 64, 16)
    pdf.set_font("Helvetica", "B", os_size)
    pdf.set_xy(x, os_y + 3)
    pdf.cell(content_w, 16, os_text, align="C")

    meta_y = os_y + 20.5
    rows = (
        ("Título", _txt(titulo)),
        ("Solicitante", _txt(solicitante)),
        ("Produto", _txt(produto)),
    )
    for i, (label, value) in enumerate(rows):
        row_y = meta_y + i * 4.0
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.set_xy(x + 2.5, row_y)
        pdf.cell(20, 3.8, _txt(label))
        pdf.set_font("Helvetica", "", 7.5)
        pdf.set_xy(x + 23, row_y)
        pdf.cell(content_w - 26, 3.8, _ellipsize(pdf, value, content_w - 26))

    cad_y = 145.0
    cad_h = 30.0
    _draw_legend_box(pdf, x, cad_y, content_w, cad_h, "CAD.")
    cad_text = _txt(cad_label)
    cad_size = _fit_font_size(pdf, cad_text, content_w - 6, 96, 22)
    pdf.set_font("Helvetica", "B", cad_size)
    pdf.set_xy(x, cad_y + 3)
    pdf.cell(content_w, cad_h - 5, cad_text, align="C")

    imp_y = 180.0
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_xy(x, imp_y)
    pdf.cell(content_w, 5, _txt("IMPRESSÃO"))
    col_lado, col_qtd = 16.0, 26.0
    col_imp = content_w - col_lado - col_qtd
    y = imp_y + 5.5
    pdf.set_fill_color(*HEADER_FILL)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_xy(x, y)
    pdf.cell(col_lado, 6.5, "LADO", border=1, fill=True, align="C")
    pdf.cell(col_qtd, 6.5, "Qtd.Folhas", border=1, fill=True, align="C")
    pdf.cell(col_imp, 6.5, "IMPRESSOR", border=1, fill=True, align="C")
    y += 6.5
    pdf.set_font("Helvetica", "B", 16)
    for lado in ("F", "V"):
        pdf.set_xy(x, y)
        pdf.cell(col_lado, 9.5, lado, border=1, align="C")
        pdf.cell(col_qtd, 9.5, "", border=1)
        pdf.cell(col_imp, 9.5, "", border=1)
        y += 9.5

    dobra_y = 217.0
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_xy(x, dobra_y)
    pdf.cell(content_w, 5, "DOBRA")
    pdf.set_fill_color(*HEADER_FILL)
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_xy(x, dobra_y + 5.5)
    col_qtd_d = 28.0
    pdf.cell(col_qtd_d, 6.5, "Qtd.Folhas", border=1, fill=True, align="C")
    pdf.cell(content_w - col_qtd_d, 6.5, "DOBRADOR", border=1, fill=True, align="C")
    pdf.set_xy(x, dobra_y + 12.0)
    pdf.cell(col_qtd_d, 11, "", border=1)
    pdf.cell(content_w - col_qtd_d, 11, "", border=1)

    obs_y = 246.0
    pdf.set_line_width(0.45)
    pdf.rect(x, obs_y, content_w, 42)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_xy(x + 3, obs_y + 1.5)
    pdf.cell(20, 5, "OBS:")
    pdf.set_line_width(0.25)
    for i in range(4):
        line_y = obs_y + 10 + i * 7.5
        pdf.line(x + 3, line_y, x + content_w - 3, line_y)


def _disable_print_scaling(pdf_bytes: bytes) -> bytes:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        catalog = doc.pdf_catalog()
        doc.xref_set_key(catalog, "ViewerPreferences", "<< /PrintScaling /None >>")
        return doc.tobytes()
    except Exception:
        return pdf_bytes
    finally:
        doc.close()


def build_separador_pdf(
    *,
    os_label: str,
    until: int,
    titulo: str,
    solicitante: str,
    produto: str,
) -> bytes:
    if until < CAD_MIN or until > CAD_MAX:
        raise ValueError(f"Informe um numero de {CAD_MIN} a {CAD_MAX}.")
    pdf = FPDF(unit="mm", format=(PAGE_W_MM, PAGE_H_MM))
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(0, 0, 0)
    pdf.set_text_color(*INK)
    for n in range(1, until + 1):
        _draw_page(
            pdf,
            os_label=os_label,
            cad_label=format_cad_numero(n),
            titulo=titulo,
            solicitante=solicitante,
            produto=produto,
        )
    buffer = BytesIO()
    pdf.output(buffer)
    return _disable_print_scaling(buffer.getvalue())
