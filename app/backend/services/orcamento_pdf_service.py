"""Gera o ofício de orçamento em PDF (fpdf2), no formato do DOC-modelo."""
from __future__ import annotations

from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

from fpdf import FPDF
from fpdf.fonts import FontFace

_MESES = (
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
)

CABECALHO_LINHAS = (
    "CÂMARA DOS DEPUTADOS",
    "Departamento de Apoio Parlamentar",
    "Coordenação Gráfica da Câmara",
)

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"
BRASAO_PATH = _TEMPLATES_DIR / "orcamento_brasao.png"
_HEADER_TOP = 10.0
_BRASAO_H = 18.0
_TMARGIN = 34.0


def _txt(value: Any) -> str:
    return str(value or "").encode("latin-1", "replace").decode("latin-1")


def _brl(value: Any) -> str:
    try:
        n = float(value)
    except (TypeError, ValueError):
        n = 0.0
    formatted = f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"


def _data_extenso(value: Any) -> str:
    d: date
    if isinstance(value, datetime):
        d = value.date()
    elif isinstance(value, date):
        d = value
    else:
        text = str(value or "").strip()
        iso = text[:10]
        try:
            y, m, day = (int(p) for p in iso.split("-"))
            d = date(y, m, day)
        except (ValueError, TypeError):
            d = date.today()
    return f"Brasília, {d.day} de {_MESES[d.month - 1]} de {d.year}."


def _draw_especificacao_tabela(pdf: FPDF, grupos: list) -> None:
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    label_w = min(48.0, usable * 0.32)
    value_w = usable - label_w
    line_h = 5.5
    for grupo in grupos:
        titulo = str((grupo or {}).get("titulo") or "").strip()
        linhas = (grupo or {}).get("linhas") or []
        if not linhas:
            continue
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(230, 230, 230)
        pdf.set_text_color(40, 40, 40)
        pdf.cell(usable, line_h, _txt(titulo), border=1, fill=True, new_x="LMARGIN", new_y="NEXT")
        for linha in linhas:
            label = _txt(str((linha or {}).get("label") or ""))
            valor = _txt(str((linha or {}).get("valor") or ""))
            x = pdf.get_x()
            y = pdf.get_y()
            pdf.set_font("Helvetica", "", 9)
            pdf.set_text_color(0, 0, 0)
            pdf.multi_cell(label_w, line_h, label, border=1)
            h_label = pdf.get_y() - y
            pdf.set_xy(x + label_w, y)
            pdf.multi_cell(value_w, line_h, valor, border=1)
            h_val = pdf.get_y() - y
            pdf.set_xy(pdf.l_margin, y + max(h_label, h_val))
    pdf.set_text_color(0, 0, 0)


def _draw_assinaturas(pdf: FPDF, oficio: dict) -> None:
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    col = usable / 2
    pdf.set_font("Helvetica", "", 10)
    pdf.set_fill_color(255, 255, 255)
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.3)
    with pdf.table(
        width=usable,
        col_widths=(col, col),
        first_row_as_headings=False,
        num_heading_rows=0,
        borders_layout="NO_HORIZONTAL_LINES",
        cell_fill_color=(255, 255, 255),
        cell_fill_mode="ALL",
        text_align="LEFT",
        v_align="TOP",
        align="LEFT",
        line_height=5,
        padding=1,
    ) as table:
        pad = (2, 6, 2, 2)
        row = table.row()
        row.cell(
            _txt(
                "Encaminho o presente orçamento conforme solicitação recebida "
                "e obedecida a norma vigente."
            ),
            padding=pad,
        )
        row.cell(
            _txt("Autorizo a execução do trabalho especificado."),
            padding=pad,
        )
        row = table.row()
        row.cell(" \n\n", padding=pad)
        row.cell(" \n\n", padding=pad)
        row = table.row()
        row.cell(
            _txt(oficio.get("signatario") or ""),
            style=FontFace(emphasis="B"),
            padding=pad,
            align="C",
        )
        row.cell(_txt("Responsável"), padding=pad, align="C")
        row = table.row()
        row.cell(_txt(oficio.get("cargo") or ""), padding=pad, align="C")
        row.cell(_txt("Assinatura e Carimbo"), padding=pad, align="C")


class OrcamentoOficioPDF(FPDF):
    def __init__(self, endereco: str, telefone: str):
        super().__init__(format="A4")
        self._endereco = endereco
        self._telefone = telefone
        self.set_auto_page_break(auto=True, margin=22)
        self.set_margins(20, _TMARGIN, 20)

    def header(self):
        x = self.l_margin
        y = _HEADER_TOP
        text_x = x
        if BRASAO_PATH.is_file():
            self.image(str(BRASAO_PATH), x=x, y=y, h=_BRASAO_H)
            text_x = x + _BRASAO_H + 4
        self.set_text_color(0, 0, 0)
        self.set_xy(text_x, y)
        for i, linha in enumerate(CABECALHO_LINHAS):
            self.set_x(text_x)
            if i == 0:
                self.set_font("Helvetica", "B", 11)
                self.cell(0, 5, _txt(linha), new_x="LMARGIN", new_y="NEXT")
            else:
                self.set_font("Helvetica", "", 8)
                self.cell(0, 4, _txt(linha), new_x="LMARGIN", new_y="NEXT")

    def footer(self):
        self.set_y(-18)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(80, 80, 80)
        self.cell(0, 4, _txt(f"Endereço: {self._endereco}"), align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 4, _txt(f"Telefone: {self._telefone}"), align="C", new_x="LMARGIN", new_y="NEXT")


def build_orcamento_pdf(record: dict) -> bytes:
    snap = record.get("snapshot") or {}
    oficio = (snap.get("oficio") or {})
    entrada = snap.get("entrada") or {}
    os_meta = entrada.get("os") or {}
    pdf = OrcamentoOficioPDF(
        endereco=oficio.get("endereco") or "",
        telefone=oficio.get("telefone") or "",
    )
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(
        0,
        10,
        _txt(f"ORÇAMENTO {record['numero']}/{record['ano']}"),
        align="R",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 11)
    processo = oficio.get("processo") or os_meta.get("processo") or ""
    if processo:
        pdf.cell(0, 6, _txt(f"Processo nº {processo}"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(
        0,
        6,
        _txt(f"Ordem de serviço nº {record['nro_protocolo']}/{record['ano_protocolo']}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)
    data_fonte = record.get("criado_em") or oficio.get("data_geracao")
    pdf.cell(0, 6, _txt(_data_extenso(data_fonte)), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, _txt(f"Solicitante: {oficio.get('solicitante') or ''}"), new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, _txt(f"Título: {oficio.get('titulo') or ''}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, _txt("Especificação"), new_x="LMARGIN", new_y="NEXT")
    grupos = oficio.get("especificacao_grupos") or []
    if grupos:
        _draw_especificacao_tabela(pdf, grupos)
    else:
        pdf.set_font("Helvetica", "", 11)
        pdf.multi_cell(0, 5.5, _txt(oficio.get("especificacao") or ""), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 11)
    pdf.cell(0, 6, _txt(f"Valor total: {_brl(oficio.get('valor_total'))}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)
    pdf.set_font("Helvetica", "", 10)
    pdf.multi_cell(0, 5, _txt("- " + (oficio.get("clausula_validade") or "")), new_x="LMARGIN", new_y="NEXT")
    pdf.multi_cell(0, 5, _txt("- " + (oficio.get("clausula_entrega") or "")), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(14)
    _draw_assinaturas(pdf, oficio)

    buffer = BytesIO()
    pdf.output(buffer)
    buffer.seek(0)
    return buffer.read()
